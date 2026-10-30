package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const (
	managedConfigPath    = "/api/config"
	managedGeneratePath  = "/api/generate"
	managedTaskPrefix    = "/api/tasks/"
	managedAssistantPath = "/api/assistant/chat"

	// Shared with the Hono implementation (shared/contracts.ts): the official
	// upstream cannot accept image inputs through /images/generations, and this
	// facade does not implement /images/edits.
	errorImageInputUnsupported = "image_input_unsupported"
)

type managedConfigResponse struct {
	Image struct {
		Models       []string `json:"models"`
		DefaultModel string   `json:"defaultModel"`
	} `json:"image"`
	Assistant struct {
		TextModel   string `json:"textModel,omitempty"`
		VisionModel string `json:"visionModel,omitempty"`
	} `json:"assistant"`
}

func (c config) managedConfig() *managedConfigResponse {
	if len(c.managedImageModels) == 0 {
		return nil
	}
	var body managedConfigResponse
	body.Image.Models = c.managedImageModels
	body.Image.DefaultModel = c.managedImageModels[0]
	body.Assistant.TextModel = c.managedLlmModel
	body.Assistant.VisionModel = c.managedVisionModel
	return &body
}

type managedGenerateRequest struct {
	Model          string   `json:"model"`
	Prompt         string   `json:"prompt"`
	NegativePrompt string   `json:"negativePrompt"`
	ImageURLs      []string `json:"imageUrls"`
	MaskURL        string   `json:"maskUrl"`
	Size           string   `json:"size"`
	Resolution     string   `json:"resolution"`
	Seed           *float64 `json:"seed"`
	CfgScale       *float64 `json:"cfgScale"`
	Steps          *float64 `json:"steps"`
}

type managedAssistantRequest struct {
	Kind   string `json:"kind"`
	Prompt string `json:"prompt"`
	Image  string `json:"image"`
}

type managedAssistantResponse struct {
	Text string `json:"text"`
}

// Same prompts as shared/assistantPrompts.ts.
const (
	promptEnhanceSystem = "你是一个顶尖的 Midjourney/Stable Diffusion/DALL-E 提示词工程专家。请将用户的简短构想深度润色与丰富细节，扩写出主体特征、场景环境、镜头视角、艺术画风、材质光影和情绪氛围，输出用于直接生图的精炼英文提示词（可中英并茂），不要包含任何解释、前缀或 Markdown 代码块。"
	promptTranslateSystem = "你是一个专业的 AI 生图提示词翻译专家。请将用户输入的生图描述精准翻译为英文高质量提示词，提炼视觉主体、场景细节、艺术画风与光影质感，输出纯文本，不要有任何多余的解释、问候或引号。"
	promptVisionSystem = "你是一个专业的 AI 视觉反推专家。请细致观察用户提供的参考图，反推其生图提示词 (Prompt)，涵盖：画面主体、角色姿态、背景环境、构图视角、艺术媒介风格（如油画、3D渲染、二次元插画、写实摄影等）、色彩基调与光影质感。直接输出适合生图的提示词，严禁输出任何问候或解释说明。"
	promptVisionUser   = "请精准反推这张参考图的生图提示词："
)

func registerManagedRoutes(mux *http.ServeMux, cfg config, client *http.Client) {
	mux.Handle(managedConfigPath, cfg.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, "GET")
			return
		}
		body := cfg.managedConfig()
		if body == nil {
			writeError(w, http.StatusServiceUnavailable, "managed_config_incomplete")
			return
		}
		writeJSON(w, http.StatusOK, body)
	})))

	mux.Handle(managedGeneratePath, cfg.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		handleManagedGenerate(w, r, cfg, client)
	})))

	mux.Handle(managedTaskPrefix, cfg.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, "GET")
			return
		}
		handleManagedTask(w, r, cfg, client)
	})))

	mux.Handle(managedAssistantPath, cfg.requireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			methodNotAllowed(w, "POST")
			return
		}
		handleManagedAssistant(w, r, cfg, client)
	})))
}

func handleManagedGenerate(w http.ResponseWriter, r *http.Request, cfg config, client *http.Client) {
	if !sameOriginOrWriteError(w, r) {
		return
	}
	managed := cfg.managedConfig()
	if managed == nil {
		writeError(w, http.StatusServiceUnavailable, "managed_config_incomplete")
		return
	}
	var body managedGenerateRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if body.Model == "" || body.Size == "" {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if !containsString(managed.Image.Models, body.Model) {
		writeError(w, http.StatusForbidden, "model_not_allowed")
		return
	}
	target := cfg.upstreamFor(kindImage)
	if target == nil {
		writeError(w, http.StatusServiceUnavailable, "upstream_unconfigured")
		return
	}

	official := isOfficialOpenAIBase(target.baseURL.String())
	if official && (len(body.ImageURLs) > 0 || body.MaskURL != "") {
		// Do not forward a text-only request: the caller asked for images and
		// would be billed for something else.
		writeError(w, http.StatusBadRequest, errorImageInputUnsupported)
		return
	}
	payload := map[string]any{
		"model":  body.Model,
		"prompt": body.Prompt,
		"n":      1,
		"size":   formatSizeForModel(body.Size, body.Model),
	}
	if strings.HasPrefix(strings.ToLower(body.Model), "dall-e") {
		payload["response_format"] = "url"
	}
	if !official {
		if body.Resolution != "" {
			payload["resolution"] = body.Resolution
		}
		if strings.TrimSpace(body.NegativePrompt) != "" {
			payload["negative_prompt"] = strings.TrimSpace(body.NegativePrompt)
		}
		if body.Seed != nil {
			payload["seed"] = *body.Seed
		}
		if body.Steps != nil {
			payload["steps"] = *body.Steps
		}
		if body.CfgScale != nil {
			payload["cfg_scale"] = *body.CfgScale
			payload["prompt_weight"] = *body.CfgScale
		}
		if len(body.ImageURLs) > 0 {
			payload["image_urls"] = body.ImageURLs
			if len(body.ImageURLs) == 1 {
				payload["image"] = body.ImageURLs[0]
			}
		}
		if body.MaskURL != "" {
			payload["mask"] = body.MaskURL
		}
	}
	forwardManagedJSON(w, r, client, target, http.MethodPost, "images/generations", payload)
}

func handleManagedTask(w http.ResponseWriter, r *http.Request, cfg config, client *http.Client) {
	if !sameOriginOrWriteError(w, r) {
		return
	}
	target := cfg.upstreamFor(kindImage)
	if target == nil {
		writeError(w, http.StatusServiceUnavailable, "upstream_unconfigured")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, managedTaskPrefix)
	if id == "" || strings.Contains(id, "/") {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	forwardManagedJSON(w, r, client, target, http.MethodGet, "tasks/"+url.PathEscape(id), nil)
}

func handleManagedAssistant(w http.ResponseWriter, r *http.Request, cfg config, client *http.Client) {
	if !sameOriginOrWriteError(w, r) {
		return
	}
	managed := cfg.managedConfig()
	if managed == nil {
		writeError(w, http.StatusServiceUnavailable, "managed_config_incomplete")
		return
	}
	var body managedAssistantRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if body.Kind != "polish" && body.Kind != "translate" && body.Kind != "vision" {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if body.Kind == "vision" && body.Image == "" {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if body.Kind != "vision" && body.Prompt == "" {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	model := managed.Assistant.TextModel
	if body.Kind == "vision" {
		model = managed.Assistant.VisionModel
	}
	if model == "" {
		writeError(w, http.StatusServiceUnavailable, "assistant_model_unconfigured")
		return
	}
	target := cfg.upstreamFor(kindLLM)
	if target == nil {
		writeError(w, http.StatusServiceUnavailable, "upstream_unconfigured")
		return
	}

	messages := assistantMessages(body)
	temperature := 0.7
	if body.Kind == "vision" {
		temperature = 0.5
	}
	payload := map[string]any{
		"model":       model,
		"messages":    messages,
		"temperature": temperature,
		"stream":      false,
	}

	upstreamURL := strings.TrimSuffix(target.baseURL.String(), "/") + "/chat/completions"
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error")
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, upstreamURL, bytes.NewReader(payloadBytes))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+target.apiKey)
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("managed assistant upstream failed", "error", err)
		writeError(w, http.StatusBadGateway, "upstream_unreachable")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		copyUpstreamResponse(w, resp)
		return
	}
	var decoded any
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&decoded); err != nil {
		writeError(w, http.StatusBadGateway, "assistant_empty_response")
		return
	}
	text := extractAssistantText(decoded)
	if text == "" {
		writeError(w, http.StatusBadGateway, "assistant_empty_response")
		return
	}
	writeJSON(w, http.StatusOK, managedAssistantResponse{Text: text})
}

func assistantMessages(body managedAssistantRequest) []map[string]any {
	if body.Kind == "vision" {
		return []map[string]any{
			{"role": "system", "content": promptVisionSystem},
			{"role": "user", "content": []map[string]any{
				{"type": "text", "text": promptVisionUser},
				{"type": "image_url", "image_url": map[string]any{"url": body.Image}},
			}},
		}
	}
	system := promptEnhanceSystem
	if body.Kind == "translate" {
		system = promptTranslateSystem
	}
	return []map[string]any{
		{"role": "system", "content": system},
		{"role": "user", "content": body.Prompt},
	}
}

func extractAssistantText(value any) string {
	root, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	choices, ok := root["choices"].([]any)
	if !ok || len(choices) == 0 {
		return ""
	}
	first, ok := choices[0].(map[string]any)
	if !ok {
		return ""
	}
	message, ok := first["message"].(map[string]any)
	if !ok {
		return ""
	}
	switch content := message["content"].(type) {
	case string:
		return strings.TrimSpace(content)
	case []any:
		var builder strings.Builder
		for _, part := range content {
			item, ok := part.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := item["text"].(string); ok {
				builder.WriteString(text)
			}
		}
		return strings.TrimSpace(builder.String())
	default:
		return ""
	}
}

func forwardManagedJSON(
	w http.ResponseWriter,
	r *http.Request,
	client *http.Client,
	target *upstream,
	method string,
	path string,
	payload any,
) {
	upstreamURL := strings.TrimSuffix(target.baseURL.String(), "/") + "/" + strings.TrimPrefix(path, "/")
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error")
			return
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(r.Context(), method, upstreamURL, body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+target.apiKey)
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("managed upstream request failed",
			"method", method,
			"path", path,
			"error", err,
		)
		writeError(w, http.StatusBadGateway, "upstream_unreachable")
		return
	}
	defer resp.Body.Close()
	copyUpstreamResponse(w, resp)
}

func copyUpstreamResponse(w http.ResponseWriter, resp *http.Response) {
	if contentType := resp.Header.Get("Content-Type"); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	w.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(w, resp.Body); err != nil {
		slog.Debug("managed upstream response interrupted", "error", err)
	}
}

func sameOriginOrWriteError(w http.ResponseWriter, r *http.Request) bool {
	allowed, valid := checkOrigin(r)
	if !valid {
		writeError(w, http.StatusBadRequest, "invalid_request")
		return false
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "cross_origin_forbidden")
		return false
	}
	return true
}

// checkOrigin enforces the same-origin rule. A cross-origin Origin header is
// never legitimate for this browser client. valid=false means the value could
// not be parsed at all.
func checkOrigin(r *http.Request) (allowed bool, valid bool) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true, true
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Host == "" {
		return false, false
	}
	return strings.EqualFold(parsed.Host, r.Host), true
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func isOfficialOpenAIBase(baseURL string) bool {
	parsed, err := url.Parse(baseURL)
	return err == nil && parsed.Host == "api.openai.com"
}

// Mirrors formatSizeForModel in src/services/imageService.ts and functions/managed.ts.
func formatSizeForModel(size, model string) string {
	if strings.HasPrefix(strings.ToLower(model), "dall-e") {
		switch size {
		case "16:9":
			return "1792x1024"
		case "9:16":
			return "1024x1792"
		default:
			return "1024x1024"
		}
	}
	if size == "" || size == "auto" {
		return "auto"
	}
	if strings.Contains(size, "x") {
		parts := strings.SplitN(size, "x", 2)
		width, errWidth := strconv.ParseFloat(parts[0], 64)
		height, errHeight := strconv.ParseFloat(parts[1], 64)
		if errWidth != nil || errHeight != nil {
			return size
		}
		if width > 0 && height > 0 {
			ratio := width / height
			switch {
			case width == height:
				return "1:1"
			case absFloat(ratio-16.0/9.0) < 0.05:
				return "16:9"
			case absFloat(ratio-9.0/16.0) < 0.05:
				return "9:16"
			case absFloat(ratio-4.0/3.0) < 0.05:
				return "4:3"
			case absFloat(ratio-3.0/4.0) < 0.05:
				return "3:4"
			}
		}
	}
	return size
}

func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

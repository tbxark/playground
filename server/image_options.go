package main

import (
	"slices"
	"strings"
	"unicode/utf8"
)

// Mirrors shared/imageModels.ts (capability table, option validation and the
// option -> upstream payload mapping) for APIMart gpt-image-2.5 / 2.6 models.
// Change both together.

const (
	defaultSVGModel          = "gpt-5.4-mini"
	safetyIdentifierMaxChars = 128
)

var (
	imageQualities    = []string{"low", "medium", "high", "xhigh", "max"}
	imageBackgrounds  = []string{"auto", "opaque", "transparent"}
	imageModerations  = []string{"auto", "low"}
	imageComplexities = []string{"low", "medium", "high"}
	imageVersions     = []string{"flare", "sunburst"}
	svgEfforts        = []string{"none", "minimal", "low", "medium", "high", "xhigh", "max"}
)

type imageCaps struct {
	family string // "2.5" or "2.6"
	ext    bool
}

// imageCapsFor resolves a model id by containment; nil for every other model.
func imageCapsFor(model string) *imageCaps {
	id := strings.ToLower(model)
	var family string
	switch {
	case strings.Contains(id, "gpt-image-2.6"):
		family = "2.6"
	case strings.Contains(id, "gpt-image-2.5"):
		family = "2.5"
	default:
		return nil
	}
	return &imageCaps{family: family, ext: isExtModelID(id)}
}

// isExtModelID matches an `ext` segment delimited by -, _ or . (or the ends).
func isExtModelID(id string) bool {
	for _, part := range strings.FieldsFunc(id, func(r rune) bool {
		return r == '-' || r == '_' || r == '.'
	}) {
		if part == "ext" {
			return true
		}
	}
	return false
}

func (c *imageCaps) v26() bool { return c.family == "2.6" }

func (c *imageCaps) formats() []string {
	switch {
	case c.v26():
		return []string{"png", "jpeg", "webp", "gif", "svg"}
	case c.ext:
		return nil
	default:
		return []string{"png", "jpeg", "webp"}
	}
}

func (c *imageCaps) quality() bool          { return c.v26() || !c.ext }
func (c *imageCaps) compression() bool      { return !c.ext }
func (c *imageCaps) background() bool       { return !c.ext }
func (c *imageCaps) moderation() bool       { return !c.ext }
func (c *imageCaps) complexity() bool       { return c.v26() }
func (c *imageCaps) version() bool          { return c.ext }
func (c *imageCaps) gifFrames() bool        { return c.v26() && !c.ext }
func (c *imageCaps) svg() bool              { return c.v26() }
func (c *imageCaps) safetyIdentifier() bool { return c.v26() && !c.ext }
func (c *imageCaps) mask() bool             { return !c.ext }

// maskFieldName is `mask_url` on the documented models, `mask` elsewhere.
func maskFieldName(model string) string {
	if caps := imageCapsFor(model); caps != nil && caps.mask() {
		return "mask_url"
	}
	return "mask"
}

// managedImageOptions is the `options` object of a managed generate request.
// Zero values mean "not provided".
type managedImageOptions struct {
	OutputFormat       string `json:"outputFormat"`
	Quality            string `json:"quality"`
	OutputCompression  *int   `json:"outputCompression"`
	Background         string `json:"background"`
	Moderation         string `json:"moderation"`
	Complexity         string `json:"complexity"`
	Version            string `json:"version"`
	FrameCount         *int   `json:"frameCount"`
	FrameDurationMs    *int   `json:"frameDurationMs"`
	SvgReasoningEffort string `json:"svgReasoningEffort"`
	SafetyIdentifier   string `json:"safetyIdentifier"`
}

func (o *managedImageOptions) empty() bool {
	return o == nil || *o == managedImageOptions{}
}

// imageOptionFields validates the options for the model and returns the extra
// upstream payload fields, or an error code. The SVG text model is fixed by the
// server so users cannot choose a billed model.
func imageOptionFields(model string, o *managedImageOptions, svgModel string) (map[string]any, string) {
	if o.empty() {
		return nil, ""
	}
	caps := imageCapsFor(model)
	if caps == nil {
		return nil, "options_unsupported"
	}
	const invalid = "invalid_request"
	fields := map[string]any{}

	format := "png"
	if o.OutputFormat != "" {
		if !slices.Contains(caps.formats(), o.OutputFormat) {
			return nil, invalid
		}
		format = o.OutputFormat
		if format != "png" {
			fields["output_format"] = format
		}
	}
	if o.Quality != "" {
		if !caps.quality() || !slices.Contains(imageQualities, o.Quality) {
			return nil, invalid
		}
		fields["quality"] = o.Quality
	}
	if o.OutputCompression != nil {
		if !caps.compression() || (format != "jpeg" && format != "webp") ||
			*o.OutputCompression < 0 || *o.OutputCompression > 100 {
			return nil, invalid
		}
		fields["output_compression"] = *o.OutputCompression
	}
	if o.Background != "" {
		if !caps.background() || !slices.Contains(imageBackgrounds, o.Background) ||
			(format != "png" && format != "webp") {
			return nil, invalid
		}
		fields["background"] = o.Background
	}
	if o.Moderation != "" {
		if !caps.moderation() || !slices.Contains(imageModerations, o.Moderation) {
			return nil, invalid
		}
		fields["moderation"] = o.Moderation
	}
	if o.Complexity != "" {
		if !caps.complexity() || !slices.Contains(imageComplexities, o.Complexity) {
			return nil, invalid
		}
		fields["complexity"] = o.Complexity
	}
	if o.Version != "" {
		if !caps.version() || !slices.Contains(imageVersions, o.Version) {
			return nil, invalid
		}
		fields["version"] = o.Version
	}
	if o.FrameCount != nil {
		if !caps.gifFrames() || format != "gif" || *o.FrameCount < 2 || *o.FrameCount > 16 {
			return nil, invalid
		}
		fields["frame_count"] = *o.FrameCount
	}
	if o.FrameDurationMs != nil {
		if !caps.gifFrames() || format != "gif" || *o.FrameDurationMs < 20 || *o.FrameDurationMs%10 != 0 {
			return nil, invalid
		}
		fields["frame_duration_ms"] = *o.FrameDurationMs
	}
	if o.SvgReasoningEffort != "" {
		if !caps.svg() || format != "svg" || !slices.Contains(svgEfforts, o.SvgReasoningEffort) {
			return nil, invalid
		}
	}
	if format == "svg" {
		if svgModel == "" {
			svgModel = defaultSVGModel
		}
		svg := map[string]any{"model": svgModel}
		if o.SvgReasoningEffort != "" {
			svg["reasoning"] = map[string]any{"effort": o.SvgReasoningEffort}
		}
		fields["svg"] = svg
	}
	if o.SafetyIdentifier != "" {
		if !caps.safetyIdentifier() || utf8.RuneCountInString(o.SafetyIdentifier) > safetyIdentifierMaxChars {
			return nil, invalid
		}
		fields["safety_identifier"] = o.SafetyIdentifier
	}
	return fields, ""
}

import { GenerateParams, ProviderConfig } from "../types";
import { generateImageWithOpenAiCompatible } from "../imageService";
import { i18n } from "@/i18n";

export const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: i18n.t("prov.dispatcher.openaiCompatibleLabel"),
    apiBaseUrl: "https://api.openai.com/v1",
    apiKey: "",
    capabilities: {
      supportsText2Image: true,
      supportsImage2Image: true,
      supportsInpainting: true,
      supportsOutpainting: true,
      supportsNegativePrompt: true,
      supportsCustomSize: true,
      supportsSeed: true,
    },
    // No built-in model catalog: models come from the user's enabled list in useConfigStore
    models: [],
  },
];

export async function dispatchGenerate(
  provider: ProviderConfig,
  params: GenerateParams
): Promise<string> {
  const apiKey = provider.apiKey;
  const apiBaseUrl = provider.apiBaseUrl;

  return generateImageWithOpenAiCompatible(
    {
      apiBaseUrl,
      apiKey,
      corsProxy: params.corsProxy,
      corsProxyMode: params.corsProxyMode,
    },
    params
  );
}

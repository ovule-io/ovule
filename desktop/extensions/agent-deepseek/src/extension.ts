import { defineExtension, defineModelProvider } from "@ovule/extension";
import type { JsonValue, ModelProviderAdapter } from "@ovule/extension";

const extension = {
  prepare(input: JsonValue) {
    const model =
      input &&
      typeof input === "object" &&
      !Array.isArray(input) &&
      typeof input.model === "string"
        ? input.model
        : "deepseek-flash";
    if (!isModelId(model)) {
      throw new TypeError("invalid DeepSeek model id");
    }
    return {
      provider: "deepseek",
      apiBase: "https://api.deepseek.com",
      credentialReference: "DEEPSEEK_API_KEY",
      model,
    };
  },
} satisfies ModelProviderAdapter;

function isModelId(value: string): boolean {
  return (
    value.length <= 160 &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]*[A-Za-z0-9])?$/.test(value)
  );
}

export default defineExtension({
  id: "io.ovule.provider.deepseek",
  apiVersion: 1,
  capabilities: ["model-provider"],
  modelProviders: { deepseek: defineModelProvider(extension) },
});

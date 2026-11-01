import { describe, expect, test } from "bun:test";
import { agentModelOptions, discoveredModelCatalogId } from "./catalog-models";

describe("catalog model mapping", () => {
  test("filters by agent and de-duplicates provider targets", () => {
    const catalog = [
      {
        id: "configured",
        label: "Configured",
        provider: "openai",
        remoteId: "gpt-x",
        enabled: true,
        recommended: true,
        description: "",
        agentIds: ["codex"],
      },
    ];
    const discovered = [
      {
        id: "detected",
        label: "Detected duplicate",
        provider: "openai",
        remoteId: "gpt-x",
        available: true,
        recommended: false,
        detail: "",
        agentId: "codex",
      },
    ];
    expect(agentModelOptions(catalog, discovered, "codex", "").map((model) => model.id)).toEqual([
      "configured",
    ]);
  });

  test("keeps the selected model and creates safe catalog ids", () => {
    const discovered = {
      id: "Vendor / Model 1",
      label: "Model",
      provider: "vendor",
      remoteId: "model-1",
      available: true,
      recommended: false,
      detail: "",
      agentId: "other",
    };
    expect(agentModelOptions([], [discovered], "codex", discovered.id)).toHaveLength(1);
    expect(discoveredModelCatalogId(discovered)).toBe("discovered-vendor---model-1");
  });
});

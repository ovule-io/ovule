import { describe, expect, test } from "bun:test";

import type { WorkspaceApi } from "./contract";
import { mockWorkspaceApi } from "./mock-adapter";
import { resolveWorkspaceApi, workspaceBindingUrl } from "./native-adapter";

const requiredMethods = [
  "snapshot",
  "extensionCatalog",
  "onboardingStatus",
  "runExtensionSetupAction",
  "installExtension",
  "setExtensionEnabled",
  "removeExtension",
  "cleanOnboardingState",
  "cleanLegacyData",
  "createThread",
  "sendMessage",
  "cancelAttempt",
  "forkMessage",
  "restartMessage",
  "readWorkspaceFile",
  "readMarkdown",
  "startTerminal",
  "createGoal",
] as const satisfies readonly (keyof WorkspaceApi)[];

function expectWorkspaceContract(adapter: WorkspaceApi) {
  for (const method of requiredMethods) expect(adapter[method]).toBeFunction();
}

describe("workspace adapters", () => {
  test("mock adapter implements the stable workspace contract", () => {
    expectWorkspaceContract(mockWorkspaceApi);
  });

  test("native adapter loads the binding once and returns its module exports", async () => {
    let loads = 0;
    const bridge = mockWorkspaceApi;
    const adapter = await resolveWorkspaceApi({
      native: true,
      protocol: "ovule:",
      loadBinding: async () => {
        loads += 1;
        return bridge;
      },
      mock: mockWorkspaceApi,
    });
    expect(loads).toBe(1);
    expect(adapter).toBe(bridge);
    expectWorkspaceContract(adapter);
  });

  test("packaged startup never loads prototype data and web fallback loads it on demand", async () => {
    let mockLoads = 0;
    const mock = async () => {
      mockLoads++;
      return mockWorkspaceApi;
    };
    expect(
      await resolveWorkspaceApi({
        native: true,
        protocol: "ovule:",
        loadBinding: async () => mockWorkspaceApi,
        mock,
      }),
    ).toBe(mockWorkspaceApi);
    expect(mockLoads).toBe(0);
    await expect(
      resolveWorkspaceApi({
        native: false,
        protocol: "ovule:",
        loadBinding: async () => undefined,
        mock,
      }),
    ).rejects.toThrow("native bridge is unavailable");
    expect(mockLoads).toBe(0);
    expect(
      await resolveWorkspaceApi({
        native: false,
        protocol: "http:",
        loadBinding: async () => undefined,
        mock,
      }),
    ).toBe(mockWorkspaceApi);
    expect(mockLoads).toBe(1);
  });

  test("web adapter falls back to the mock and packaged URLs stay origin independent", async () => {
    const adapter = await resolveWorkspaceApi({
      native: false,
      protocol: "https:",
      loadBinding: async () => undefined,
      mock: mockWorkspaceApi,
    });
    expect(adapter).toBe(mockWorkspaceApi);
    expect(workspaceBindingUrl("ovule:", "null", "/nested/")).toBe("ovule://-/shell_api.js");
  });
});

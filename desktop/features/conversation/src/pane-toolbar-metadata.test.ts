import { expect, test } from "bun:test";
import { handleRootRequest } from "./ThreadSurface";

test("pane metadata forwards serializable toolbar state and filters invalid entries", async () => {
  const updates: unknown[] = [];
  const services = {
    workbench: { updateTab: (id: string, values: unknown) => updates.push([id, values]) },
  } as unknown as Parameters<typeof handleRootRequest>[2];
  const result = await handleRootRequest(
    "tab.metadata",
    {
      tabId: "remote-pane",
      toolbarState: {
        status: "connected",
        mode: "relay",
        quality: "detail",
        invalid: { nested: true },
      },
    },
    services,
    () => {},
  );
  expect(result).toEqual({ updated: true });
  expect(updates).toEqual([
    ["remote-pane", { toolbarState: { status: "connected", mode: "relay", quality: "detail" } }],
  ]);
  await handleRootRequest(
    "tab.metadata",
    { tabId: "remote-pane", toolbarState: ["invalid"], title: "Remote desktop" },
    services,
    () => {},
  );
  expect(updates[1]).toEqual(["remote-pane", { title: "Remote desktop" }]);
});

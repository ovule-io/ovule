import { expect, test } from "bun:test";
import { createLinkService } from "./link-service";
import type { LinkOpening } from "@ovule/settings/preferences/preferences";

test("link routing reads the current preference for setup, cards and conversation links", async () => {
  let mode: LinkOpening = "overlay";
  const overlays: unknown[] = [];
  const tabs: unknown[] = [];
  const system: string[] = [];
  const links = createLinkService({
    preferences: { current: () => ({ theme: "system", linkOpening: mode }) },
    overlays: {
      openExplorer: (request) => {
        overlays.push(request);
      },
    },
    panes: {
      openTab: (kind, options) => {
        tabs.push({ kind, ...options });
        return "tab";
      },
    },
    openSystem: async (url) => {
      system.push(url);
    },
  });
  const request = {
    target: "https://platform.deepseek.com/",
    threadId: "chat",
    navigation: "allow" as const,
  };
  await links.open(request);
  expect(overlays).toEqual([request]);
  mode = "new-tab";
  await links.open(request);
  expect(tabs.at(-1)).toMatchObject({
    kind: "browser",
    placement: "thread",
    threadId: "chat",
    newInstance: true,
    navigation: "allow",
  });
  await links.open({ target: request.target });
  expect(tabs.at(-1)).toMatchObject({ placement: "workbench" });
  mode = "workbench";
  await links.open(request);
  expect(tabs.at(-1)).toMatchObject({ placement: "workbench", autoLoad: true });
  mode = "system";
  await links.open(request);
  expect(system).toEqual([request.target]);
  await links.open({ target: "javascript:alert(1)" });
  expect(system).toHaveLength(1);
  expect(overlays).toHaveLength(1);
});

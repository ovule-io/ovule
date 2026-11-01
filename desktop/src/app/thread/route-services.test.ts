import workflowTokens from "@ovule/workflow/workflow.token";
import conversationTokens from "@ovule/conversation/conversation.token";
import { expect, test } from "bun:test";
import { createRegistry, createScope } from "@ovule/ioc-container";
import { registerDesktopServices } from "../services";

test("application composition exposes the goal draft hook through its typed token", async () => {
  const scope = createScope(registerDesktopServices(createRegistry()));
  expect(typeof scope.get(workflowTokens.routeRuntime).useGoalDraft).toBe("function");
  await scope.dispose();
});

import { registerThreadServices } from "./services";

test("thread scopes own message runtime and composer while sharing app state", async () => {
  const app = createScope(registerDesktopServices(createRegistry()));
  const first = createScope(registerThreadServices(createRegistry()), app);
  const second = createScope(registerThreadServices(createRegistry()), app);
  try {
    expect(app.has(conversationTokens.messageRouteRuntime)).toBe(false);
    expect(
      typeof first.get(conversationTokens.messageRouteRuntime).initializeExtensionMessageBlocks,
    ).toBe("function");
    expect(first.get(conversationTokens.stateController)).toBe(
      app.get(conversationTokens.stateController),
    );
    expect(second.get(conversationTokens.stateController)).toBe(
      app.get(conversationTokens.stateController),
    );
    const firstComposer = first.get(conversationTokens.composer);
    const secondComposer = second.get(conversationTokens.composer);
    firstComposer.setText("first thread draft");
    expect(secondComposer.current().text).toBe("");
    expect(first.get(conversationTokens.messagePresentationRegistry)).not.toBe(
      second.get(conversationTokens.messagePresentationRegistry),
    );
  } finally {
    await app.dispose();
  }
});

import settingsTokens from "@ovule/settings/settings.token";
import sidebarTokens from "@ovule/sidebar/sidebar.token";
import type { WorkspaceApi } from "@ovule/workspace/contract";
import type { WorkspaceService } from "@ovule/workspace/workspace";
import type { ExtensionCatalogView } from "@ovule/settings/extensions/extensions";

test("settings keeps app preferences shared and extension catalogs local to each thread", async () => {
  let reads = 0;
  const workspace = {
    api: async () =>
      ({
        extensionCatalog: async () =>
          ({ extensions: [], read: ++reads }) as unknown as ExtensionCatalogView,
      }) as unknown as WorkspaceApi,
  } as WorkspaceService;
  const app = createScope(registerDesktopServices(createRegistry(), { workspace }));
  const first = createScope(registerThreadServices(createRegistry()), app);
  const second = createScope(registerThreadServices(createRegistry()), app);
  try {
    const preferences = app.get(settingsTokens.preferences);
    preferences.setTheme("dark");
    expect(first.get(settingsTokens.preferences)).toBe(preferences);
    expect(second.get(settingsTokens.preferences).current().theme).toBe("dark");
    expect(app.has(settingsTokens.extensionCatalog)).toBe(false);
    const firstCatalog = await first.getAsync(settingsTokens.extensionCatalog);
    expect(await first.getAsync(settingsTokens.extensionCatalog)).toBe(firstCatalog);
    expect(await second.getAsync(settingsTokens.extensionCatalog)).not.toBe(firstCatalog);
    expect(reads).toBe(2);
  } finally {
    await app.dispose();
  }
});

test("thread switching remains available without a sidebar view instance", async () => {
  const app = createScope(registerDesktopServices(createRegistry()));
  try {
    expect(app.has(sidebarTokens.sidebarView)).toBe(false);
    expect(app.get(sidebarTokens.threadSwitcherRouteRuntime).ThreadSwitcherDialog).toBeDefined();
    expect(app.get(conversationTokens.selection)).toBeDefined();
  } finally {
    await app.dispose();
  }
});

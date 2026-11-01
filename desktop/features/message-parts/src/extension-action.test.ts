import { expect, test } from "bun:test";
import type { WorkspaceApi } from "@ovule/workspace/contract";
import { isMessageBlockAction, runMessageBlockAction } from "./extension-action";

test("message block action IDs follow the production bridge grammar", () => {
  expect(isMessageBlockAction("open-external")).toBe(true);
  expect(isMessageBlockAction("openExternal")).toBe(false);
  expect(isMessageBlockAction(undefined)).toBe(false);
});

test("extension authorization uses the configured link destination and stays bound to its declaring extension", async () => {
  const inputs: unknown[] = [],
    opened: unknown[] = [],
    reported: unknown[] = [];
  const api = {
    runExtensionAction: async (input: unknown) => {
      inputs.push(input);
      return {
        dataJson: '{"phase":"authorizing"}',
        openUrl: "https://dash.cloudflare.com/oauth2/auth?state=fixture",
      };
    },
  } as unknown as WorkspaceApi;
  await runMessageBlockAction(
    {
      api: async () => api,
      requestBrowserUse: (...args) => {
        opened.push(args);
      },
    },
    "io.ovule.connectivity.cloudflare",
    { action: "open" },
    "Invalid JSON",
    (value) => reported.push(value),
  );
  expect(inputs).toEqual([
    {
      extensionId: "io.ovule.connectivity.cloudflare",
      actionId: "open",
      connectionId: undefined,
      threadId: undefined,
    },
  ]);
  expect(opened).toEqual([["https://dash.cloudflare.com/oauth2/auth?state=fixture"]]);
  expect(reported).toEqual([{ action: "open", data: { phase: "authorizing" } }]);
});
test("failed actions and malformed results do not open a browser", async () => {
  for (const response of ["malformed", "rejected"]) {
    const opened: unknown[] = [],
      reported: unknown[] = [];
    const api = {
      runExtensionAction: async () => {
        if (response === "rejected") throw new Error("Authorization cancelled");
        return { dataJson: "bad-json", openUrl: "https://dash.cloudflare.com/" };
      },
    } as unknown as WorkspaceApi;
    await runMessageBlockAction(
      {
        api: async () => api,
        requestBrowserUse: (...args) => {
          opened.push(args);
        },
      },
      "fixture",
      { action: "login" },
      "Invalid JSON",
      (value) => reported.push(value),
    );
    expect(opened).toEqual([]);
    expect(reported).toEqual([
      {
        action: "login",
        error: response === "rejected" ? "Authorization cancelled" : "Invalid JSON",
      },
    ]);
  }
});

test("channel binding forwards a selected Thread and supports clearing the binding", async () => {
  const inputs: unknown[] = [];
  const api = {
    runExtensionAction: async (input: unknown) => {
      inputs.push(input);
      return { dataJson: "{}" };
    },
  } as unknown as WorkspaceApi;
  for (const threadId of ["thread-target", ""]) {
    await runMessageBlockAction(
      {
        api: async () => api,
        requestBrowserUse: () => {
          throw new Error("Binding must not navigate");
        },
      },
      "io.ovule.channel.lark",
      { action: "bind-thread", connectionId: "product-bot", threadId },
      "Invalid JSON",
      () => {},
    );
  }
  expect(inputs).toEqual(
    ["thread-target", ""].map((threadId) => ({
      extensionId: "io.ovule.channel.lark",
      actionId: "bind-thread",
      connectionId: "product-bot",
      threadId,
    })),
  );
});

test("refreshing a saved setup card does not reopen its authorization page", async () => {
  const opened: unknown[] = [];
  const api = {
    runExtensionAction: async () => ({ dataJson: "{}", openUrl: "https://example.com/setup" }),
  } as unknown as WorkspaceApi;
  await runMessageBlockAction(
    {
      api: async () => api,
      requestBrowserUse: (...args) => {
        opened.push(args);
      },
    },
    "fixture",
    { action: "refresh" },
    "Invalid JSON",
    () => {},
  );
  expect(opened).toEqual([]);
});

test("pending channel actions poll read-only status while keeping progress visible", async () => {
  const actions: string[] = [],
    reported: { pending?: boolean }[] = [],
    opened: unknown[] = [];
  const api = {
    runExtensionAction: async (input: { actionId: string }) => {
      actions.push(input.actionId);
      return {
        dataJson: JSON.stringify({
          connections: [
            {
              connectionId: "bot",
              state: actions.length === 1 ? "registering" : "waiting_for_authorization",
            },
          ],
        }),
        openUrl: actions.length === 1 ? undefined : "https://example.com/authorize",
      };
    },
  } as unknown as WorkspaceApi;
  await runMessageBlockAction(
    {
      api: async () => api,
      requestBrowserUse: (...args) => {
        opened.push(args);
      },
    },
    "fixture",
    { action: "connect-existing", connectionId: "bot" },
    "Invalid JSON",
    (result) => reported.push(result),
  );
  expect(actions).toEqual(["connect-existing", "status"]);
  expect(reported.map((item) => item.pending)).toEqual([true, undefined]);
  expect(opened).toEqual([["https://example.com/authorize"]]);
});

test("a failed status poll reports an error and releases the setup card", async () => {
  let calls = 0;
  const reported: { error?: string; pending?: boolean }[] = [];
  const api = {
    runExtensionAction: async () => {
      if (++calls > 1) throw new Error("Worker stopped");
      return { dataJson: '{"connections":[{"connectionId":"bot","state":"refreshing"}]}' };
    },
  } as unknown as WorkspaceApi;
  await runMessageBlockAction(
    {
      api: async () => api,
      requestBrowserUse: () => {
        throw new Error("must not navigate");
      },
    },
    "fixture",
    { action: "refresh", connectionId: "bot" },
    "Invalid JSON",
    (result) => reported.push(result),
  );
  expect(reported.at(-1)).toEqual({ action: "refresh", error: "Worker stopped" });
});

test("unmounted setup cards do not open authorization or keep polling", async () => {
  const controller = new AbortController();
  const api = {
    runExtensionAction: async () => {
      controller.abort();
      return {
        dataJson: '{"connections":[{"state":"registering"}]}',
        openUrl: "https://example.com/authorize",
      };
    },
  } as unknown as WorkspaceApi;
  const reported: unknown[] = [];
  await runMessageBlockAction(
    {
      api: async () => api,
      requestBrowserUse: () => {
        throw new Error("must not navigate");
      },
    },
    "fixture",
    { action: "connect-existing" },
    "Invalid JSON",
    (result) => reported.push(result),
    controller.signal,
  );
  expect(reported).toEqual([]);
});

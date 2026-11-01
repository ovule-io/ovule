import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { createInstance } from "i18next";
import en from "../features/i18n/src/locales/en.json";
import { LarkGateContent } from "../features/workflow/src/presentation/LarkGate";
import type { WorkspaceService } from "../features/workspace/src/workspace";
import type { GateConnection, LarkGateKind } from "../features/workflow/src/presentation/lark-gate";

Object.assign(window, {
  smokeLarkGate: async () => {
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: en } } });
    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;inset:40px;background:white;color:black;padding:24px;z-index:999999;overflow:auto";
    document.body.append(host);
    const root = createRoot(host);
    let connections: GateConnection[] = [];
    let approvals = 0;
    let rejections = 0;
    const opened: unknown[] = [];
    const calls: string[] = [];
    let registering = 0;
    const workspace = {
      api: async () => ({
        extensionCatalog: async () => ({
          messageBlocks: [{ extensionId: "io.ovule.channel.lark", hostRenderer: "channel-setup" }],
        }),
        runExtensionAction: async ({ actionId }: { actionId: string }) => {
          calls.push(actionId);
          if (actionId === "connect-existing") {
            registering = 1;
            return {
              dataJson: JSON.stringify({
                connections: [{ connectionId: "default", state: "registering" }],
              }),
            };
          }
          if (registering) {
            registering = 0;
            return {
              dataJson: JSON.stringify({ connections }),
              openUrl: "https://open.feishu.cn/mock-authorization",
            };
          }
          return { dataJson: JSON.stringify({ connections }) };
        },
      }),
      requestBrowserUse: (...args: unknown[]) => opened.push(args),
    } as unknown as WorkspaceService;
    const wait = async (predicate: () => boolean) => {
      const end = Date.now() + 8000;
      while (!predicate()) {
        if (Date.now() > end) throw new Error(`Lark Gate fixture timed out: ${host.textContent}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    const mount = async (kind: LarkGateKind, key: string) => {
      root.render(
        createElement(
          I18nextProvider,
          { i18n },
          createElement(LarkGateContent, {
            key,
            workspace,
            kind,
            threadId: "main",
            waiting: true,
            onReject: async () => {
              rejections++;
            },
            onVerified: async () => {
              approvals++;
            },
          }),
        ),
      );
      await wait(() => host.querySelector("section")?.getAttribute("aria-busy") === "false");
    };
    try {
      await mount("authorization", "auth");
      if (approvals || host.querySelector("select"))
        throw new Error("Unconfigured bot must not approve or show an empty selector");
      Array.from(host.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Open Feishu"))!
        .click();
      await wait(() => opened.length === 1);
      if (
        JSON.stringify(opened[0]) !==
        JSON.stringify(["https://open.feishu.cn/mock-authorization", "workbench"])
      )
        throw new Error("Authorization must open in Workbench");
      if (approvals) throw new Error("Opening authorization is not completion evidence");
      connections = [
        { connectionId: "default", configured: true, provisioned: true, connected: true },
      ];
      await wait(() => approvals === 1);
      await mount("credentials", "credentials");
      await wait(() => approvals === 2);
      connections = [
        { connectionId: "default", configured: true, connected: true, pairingCode: "654321" },
      ];
      await mount("pair", "pair");
      await wait(() => host.querySelector("code")?.textContent === "/pair 654321");
      if (approvals !== 2) throw new Error("Pairing code alone cannot complete a Gate");
      connections = [
        { connectionId: "default", configured: true, connected: true, ownerPaired: true },
      ];
      await wait(() => approvals === 3);
      connections = [
        { connectionId: "default", configured: true, provisioned: true },
        { connectionId: "other", configured: true, provisioned: true },
      ];
      await mount("authorization", "multi");
      await wait(() => host.querySelectorAll("option").length === 3);
      if (approvals !== 3) throw new Error("Multiple bots require an explicit selection");
      const select = host.querySelector("select")!;
      select.value = "other";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(() => approvals === 4);
      connections = [
        {
          connectionId: "default",
          configured: true,
          state: "error",
          detail: "Bot identity lookup failed",
        },
      ];
      await mount("authorization", "manual-after-error");
      await wait(
        () => host.querySelector('[role="alert"]')?.textContent === "Bot identity lookup failed",
      );
      if (approvals !== 4) throw new Error("Failed status must not automatically approve a Gate");
      (host.querySelector("[data-lark-gate-continue]") as HTMLButtonElement).click();
      await wait(() => approvals === 5);
      if (connections[0].state !== "error")
        throw new Error("Manual continuation must not fabricate a healthy connection");
      connections = [
        {
          connectionId: "default",
          configured: true,
          connected: false,
          pairingCode: "654321",
          state: "error",
          detail: "tenant_access_token failed: 21001 Access denied by access control policy",
        },
      ];
      await mount("pair", "blocked-pair");
      await wait(() => host.textContent?.includes("Feishu denied the app access token") === true);
      if (host.querySelector("code"))
        throw new Error("Disconnected bot must not invite sending an unusable pairing command");
      if (approvals !== 5) throw new Error("Policy denial must not automatically complete pairing");
      const continuation = host.querySelector("[data-lark-gate-continue]") as HTMLButtonElement;
      const footer = continuation.closest("[data-lark-gate-actions]")!;
      const reject = Array.from(footer.querySelectorAll("button")).find(
        (button) => button.textContent === "Reject",
      )!;
      if (!reject || reject.parentElement !== continuation.parentElement)
        throw new Error("Gate continuation and rejection must share one footer");
      if (
        Math.abs(reject.getBoundingClientRect().top - continuation.getBoundingClientRect().top) > 1
      )
        throw new Error("Gate footer actions must align in one row");
      if ((host.querySelector("[data-lark-error-details]") as HTMLDetailsElement).open)
        throw new Error("Raw SDK error details should be collapsed");
      if (host.querySelectorAll('[role="alert"]').length !== 1)
        throw new Error("Policy denial must have one concise alert");
      reject.click();
      await wait(() => rejections === 1);

      return {
        approvals,
        rejections,
        footerAligned: true,
        authorizationPlacement: opened,
        calls: calls.length,
        pairCommand: "/pair 654321",
      };
    } finally {
      root.unmount();
      host.remove();
    }
  },
});

import "./lark-gate-fixture";
import { createInstance } from "i18next";
import en from "../features/i18n/src/locales/en.json";
import { registerHostChannelSetupBlock } from "../features/message-parts/src/HostChannelSetupBlock";
import { runMessageBlockAction } from "../features/message-parts/src/extension-action";

const i18n = createInstance();
void i18n.init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { defaultVariables: { brandName: "Ovule" } },
  initImmediate: false,
});
registerHostChannelSetupBlock(customElements, "ovule-channel-card-smoke", i18n);
const block = document.createElement("ovule-channel-card-smoke");
block.id = "channel-card-smoke";
block.style.cssText =
  "position:fixed;left:24px;top:24px;width:min(720px,calc(100vw - 48px));max-height:calc(100vh - 48px);z-index:99999;background:var(--background);overflow:auto";
const state = { results: [] as unknown[], opened: [] as string[], failNext: false };
Object.assign(window, { channelCardSmoke: state });
block.addEventListener("ovule:extension-action", (event) => {
  const detail = (event as CustomEvent).detail;
  void runMessageBlockAction(
    {
      api: async () => {
        if (state.failNext) {
          state.failNext = false;
          throw new Error("Fixture connection interrupted");
        }
        const api = await import("@ovule/shell-api");
        return {
          ...api.workspace,
          ...api.extensions,
          ...api.setup,
          ...api.workflow,
          ...api.message,
          ...api.content,
          ...api.terminal,
          ...api.settings,
        };
      },
      requestBrowserUse: (url) => {
        state.opened.push(url);
      },
    },
    (window as Window & { channelCardExtensionId: string }).channelCardExtensionId,
    detail,
    "Invalid JSON",
    (result) => {
      state.results.push(result);
      block.dispatchEvent(new CustomEvent("ovule:extension-action-result", { detail: result }));
    },
  );
});
const host = document.createElement("div");
host.attachShadow({ mode: "open" }).append(block);
Object.assign(window, { channelCardElement: block });
document.body.append(host);

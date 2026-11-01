import type { FrameworkLayoutService } from "./framework";
import tokens from "./framework.token";
import { createFrameworkLayoutService, type LayoutStorage } from "./layout-service";
import type { Register } from "@ovule/ioc";
import { FrameworkFactory } from "./FrameworkView";
import { ConversationLayoutFactory } from "./ConversationLayout";
import shellTokens from "@ovule/shell/shell.token";
import { flushSync } from "react-dom";
import { createWorkbenchWindow } from "./workbench-window";
export default function register(
  register: Register,
  options: { storage?: LayoutStorage } = {},
): void {
  register(tokens.frameworkLayout, (dependsOn) => {
    const shell = dependsOn.optional(shellTokens.shell);
    const resize = createWorkbenchWindow();
    const layout: FrameworkLayoutService = createFrameworkLayoutService(
      options.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage),
      shell?.native
        ? async (open, commit) => {
            const framework = document.querySelector<HTMLElement>(".framework");
            const chat = framework?.querySelector<HTMLElement>("[data-workbench-chat]");
            const panel = framework?.querySelector<HTMLElement>("[data-workbench-root]");
            const expanded = layout.current().workbenchExpanded;
            const panelWidth =
              !open && panel && !expanded
                ? Math.round(panel.getBoundingClientRect().width)
                : layout.current().workbenchWidth;
            if (!open && !expanded) layout.setWorkbenchWidth(panelWidth);
            if (framework && chat && !expanded) {
              framework.style.setProperty(
                "--workbench-chat-width",
                `${chat.getBoundingClientRect().width}px`,
              );
              framework.dataset.workbenchResizing = "true";
            }
            try {
              await resize(await shell.window(), open, panelWidth);
              flushSync(commit);
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
            } finally {
              if (framework) {
                delete framework.dataset.workbenchResizing;
                framework.style.removeProperty("--workbench-chat-width");
              }
            }
          }
        : undefined,
    );
    return layout;
  });
  register(tokens.frameworkView, (dependsOn) => dependsOn(FrameworkFactory));
  register(tokens.conversationLayoutView, (dependsOn) => dependsOn(ConversationLayoutFactory));
}

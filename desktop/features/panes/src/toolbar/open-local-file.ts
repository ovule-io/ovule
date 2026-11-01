import type { ShellService } from "@ovule/shell/shell";
import type { OpenPaneOptions, PanesService } from "@ovule/panes/panes";
import { localPathUrl } from "./directory-url";

export async function openLocalFile({
  dialog,
  panes,
  title,
  options,
}: {
  dialog: ShellService["dialog"];
  panes: Pick<PanesService, "openTab" | "updateTab">;
  title: string;
  options: Pick<OpenPaneOptions, "threadId" | "draftId" | "placement">;
}): Promise<{ opened: boolean }> {
  const selected = await (await dialog()).openFile({ title });
  if (!selected) return { opened: false };
  const id = panes.openTab("browser", {
    ...options,
    newInstance: true,
    target: localPathUrl(selected),
    autoLoad: true,
  });
  panes.updateTab(id, { title: selected.split(/[\\/]/).at(-1) || selected });
  return { opened: true };
}

import shellTokens from "@ovule/shell/shell.token";
import panesTokens from "@ovule/panes/panes.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input } from "@ovule/ui/form";
import { FileDown, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";
import { cn } from "@ovule/ui/cn";
import { InputGroup } from "@ovule/ui/input-group";
import { useService } from "@ovule/ioc/react";

import type { PaneContext } from "@ovule/panes/pane";

import { paneWorkspacePath } from "../pane-workspace";
import toolStyles from "@ovule/ui/tool-panels.module.css";

const extensions = [
  "md",
  "markdown",
  "docx",
  "dotx",
  "xlsx",
  "xlsm",
  "csv",
  "pptx",
  "pptm",
  "ppsx",
  "pdf",
];

type LocalFilesPanelDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
  panes: ServiceOf<typeof panesTokens.paneRegistry>;
};

function LocalFilesPanelContent({
  dependencies,
  props,
}: {
  dependencies: LocalFilesPanelDependencies;
  props: PaneContext;
}) {
  const { workspaceRelativePath } = useService(shellTokens.shell);

  const { shell, panes } = dependencies;
  const context = props;

  const { t } = useTranslation();
  const workspacePath = paneWorkspacePath(context);
  const [path, setPath] = useState(context.target ?? "");
  const [openedPath, setOpenedPath] = useState(context.target);
  const [choosing, setChoosing] = useState(false);

  const open = (requested: string) => {
    const value = requested.trim();
    if (!value) return;
    setPath(value);
    setOpenedPath(value);
    void shell
      .requestRoot("tab.metadata", {
        tabId: context.id,
        title: value.split(/[\\/]/).at(-1) || t("harness.localFiles"),
        target: value,
        url: value,
      })
      .catch(console.error);
  };

  const choose = async () => {
    if (choosing) return;
    setChoosing(true);
    try {
      const selected = await (
        await shell.dialog()
      ).openFile({
        title: t("office.chooseTitle"),
        defaultPath: workspacePath,
        extensions: [extensions],
      });
      if (!selected) return;
      open(workspacePath ? (workspaceRelativePath(workspacePath, selected) ?? selected) : selected);
    } finally {
      setChoosing(false);
    }
  };

  useEffect(() => {
    const command = (event: Event) => {
      if ((event as CustomEvent<{ action?: string }>).detail?.action === "choose") void choose();
    };
    window.addEventListener("ovule:pane-command", command);
    return () => window.removeEventListener("ovule:pane-command", command);
  });

  if (openedPath) {
    const kind = /\.(?:md|markdown)$/i.test(openedPath) ? "markdown" : "office";
    const Pane = panes.resolve(kind).component;
    return <Pane {...context} target={openedPath} requestVersion={context.requestVersion + 1} />;
  }

  return (
    <section className={cn("local-files-panel", toolStyles.localFilesPanel)}>
      <div className={cn("local-file-empty", toolStyles.localFileEmpty)}>
        <FolderOpen size={22} />
        <strong className={toolStyles.localFileEmptyTitle}>{t("harness.localFiles")}</strong>
        <InputGroup className={toolStyles.localFileInputGroup}>
          <Input
            className={toolStyles.localFileInput}
            autoFocus
            aria-label={t("office.path")}
            placeholder={t("office.path")}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") open(path);
            }}
          />
          <Button
            aria-label={t("office.open")}
            title={t("office.open")}
            variant="ghost"
            size="icon"
            disabled={!path.trim()}
            onClick={() => open(path)}
          >
            <FileDown />
          </Button>
          <Button
            aria-label={t("office.choose")}
            title={t("office.choose")}
            variant="ghost"
            size="icon"
            disabled={choosing}
            onClick={() => void choose()}
          >
            <FolderOpen />
          </Button>
        </InputGroup>
        <small className={toolStyles.localFileDescription}>{t("office.selectPath")}</small>
      </div>
    </section>
  );
}

export const LocalFilesPanelFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  const panes = dependsOn(panesTokens.paneRegistry);
  const dependencies = { shell, panes };
  return function LocalFilesPanel(props: PaneContext) {
    return createElement(LocalFilesPanelContent, { dependencies, props });
  };
}, "LocalFilesPanel");

export const LocalFilesPanel = (...args: Parameters<ServiceOf<typeof LocalFilesPanelFactory>>) =>
  createElement(useService(LocalFilesPanelFactory), ...args);

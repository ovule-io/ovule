import shellTokens from "@ovule/shell/shell.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input } from "@ovule/ui/form";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { FileDown, FolderOpen, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";
import { cn } from "@ovule/ui/cn";

import { useService } from "@ovule/ioc/react";

import toolStyles from "@ovule/ui/tool-panels.module.css";

type MarkdownPanelDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function MarkdownPanelContent({
  dependencies,
  props,
}: {
  dependencies: MarkdownPanelDependencies;
  props: {
    paneId?: string;
    threadId?: string;
    workspacePath?: string;
    initialPath?: string;
  };
}) {
  const { workspaceRelativePath } = useService(shellTokens.shell);

  const { shell, workspace } = dependencies;
  const { paneId, threadId, workspacePath, initialPath } = props;

  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<Crepe | null>(null);
  const [path, setPath] = useState(initialPath ?? "README.md");
  const [status, setStatus] = useState(() => t("markdown.initial"));
  const [loadedPath, setLoadedPath] = useState<string>();
  const [hasError, setHasError] = useState(false);
  const [ready, setReady] = useState(false);
  const [choosing, setChoosing] = useState(false);

  const updateDocumentPath = (filePath: string) => {
    setLoadedPath(filePath);
    setHasError(false);
    if (!paneId) return;
    void shell
      .requestRoot("tab.metadata", {
        tabId: paneId,
        title: filePath.split(/[\\/]/).at(-1),
        url: filePath,
      })
      .catch(console.error);
  };

  const mount = async (content: string) => {
    if (!root.current) return;
    if (editor.current) await editor.current.destroy();
    setReady(false);
    root.current.replaceChildren();
    const instance = new Crepe({ root: root.current, defaultValue: content });
    editor.current = instance;
    instance.setReadonly(path.startsWith("skill:"));
    await instance.create();
    setReady(true);
  };

  useEffect(
    () => () => {
      if (editor.current) void editor.current.destroy();
    },
    [],
  );

  const open = async (requested = path) => {
    if ((!threadId && !requested.startsWith("skill:")) || !requested.trim()) {
      setHasError(true);
      setStatus(t("markdown.selectPath"));
      return;
    }
    try {
      setHasError(false);
      setStatus(t("markdown.opening"));
      const document = await (await workspace.api()).readMarkdown(threadId ?? "", requested.trim());
      await mount(document.content);
      updateDocumentPath(document.path);
      setStatus(t("markdown.opened", { path: document.path }));
    } catch (error) {
      setHasError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (initialPath) {
      setPath(initialPath);
      void open(initialPath);
    }
  }, [initialPath, threadId]);

  const save = async () => {
    if (path.startsWith("skill:")) return;
    if (!threadId || !editor.current) return;
    try {
      const document = await (
        await workspace.api()
      ).saveMarkdown(threadId, loadedPath ?? path.trim(), editor.current.getMarkdown());
      updateDocumentPath(document.path);
      setStatus(t("markdown.saved", { path: document.path }));
    } catch (error) {
      setHasError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    const command = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "save") void save();
      else if (action === "choose") void chooseMarkdown();
    };
    window.addEventListener("ovule:pane-command", command);
    return () => window.removeEventListener("ovule:pane-command", command);
  });

  const chooseMarkdown = async () => {
    if (!threadId) {
      setHasError(true);
      setStatus(t("markdown.chooseFirst"));
      return;
    }
    if (choosing) return;
    setChoosing(true);
    try {
      const selected = await (
        await shell.dialog()
      ).openFile({
        title: t("markdown.chooseTitle"),
        defaultPath: workspacePath,
        extensions: [["md", "markdown"]],
      });
      if (!selected) return;
      const relative = workspacePath ? workspaceRelativePath(workspacePath, selected) : selected;
      if (!relative) {
        setHasError(true);
        setStatus(t("markdown.outsideWorkspace"));
        return;
      }
      setPath(relative);
      setHasError(false);
      setStatus(t("markdown.opening"));
      const document = await (await workspace.api()).readMarkdown(threadId, relative);
      await mount(document.content);
      updateDocumentPath(document.path);
      setStatus(t("markdown.opened", { path: document.path }));
    } catch (error) {
      setHasError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setChoosing(false);
    }
  };

  return (
    <section className={cn("markdown-panel", toolStyles.markdownPanel)}>
      <div className={toolStyles.markdownToolbar}>
        <Input
          className={toolStyles.toolbarInput}
          aria-label={t("markdown.path")}
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void open();
          }}
        />
        <Button
          aria-label={t("markdown.choose")}
          title={t("markdown.choose")}
          variant="ghost"
          size="icon"
          disabled={!threadId || choosing}
          onClick={() => void chooseMarkdown()}
        >
          <FolderOpen size={14} />
        </Button>
        <Button
          aria-label={t("markdown.open")}
          variant="secondary"
          size="icon"
          onClick={() => void open()}
        >
          <FileDown size={14} />
        </Button>
        <Button
          aria-label={t("markdown.save")}
          size="icon"
          disabled={!ready || path.startsWith("skill:")}
          onClick={() => void save()}
        >
          <Save size={14} />
        </Button>
      </div>
      {hasError && (
        <div className={toolStyles.editorError} role="alert">
          {status}
        </div>
      )}
      <span className="sr-only" role="status">
        {!hasError ? status : ""}
      </span>
      <div ref={root} className={toolStyles.markdownEditor} data-testid="markdown-editor" />
    </section>
  );
}

export const MarkdownPanelFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { shell, workspace };
  return function MarkdownPanel(props: {
    paneId?: string;
    threadId?: string;
    workspacePath?: string;
    initialPath?: string;
  }) {
    return createElement(MarkdownPanelContent, { dependencies, props });
  };
}, "MarkdownPanel");

export const MarkdownPanel = (...args: Parameters<ServiceOf<typeof MarkdownPanelFactory>>) =>
  createElement(useService(MarkdownPanelFactory), ...args);

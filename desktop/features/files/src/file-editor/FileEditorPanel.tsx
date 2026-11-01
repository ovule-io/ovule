import shellTokens from "@ovule/shell/shell.token";
import workspaceTokens from "@ovule/workspace/workspace.token";

import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { Input } from "@ovule/ui/form";
import { FileDown, FolderOpen, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@ovule/ui/button";

import type { FileEditorContributionView, WorkspaceFile } from "@ovule/shell-api";
import { useService } from "@ovule/ioc/react";

import toolStyles from "@ovule/ui/tool-panels.module.css";

import type { IsolatedView } from "@ovule/shell/isolated";

type FileEditorPanelDependencies = {
  shell: ServiceOf<typeof shellTokens.shell>;
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function FileEditorPanelContent({
  dependencies,
  props,
}: {
  dependencies: FileEditorPanelDependencies;
  props: {
    threadId?: string;
    workspacePath?: string;
    initialPath?: string;
  };
}) {
  const { shell, workspace } = dependencies;
  const { threadId, workspacePath, initialPath } = props;

  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<IsolatedView | null>(null);
  const exportId = useRef(0);
  const pendingExport = useRef<{
    id: number;
    bytes: number[];
    resolve(bytes: number[]): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [path, setPath] = useState(initialPath ?? "");
  const [document, setDocument] = useState<WorkspaceFile>();
  const [contribution, setContribution] = useState<FileEditorContributionView>();
  const [status, setStatus] = useState(() => t("office.initial"));
  const [choosing, setChoosing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mountGeneration, setMountGeneration] = useState(0);

  const openPath = useCallback(
    async (requested: string) => {
      if (!threadId || !requested.trim()) {
        setStatus(t("office.selectPath"));
        return;
      }
      try {
        setStatus(t("office.opening"));
        const api = await workspace.api();
        const [next, catalog] = await Promise.all([
          api.readWorkspaceFile(threadId, requested.trim()),
          api.extensionCatalog(),
        ]);
        const match = catalog.fileEditors.find((candidate) =>
          candidate.extensions.includes(next.extension),
        );
        if (!match) {
          setDocument(undefined);
          setContribution(undefined);
          setStatus(t("office.unsupported", { extension: next.extension }));
          return;
        }
        setPath(next.path);
        setDocument(next);
        setContribution(match);
        setDirty(false);
        setMountGeneration((value) => value + 1);
        setStatus(t("office.opened", { path: next.path }));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [t, threadId, workspace],
  );

  useEffect(() => {
    if (initialPath) void openPath(initialPath);
  }, [initialPath, openPath]);

  useEffect(() => {
    const target = host.current;
    if (!target || !document || !contribution) return;
    let active = true;
    let mounted: IsolatedView | undefined;
    void (async () => {
      try {
        const view = await shell.mountIsolated(
          target,
          contribution.extensionId,
          contribution.tag,
          {},
          async ({ method, params }) => {
            if (method === "file.dirty") {
              if (active) setDirty(true);
              return null;
            }
            const value = params as {
              revision?: number;
              offset?: number;
              bytes?: number[];
              done?: boolean;
              message?: string;
            } | null;
            const pending = pendingExport.current;
            if (!pending || value?.revision !== pending.id)
              throw new Error("Unknown export request");
            if (method === "file.exportError") {
              clearTimeout(pending.timer);
              pendingExport.current = null;
              pending.reject(new Error(String(value.message)));
              return null;
            }
            if (
              method !== "file.export" ||
              value.offset !== pending.bytes.length ||
              !Array.isArray(value.bytes) ||
              value.bytes.length > 32768 ||
              pending.bytes.length + value.bytes.length > 16 * 1024 * 1024 ||
              value.bytes.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
            )
              throw new Error("Invalid export chunk");
            pending.bytes.push(...value.bytes);
            if (value.done) {
              clearTimeout(pending.timer);
              pendingExport.current = null;
              pending.resolve(pending.bytes);
            }
            return null;
          },
        );
        mounted = view;
        if (!active) {
          await view.dispose();
          return;
        }
        editor.current = view;
        if (document.bytes.length > 16 * 1024 * 1024) throw new Error("File exceeds 16 MiB");
        for (let offset = 0; offset < document.bytes.length || offset === 0; offset += 32768) {
          if (!active) return;
          const done = offset + 32768 >= document.bytes.length;
          await view.update({
            fileChunk: {
              offset,
              bytes: Array.from(document.bytes.slice(offset, offset + 32768)),
              done,
              ...(done
                ? {
                    metadata: {
                      name: document.name,
                      extension: document.extension,
                      readOnly: contribution.mode !== "editable",
                    },
                  }
                : {}),
            },
          });
        }
      } catch (error) {
        if (active) setStatus(error instanceof Error ? error.message : String(error));
        await mounted?.dispose();
        if (active) editor.current = null;
      }
    })();
    return () => {
      active = false;
      editor.current = null;
      const pending = pendingExport.current;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Editor closed"));
        pendingExport.current = null;
      }
      void mounted?.dispose();
    };
  }, [contribution, document, mountGeneration, shell]);

  const chooseFile = async () => {
    if (!threadId) {
      setStatus(t("office.chooseFirst"));
      return;
    }
    if (choosing) return;
    setChoosing(true);
    try {
      const selected = await (
        await shell.dialog()
      ).openFile({
        title: t("office.chooseTitle"),
        defaultPath: workspacePath,
        extensions: [["docx", "dotx", "xlsx", "xlsm", "csv", "pptx", "pptm", "ppsx", "pdf"]],
      });
      if (!selected) return;
      setPath(selected);
      await openPath(selected);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setChoosing(false);
    }
  };

  const save = async () => {
    if (!threadId || !document || !editor.current || contribution?.mode !== "editable") {
      return;
    }
    try {
      setStatus(t("office.saving"));
      if (pendingExport.current) return;
      const id = ++exportId.current;
      const view = editor.current;
      const bytes = await new Promise<number[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingExport.current = null;
          reject(new Error("Export timed out"));
        }, 30000);
        pendingExport.current = { id, bytes: [], resolve, reject, timer };
        void view.update({ exportRevision: id }).catch((error) => {
          clearTimeout(timer);
          pendingExport.current = null;
          reject(error);
        });
      });
      const saved = await (
        await workspace.api()
      ).saveWorkspaceFile(threadId, document.path, Uint8Array.from(bytes));
      setDocument(saved);
      setDirty(false);
      setStatus(t("office.saved", { path: saved.path }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    const command = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === "save") void save();
      else if (action === "choose") void chooseFile();
    };
    window.addEventListener("ovule:pane-command", command);
    return () => window.removeEventListener("ovule:pane-command", command);
  });

  return (
    <section className={toolStyles.officePanel}>
      <div className={toolStyles.officeToolbar}>
        <Input
          className={toolStyles.toolbarInput}
          aria-label={t("office.path")}
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void openPath(path);
          }}
        />
        <Button
          aria-label={t("office.choose")}
          title={t("office.choose")}
          variant="ghost"
          size="icon"
          disabled={!threadId || choosing}
          onClick={() => void chooseFile()}
        >
          <FolderOpen size={14} />
        </Button>
        <Button
          aria-label={t("office.open")}
          variant="secondary"
          size="icon"
          disabled={!threadId || !path.trim()}
          onClick={() => void openPath(path)}
        >
          <FileDown size={14} />
        </Button>
        <Button
          aria-label={t("office.save")}
          size="icon"
          disabled={!dirty || contribution?.mode !== "editable"}
          onClick={() => void save()}
        >
          <Save size={14} />
        </Button>
      </div>
      <div className={toolStyles.toolStatus}>
        {workspacePath && document && !isAbsoluteFilePath(document.path)
          ? t("office.workspace", { path: workspacePath })
          : ""}
        {dirty ? `${t("office.dirty")} · ` : ""}
        {status}
      </div>
      <div ref={host} className={toolStyles.officeEditorHost} data-testid="office-editor" />
      {!document && (
        <div className={toolStyles.localFileEmpty}>
          <FolderOpen size={22} />
          <strong className={toolStyles.localFileEmptyTitle}>{t("harness.localFiles")}</strong>
          <div className={toolStyles.localFileInputGroup}>
            <Input
              className={toolStyles.localFileInput}
              autoFocus
              aria-label={t("office.path")}
              placeholder={t("office.path")}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void openPath(path);
              }}
            />
            <Button
              aria-label={t("office.open")}
              title={t("office.open")}
              variant="ghost"
              size="icon"
              disabled={!threadId || !path.trim()}
              onClick={() => void openPath(path)}
            >
              <FileDown />
            </Button>
            <Button
              aria-label={t("office.choose")}
              title={t("office.choose")}
              variant="ghost"
              size="icon"
              disabled={!threadId || choosing}
              onClick={() => void chooseFile()}
            >
              <FolderOpen />
            </Button>
          </div>
          <small className={toolStyles.localFileDescription}>{t("office.selectPath")}</small>
        </div>
      )}
    </section>
  );
}

export const FileEditorPanelFactory = create((dependsOn) => {
  const shell = dependsOn(shellTokens.shell);
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { shell, workspace };
  return function FileEditorPanel(props: {
    threadId?: string;
    workspacePath?: string;
    initialPath?: string;
  }) {
    return createElement(FileEditorPanelContent, { dependencies, props });
  };
}, "FileEditorPanel");

export const FileEditorPanel = (...args: Parameters<ServiceOf<typeof FileEditorPanelFactory>>) =>
  createElement(useService(FileEditorPanelFactory), ...args);

function isAbsoluteFilePath(value: string): boolean {
  return /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(value);
}

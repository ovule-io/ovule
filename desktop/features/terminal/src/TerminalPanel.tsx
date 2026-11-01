import shellTokens from "@ovule/shell/shell.token";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { createElement } from "react";
import { create, type ServiceOf } from "@ovule/ioc";
import { FeedbackButton } from "@ovule/ui/FeedbackButton";
import { Input } from "@ovule/ui/form";
import { Button } from "@ovule/ui/button";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ArrowDown, ArrowUp, Copy, RotateCcw, Search, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";

import type { WorkspaceOperation } from "./operations";

import type { TerminalRunView } from "@ovule/shell-api";
import styles from "./TerminalPanel.module.css";
import { PtyPanel } from "./PtyPanel";
import { reduceTerminalInput } from "./terminal-input";
import { cn } from "@ovule/ui/cn";
import toolStyles from "@ovule/ui/tool-panels.module.css";

const FONT_SIZE = 12;
const LINE_HEIGHT = 1.25;
const MAX_STREAM_REPLAY_BYTES = 512 * 1_024;

type StreamReplay = { sequence: number; stdout: string; stderr: string };

type TerminalPanelDependencies = {
  workspace: ServiceOf<typeof workspaceTokens.workspace>;
};

function TerminalPanelContent({
  dependencies,
  props,
}: {
  dependencies: TerminalPanelDependencies;
  props: {
    instanceId: string;
    threadId?: string;
    workspacePath?: string;
    workspaceBindingId?: string;
    shellProfileId?: string;
    useThreadWorkspace: boolean;
    runs: TerminalRunView[];
    invoke(operation: WorkspaceOperation): Promise<boolean>;
  };
}) {
  const { copyText } = useService(shellTokens.shell);

  const { workspace } = dependencies;
  const {
    instanceId,
    threadId,
    workspacePath,
    workspaceBindingId,
    useThreadWorkspace,
    runs,
    invoke,
  } = props;

  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const draftKey = `ovule.terminal.${instanceId}.draft`;
  const historyKey = `ovule.terminal.${instanceId}.history`;
  const [command, setCommand] = useState(() => localStorage.getItem(draftKey) ?? "");
  const [hiddenRunIds, setHiddenRunIds] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(historyKey) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const commandRef = useRef(command);
  const cursorRef = useRef(command.length);
  const historyRef = useRef(history);
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef("");
  const activeRef = useRef<TerminalRunView | undefined>(undefined);
  const updateDraftRef = useRef<(value: string, cursor?: number) => void>(() => undefined);
  const runRef = useRef<(override?: string) => Promise<void>>(async () => undefined);
  const clearRef = useRef<() => void>(() => undefined);
  const cancelRef = useRef<() => void>(() => undefined);
  const promptRef = useRef(terminalPrompt(workspacePath));
  const inputAnchorRef = useRef(false);
  const pendingSubmitRef = useRef(false);
  const streamedOutputRef = useRef(new Map<string, StreamReplay>());

  useEffect(
    () =>
      workspace.observeTerminalOutput((event) => {
        if (event.ownerId !== instanceId || !terminal.current) return;
        const replay = streamedOutputRef.current.get(event.runId) ?? {
          sequence: 0,
          stdout: "",
          stderr: "",
        };
        if (event.sequence <= replay.sequence) return;
        replay.sequence = event.sequence;
        replay[event.stream] = appendStreamReplay(replay[event.stream], event.delta);
        streamedOutputRef.current.set(event.runId, replay);
        const delta = event.delta.replaceAll("\n", "\r\n");
        terminal.current.write(event.stream === "stderr" ? `\x1b[31m${delta}\x1b[0m` : delta);
        terminal.current.scrollToBottom();
      }),
    [instanceId, workspace],
  );

  useEffect(() => {
    const command = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action?.startsWith("search:")) {
        const value = action.slice("search:".length);
        setSearchText(value);
        search.current?.findNext(value, {
          caseSensitive: false,
          incremental: true,
        });
        terminal.current?.focus();
      } else if (action === "copy") void copyOutput();
      else if (action === "rerun") void runRef.current(historyRef.current.at(-1) ?? "");
      else if (action === "clear") clearRef.current();
      else if (action === "cancel") cancelRef.current();
    };
    window.addEventListener("ovule:pane-command", command);
    return () => window.removeEventListener("ovule:pane-command", command);
  }, []);

  useEffect(() => {
    localStorage.setItem(draftKey, command);
  }, [command, draftKey]);
  useEffect(() => {
    localStorage.setItem(historyKey, JSON.stringify(history.slice(-100)));
    historyRef.current = history;
  }, [history, historyKey]);
  const visibleRuns = useMemo(
    () => runs.filter((run) => run.ownerId === instanceId && !hiddenRunIds.includes(run.id)),
    [hiddenRunIds, instanceId, runs],
  );
  const active = [...visibleRuns]
    .reverse()
    .find((run) => ["queued", "running", "cancelling"].includes(run.status));
  activeRef.current = active;
  const displayedWorkspacePath = displayWorkspacePath(workspacePath);
  const prompt = terminalPrompt(displayedWorkspacePath);
  promptRef.current = prompt;

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const instance = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'Cascadia Code', 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      scrollback: 10_000,
      rightClickSelectsWord: true,
      allowTransparency: true,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    instance.loadAddon(fitAddon);
    instance.loadAddon(searchAddon);
    instance.open(host);
    instance.textarea?.setAttribute("aria-label", t("terminal.command"));
    instance.attachCustomKeyEventHandler((event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "f") {
        if (event.type === "keydown") setSearchOpen(true);
        return false;
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "c" &&
        instance.hasSelection()
      ) {
        if (event.type === "keydown") void copyText(instance.getSelection());
        return false;
      }
      return true;
    });
    const input = instance.onData((data) => handleTerminalInput(data));
    terminal.current = instance;
    search.current = searchAddon;
    const fit = () => {
      if (!host.isConnected || host.clientWidth < 80 || host.clientHeight < 60) return;
      fitAddon.fit();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    const themeObserver = new MutationObserver(() => {
      instance.options.theme = terminalTheme();
      instance.refresh(0, Math.max(0, instance.rows - 1));
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    fit();
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      terminal.current = null;
      search.current = null;
      instance.dispose();
    };
  }, []);

  useEffect(() => {
    terminal.current?.textarea?.setAttribute("aria-label", t("terminal.command"));
  }, [t]);

  useEffect(() => {
    const instance = terminal.current;
    if (!instance) return;
    instance.reset();
    inputAnchorRef.current = false;
    instance.writeln("\x1b[2m" + t("terminal.banner") + "\x1b[0m");
    for (const run of visibleRuns) {
      const running = ["queued", "running", "cancelling"].includes(run.status);
      const replay = running ? streamedOutputRef.current.get(run.id) : undefined;
      const stdout = replay?.stdout ?? run.stdout;
      const stderr = replay?.stderr ?? run.stderr;
      instance.writeln(`\r\n\x1b[36m❯\x1b[0m ${run.command}`);
      if (stdout) instance.write(stdout.replaceAll("\n", "\r\n"));
      if (stderr) instance.write(`\x1b[31m${stderr.replaceAll("\n", "\r\n")}\x1b[0m`);
      if (!running) {
        streamedOutputRef.current.delete(run.id);
        const color = run.status === "succeeded" ? 32 : run.status === "failed" ? 31 : 33;
        const status = terminalStatus(run.status, t);
        const exit =
          run.exitCode === undefined ? "" : ` · ${t("terminal.exit", { code: run.exitCode })}`;
        instance.writeln(`\r\n\x1b[${color}m${status}${exit}\x1b[0m`);
      }
    }
    if (!active) {
      instance.write("\r\n");
      drawInput(instance, prompt, commandRef.current, cursorRef.current, inputAnchorRef);
      if (pendingSubmitRef.current && commandRef.current.trim()) {
        pendingSubmitRef.current = false;
        queueMicrotask(() => void runRef.current());
      }
    }
    instance.scrollToBottom();
  }, [active, prompt, t, visibleRuns]);

  const run = async (override?: string) => {
    const next = (override ?? commandRef.current).trim();
    if (!threadId || !next || startingRef.current || activeRef.current) return;
    startingRef.current = true;
    setStarting(true);
    terminal.current?.write("\r\n");
    inputAnchorRef.current = false;
    try {
      if (
        await invoke((api) =>
          api.startTerminal(threadId, next, instanceId, workspaceBindingId, useThreadWorkspace),
        )
      ) {
        setHistory((current) => [...current.filter((item) => item !== next), next].slice(-100));
        commandRef.current = "";
        cursorRef.current = 0;
        setCommand("");
        historyIndexRef.current = -1;
        historyDraftRef.current = "";
      } else {
        drawInput(terminal.current, prompt, commandRef.current, cursorRef.current, inputAnchorRef);
      }
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  };
  const moveHistory = (direction: -1 | 1) => {
    const items = historyRef.current;
    if (!items.length) return;
    if (historyIndexRef.current < 0 && direction < 0) {
      historyDraftRef.current = commandRef.current;
    }
    const next =
      historyIndexRef.current < 0
        ? direction < 0
          ? items.length - 1
          : -1
        : Math.min(items.length - 1, Math.max(-1, historyIndexRef.current + direction));
    historyIndexRef.current = next;
    updateDraftRef.current(next < 0 ? historyDraftRef.current : items[next]);
  };
  const copyOutput = async () => {
    const instance = terminal.current;
    if (!instance) return false;
    const selected = instance.getSelection();
    const text =
      selected ||
      visibleRuns
        .flatMap((run) => [run.command, run.stdout, run.stderr])
        .filter(Boolean)
        .join("\n");
    return text ? copyText(text) : false;
  };
  const clearOutput = () => {
    setHiddenRunIds((current) => [...new Set([...current, ...visibleRuns.map((run) => run.id)])]);
    terminal.current?.clear();
  };
  clearRef.current = clearOutput;
  cancelRef.current = () => {
    const current = activeRef.current;
    if (current) void invoke((api) => api.cancelTerminal(current.id));
  };
  runRef.current = run;
  updateDraftRef.current = (value, cursor = value.length) => {
    commandRef.current = value;
    cursorRef.current = Math.min(value.length, Math.max(0, cursor));
    setCommand(value);
    if (!activeRef.current && !startingRef.current) {
      drawInput(terminal.current, prompt, value, cursorRef.current, inputAnchorRef);
    }
  };
  const find = (direction: -1 | 1) => {
    if (!searchText) return;
    const options = { caseSensitive: false, incremental: true };
    if (direction < 0) search.current?.findPrevious(searchText, options);
    else search.current?.findNext(searchText, options);
    terminal.current?.focus();
  };

  return (
    <section className={cn("terminal-panel", toolStyles.terminalPanel, styles.panel)}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <span className={styles.statusDot} />
          <strong className={styles.identityTitle}>{t("terminal.shell")}</strong>
          <small className={styles.identityStatus}>
            {active ? terminalStatus(active.status, t) : t("terminal.bounded")}
          </small>
        </div>
        <div className={styles.toolbarActions}>
          {searchOpen && (
            <div className={styles.search}>
              <Input
                className={styles.searchInput}
                autoFocus
                aria-label={t("terminal.find")}
                value={searchText}
                onChange={(event) => {
                  setSearchText(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") find(event.shiftKey ? -1 : 1);
                  if (event.key === "Escape") setSearchOpen(false);
                }}
                placeholder={t("terminal.find")}
              />
              <Button
                variant="ghost"
                size="sm"
                className={styles.toolbarButton}
                aria-label={t("terminal.previous")}
                onClick={() => find(-1)}
              >
                <ArrowUp size={12} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={styles.toolbarButton}
                aria-label={t("terminal.next")}
                onClick={() => find(1)}
              >
                <ArrowDown size={12} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={styles.toolbarButton}
                aria-label={t("terminal.closeSearch")}
                onClick={() => setSearchOpen(false)}
              >
                <X size={12} />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={styles.toolbarButton}
            aria-label={t("terminal.find")}
            title={t("terminal.find")}
            onClick={() => setSearchOpen((value) => !value)}
          >
            <Search size={14} />
          </Button>
          <FeedbackButton
            variant="ghost"
            size="sm"
            className={styles.toolbarButton}
            label={t("terminal.copy")}
            successLabel={t("common.copied")}
            action={copyOutput}
          >
            <Copy size={14} />
          </FeedbackButton>
          <Button
            variant="ghost"
            size="sm"
            className={styles.toolbarButton}
            aria-label={t("terminal.rerun")}
            title={t("terminal.rerun")}
            disabled={!history.length || Boolean(active)}
            onClick={() => {
              const previous = history.at(-1) ?? "";
              void run(previous);
            }}
          >
            <RotateCcw size={14} />
          </Button>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("terminal.cancel")}
              title={t("terminal.cancel")}
              className={cn(styles.toolbarButton, styles.cancel)}
              onClick={cancelRef.current}
            >
              <Square size={12} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={styles.toolbarButton}
            aria-label={t("terminal.clear")}
            title={t("terminal.clear")}
            onClick={clearOutput}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </header>
      <div
        ref={ref}
        className={styles.shell}
        data-testid="terminal-output"
        data-workspace={displayedWorkspacePath}
        data-starting={starting || undefined}
        onClick={() => terminal.current?.focus()}
      />
    </section>
  );

  function handleTerminalInput(data: string) {
    if (data === "\u0003") {
      if (activeRef.current) cancelRef.current();
      else {
        terminal.current?.write("^C\r\n");
        inputAnchorRef.current = false;
        commandRef.current = "";
        cursorRef.current = 0;
        setCommand("");
        historyIndexRef.current = -1;
        drawInput(terminal.current, promptRef.current, "", 0, inputAnchorRef);
      }
      return;
    }
    if (data === "\r") {
      if (activeRef.current || startingRef.current) pendingSubmitRef.current = true;
      else void runRef.current();
      return;
    }
    if (activeRef.current || startingRef.current) {
      if (!/^[\x00-\x1f\x7f]|^\x1b/.test(data)) {
        const inserted = data.replace(/[\r\n]+/g, " ");
        const at = cursorRef.current;
        commandRef.current =
          commandRef.current.slice(0, at) + inserted + commandRef.current.slice(at);
        cursorRef.current = at + inserted.length;
        setCommand(commandRef.current);
      }
      return;
    }
    const result = reduceTerminalInput(
      { command: commandRef.current, cursor: cursorRef.current },
      data,
    );
    if (result.kind === "clear") clearRef.current();
    if (result.kind === "history") moveHistory(result.direction);
    if (result.kind === "draft") {
      if (result.resetHistory) historyIndexRef.current = -1;
      updateDraftRef.current(result.draft.command, result.draft.cursor);
    }
  }
}

export const TerminalPanelFactory = create((dependsOn) => {
  const workspace = dependsOn(workspaceTokens.workspace);
  const dependencies = { workspace };
  return function TerminalPanel(props: {
    instanceId: string;
    threadId?: string;
    workspacePath?: string;
    workspaceBindingId?: string;
    shellProfileId?: string;
    useThreadWorkspace: boolean;
    runs: TerminalRunView[];
    invoke(operation: WorkspaceOperation): Promise<boolean>;
  }) {
    if (!props.workspaceBindingId && location.protocol === "ovule:") {
      return createElement(PtyPanel, {
        workspace,
        owner: props.instanceId,
        directory: props.workspacePath,
        initialProfile: props.shellProfileId,
      });
    }
    return createElement(TerminalPanelContent, { dependencies, props });
  };
}, "TerminalPanel");

export const TerminalPanel = (...args: Parameters<ServiceOf<typeof TerminalPanelFactory>>) =>
  createElement(useService(TerminalPanelFactory), ...args);

function appendStreamReplay(current: string, delta: string): string {
  if (current.length >= MAX_STREAM_REPLAY_BYTES) return current;
  const remaining = MAX_STREAM_REPLAY_BYTES - current.length;
  if (delta.length <= remaining) return current + delta;
  let boundary = remaining;
  const lastCodeUnit = delta.charCodeAt(boundary - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    boundary -= 1;
  }
  return current + delta.slice(0, boundary);
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string) => styles.getPropertyValue(name).trim();
  return {
    background: token("--background"),
    foreground: token("--terminal-fg"),
    cursor: token("--terminal-cursor"),
    selectionBackground: token("--terminal-selection"),
    black: token("--background"),
    brightBlack: token("--muted-foreground"),
    red: token("--destructive"),
    brightRed: token("--chart-5"),
    green: token("--success"),
    brightGreen: token("--chart-2"),
    yellow: token("--warning"),
    brightYellow: token("--chart-3"),
    blue: token("--blue"),
    brightBlue: token("--chart-1"),
    magenta: token("--chart-4"),
    brightMagenta: token("--chart-4"),
    cyan: token("--chart-2"),
    brightCyan: token("--chart-2"),
    white: token("--foreground"),
    brightWhite: token("--foreground"),
  };
}

function terminalPrompt(workspacePath?: string): string {
  const path = compactWorkspacePath((workspacePath || "~").replace(/[\x00-\x1f\x7f]/g, ""));
  return `PS ${path}> `;
}

function compactWorkspacePath(workspacePath: string): string {
  if (workspacePath.length <= 42) return workspacePath;
  const normalized = workspacePath.replaceAll("/", "\\");
  const parts = normalized.split("\\").filter(Boolean);
  const leaf = parts.at(-1) ?? normalized;
  const drive = /^[A-Za-z]:/.exec(normalized)?.[0];
  return drive ? `${drive}\\…\\${leaf}` : `…\\${leaf}`;
}

function displayWorkspacePath(workspacePath?: string): string {
  if (!workspacePath) return "";
  if (workspacePath.toLocaleLowerCase().startsWith("\\\\?\\unc\\")) {
    return `\\\\${workspacePath.slice(8)}`;
  }
  return workspacePath.startsWith("\\\\?\\") ? workspacePath.slice(4) : workspacePath;
}

function drawInput(
  instance: Terminal | null,
  prompt: string,
  command: string,
  cursor: number,
  anchored: { current: boolean },
) {
  if (!instance) return;
  if (anchored.current) instance.write("\x1b[u\x1b[0J");
  else {
    instance.write("\r\x1b[2K\x1b[s");
    anchored.current = true;
  }
  instance.write(`\x1b[32m${prompt}\x1b[0m${command}`);
  const offset = Array.from(prompt + command.slice(0, cursor)).length;
  const row = Math.floor(offset / Math.max(1, instance.cols));
  const column = offset % Math.max(1, instance.cols);
  instance.write(`\x1b[u${row ? `\x1b[${row}B` : ""}\x1b[${column + 1}G`);
  instance.scrollToBottom();
}

function terminalStatus(status: string, t: TFunction): string {
  switch (status) {
    case "queued":
      return t("terminal.statusQueued");
    case "running":
      return t("terminal.statusRunning");
    case "cancelling":
      return t("terminal.statusCancelling");
    case "succeeded":
      return t("terminal.statusSucceeded");
    case "failed":
      return t("terminal.statusFailed");
    case "cancelled":
      return t("terminal.statusCancelled");
    default:
      return status;
  }
}

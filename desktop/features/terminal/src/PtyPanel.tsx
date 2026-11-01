import { useService } from "@ovule/ioc/react";
import shellTokens from "@ovule/shell/shell.token";
import { SearchAddon } from "@xterm/addon-search";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useTranslation } from "react-i18next";
import type { WorkspaceService } from "@ovule/workspace/workspace";
import styles from "./TerminalPanel.module.css";

type ShellProfile = { id: string; name: string };
type Session = { id: string; owner: string; profileId: string; directory: string };
type Output = {
  data: number[];
  cursor: number;
  truncated: boolean;
  exitCode?: number;
  eof: boolean;
  error?: string;
};

export function PtyPanel({
  workspace,
  owner,
  directory = "",
  initialProfile,
}: {
  workspace: WorkspaceService;
  owner: string;
  directory?: string;
  initialProfile?: string;
}) {
  const { t } = useTranslation();
  const shell = useService(shellTokens.shell);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const searchRef = useRef<SearchAddon | undefined>(undefined);
  const actions = useRef({ restart: async () => {}, close: async () => {} });
  const [busy, setBusy] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [profiles, setProfiles] = useState<ShellProfile[]>([]);
  const [profile, setProfile] = useState("");
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [exitCode, setExitCode] = useState<number>();
  const session = useRef<string | undefined>(undefined);
  const starting = useRef<Promise<Session> | undefined>(undefined);
  const dimensions = useRef({ cols: 80, rows: 24 });

  useEffect(() => {
    let disposed = false;
    void workspace
      .api()
      .then(async (api) => {
        const profiles: ShellProfile[] = JSON.parse(await api.shellProfiles());
        const sessions: Session[] = JSON.parse(await api.listSessions());
        if (disposed) return;
        setProfiles(profiles);
        const existing = sessions.find((session) => session.owner === owner);
        setProfile(
          existing?.profileId ??
            (profiles.some((p) => p.id === initialProfile)
              ? initialProfile!
              : (profiles[0]?.id ?? "")),
        );
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
    };
  }, [workspace, owner, initialProfile]);

  useEffect(() => {
    if (!profile || !host.current) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = 0n;
    setExitCode(undefined);
    setError("");
    const terminal = new Terminal({
      cursorBlink: true,
      scrollback: 10000,
      fontFamily: "'Cascadia Code', monospace",
      fontSize: 12,
      allowProposedApi: false,
      theme: terminalTheme(),
    });
    terminalRef.current = terminal;
    const search = new SearchAddon();
    terminal.loadAddon(search);
    searchRef.current = search;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current);
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const resize = () => {
      if (!host.current || host.current.clientWidth < 80 || host.current.clientHeight < 60) return;
      fit.fit();
      dimensions.current = { cols: terminal.cols, rows: terminal.rows };
      const id = session.current;
      if (id)
        void workspace
          .api()
          .then((api) => api.resizeSession(id, terminal.cols, terminal.rows))
          .catch((cause) => {
            if (!disposed) setError(String(cause));
          });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    const input = terminal.onData((value) => {
      const id = session.current;
      if (!id) return;
      void workspace
        .api()
        .then((api) => api.writeSession(id, new TextEncoder().encode(value)))
        .catch((cause) => {
          if (!disposed) setError(String(cause));
        });
    });
    void workspace
      .api()
      .then(async (api) => {
        if (disposed) return;
        // React effect cleanup can run while opening; the native owner key makes
        // remount/reattach idempotent without creating a second shell.
        starting.current = api
          .openSession(owner, profile, directory, dimensions.current.cols, dimensions.current.rows)
          .then((json) => JSON.parse(json) as Session);
        const opened = await starting.current;
        if (disposed) return;
        session.current = opened.id;
        const poll = async () => {
          if (disposed || session.current !== opened.id) return;
          try {
            const read: Output = JSON.parse(await api.readSession(opened.id, cursor));
            if (disposed || session.current !== opened.id) return;
            if (read.truncated) terminal.write("\r\n[Earlier output was truncated]\r\n");
            if (read.data.length) terminal.write(new Uint8Array(read.data));
            cursor = BigInt(read.cursor);
            if (read.exitCode != null) setExitCode(read.exitCode);
            if (read.error) setError(read.error);
            if (!read.eof) timer = setTimeout(() => void poll(), read.data.length ? 10 : 80);
          } catch (cause) {
            if (!disposed && session.current === opened.id) setError(String(cause));
          }
        };
        void poll();
        resize();
        terminal.focus();
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      terminal.dispose();
      if (terminalRef.current === terminal) {
        terminalRef.current = undefined;
        searchRef.current = undefined;
      }
      session.current = undefined;
    };
  }, [workspace, owner, directory, profile, generation]);

  const close = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const api = await workspace.api();
      const opened = await starting.current;
      session.current = undefined;
      setProfile("");
      if (opened) await api.closeSession(opened.id);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const restart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const api = await workspace.api();
      const opened = await starting.current;
      if (opened) await api.closeSession(opened.id);
      session.current = undefined;
      setProfile(profile || initialProfile || profiles[0]?.id || "");
      setGeneration((value) => value + 1);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  actions.current = { restart, close };
  useEffect(() => {
    void shell
      .requestRoot("tab.metadata", {
        tabId: owner,
        toolbarState: {
          terminalMode: "pty",
          shellName: profiles.find((p) => p.id === profile)?.name ?? "",
          shellOpen: String(Boolean(profile)),
          shellBusy: String(busy),
        },
      })
      .catch(console.error);
  }, [shell, owner, profiles, profile, busy]);
  useEffect(() => {
    const command = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId?: string; action?: string }>).detail;
      if (detail?.tabId && detail.tabId !== owner) return;
      if (detail?.action === "terminal.restart") void actions.current.restart();
      else if (detail?.action === "terminal.close") void actions.current.close();
      else if (detail?.action === "clear") terminalRef.current?.clear();
      else if (detail?.action?.startsWith("search:"))
        searchRef.current?.findNext(detail.action.slice(7));
    };
    window.addEventListener("ovule:pane-command", command);
    return () => window.removeEventListener("ovule:pane-command", command);
  }, [owner]);
  return (
    <section className={styles.ptyPanel} data-terminal-pty>
      <div className={styles.shell} ref={host} />
      {exitCode !== undefined && (
        <p role="status">{t("terminal.shellExited", { code: exitCode })}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function terminalTheme() {
  const style = getComputedStyle(document.documentElement);
  return {
    background: style.getPropertyValue("--background").trim() || "#111111",
    foreground: style.getPropertyValue("--terminal-fg").trim() || "#dddddd",
    cursor: style.getPropertyValue("--terminal-cursor").trim() || "#dddddd",
    selectionBackground: style.getPropertyValue("--terminal-selection").trim() || "#555555",
  };
}

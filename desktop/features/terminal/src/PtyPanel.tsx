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
}: {
  workspace: WorkspaceService;
  owner: string;
  directory?: string;
}) {
  const { t } = useTranslation();
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
        setProfile(existing?.profileId ?? profiles[0]?.id ?? "");
      })
      .catch((cause) => {
        if (!disposed) setError(String(cause));
      });
    return () => {
      disposed = true;
    };
  }, [workspace, owner]);

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
      session.current = undefined;
    };
  }, [workspace, owner, directory, profile, generation]);

  const restart = async (profileId: string) => {
    try {
      const api = await workspace.api();
      const opened = await starting.current;
      if (opened) await api.closeSession(opened.id);
      session.current = undefined;
      setProfile(profileId);
      setGeneration((value) => value + 1);
    } catch (cause) {
      setError(String(cause));
    }
  };
  return (
    <section className={styles.ptyPanel} data-terminal-pty>
      <div className={styles.ptyToolbar}>
        <select
          aria-label={t("terminal.shellProfile")}
          value={profile}
          onChange={(event) => void restart(event.target.value)}
        >
          {!profile && (
            <option value="" disabled>
              {t("terminal.shellClosed")}
            </option>
          )}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void restart(profile || profiles[0]?.id || "")}>
          {t("terminal.restartShell")}
        </button>
        <button
          type="button"
          disabled={!profile}
          onClick={() => {
            void workspace
              .api()
              .then(async (api) => {
                const opened = await starting.current;
                session.current = undefined;
                setProfile("");
                if (opened) await api.closeSession(opened.id);
              })
              .catch((cause) => setError(String(cause)));
          }}
        >
          {t("terminal.closeShell")}
        </button>
        {exitCode !== undefined && <span>{t("terminal.shellExited", { code: exitCode })}</span>}
      </div>
      <div className={styles.shell} ref={host} />
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

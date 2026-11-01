import { CopyButton } from "@ovule/ui/copy-button";
import { isValidElement, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { useService } from "@ovule/ioc/react";
import shellTokens from "@ovule/shell/shell.token";
import { WrapText, Download } from "lucide-react";
import { useIsCodeFenceIncomplete } from "streamdown";
import { CodeBlock, CodeBlockCopyButton } from "@ovule/ui/code-block";
import { Terminal, TerminalHeader, TerminalOutput } from "@ovule/ui/terminal";
import styles from "./MessageParts.module.css";

type MarkdownCodeProps = ComponentProps<"code"> & {
  "data-block"?: boolean;
  node?: { properties?: Record<string, unknown> };
};

export function MarkdownCode({ children, className, node, ...props }: MarkdownCodeProps) {
  const { t } = useTranslation();
  const shell = useService(shellTokens.shell);
  const [saving, setSaving] = useState(false);
  const incomplete = useIsCodeFenceIncomplete();
  const [wrap, setWrap] = useState(false);
  const [error, setError] = useState("");
  if (!("data-block" in props)) {
    return <code className={className}>{children}</code>;
  }
  const code =
    typeof children === "string"
      ? children
      : isValidElement<{ children?: string }>(children)
        ? (children.props.children ?? "")
        : "";
  const language = className?.match(/language-([^\s]+)/)?.[1] ?? "text";
  const meta = typeof node?.properties?.metastring === "string" ? node.properties.metastring : "";
  const startLine = Number(meta.match(/startLine=(\d+)/)?.[1] ?? 1);
  const label = t("messageList.codeWrap");
  if (["terminal", "console", "shell-session"].includes(language)) {
    return (
      <Terminal>
        <TerminalHeader>
          <span>{t("chatElements.terminal")}</span>
          <CopyButton
            text={code}
            aria-label={t("chatElements.copyOutput")}
            onCopy={() => setError("")}
            onError={() => setError(t("messageList.codeCopyFailed"))}
          />
        </TerminalHeader>
        <TerminalOutput>{code}</TerminalOutput>
        {error && <span role="alert">{error}</span>}
      </Terminal>
    );
  }
  return (
    <div className={styles.codeFrame} data-code-wrap={wrap}>
      <CodeBlock
        code={code}
        language={language}
        isIncomplete={incomplete}
        startLine={Math.max(1, startLine)}
        lineNumbers={!/\bnoLineNumbers\b/.test(meta)}
      >
        <button
          className={styles.codeAction}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={wrap}
          onClick={() => setWrap((value) => !value)}
        >
          <WrapText size={14} aria-hidden="true" />
        </button>
        <CodeBlockCopyButton
          className={styles.codeAction}
          aria-label={t("messageList.codeCopy")}
          title={t("messageList.codeCopy")}
          onCopy={() => setError("")}
          onError={() => setError(t("messageList.codeCopyFailed"))}
        />
        <button
          type="button"
          className={styles.codeAction}
          disabled={saving}
          aria-label={t("messageList.codeSave")}
          title={t("messageList.codeSave")}
          onClick={async () => {
            if (saving) return;
            setSaving(true);
            setError("");
            try {
              const dialog = await shell.dialog();
              await dialog.saveFile(
                {
                  title: t("messageList.codeSave"),
                  defaultPath: `code.${codeExtension(language)}`,
                },
                Array.from(new TextEncoder().encode(code)),
              );
            } catch {
              setError(t("messageList.codeSaveFailed"));
            } finally {
              setSaving(false);
            }
          }}
        >
          <Download size={14} aria-hidden="true" />
        </button>
      </CodeBlock>
      {error && (
        <span role="status" className={styles.codeError}>
          {error}
        </span>
      )}
    </div>
  );
}

function codeExtension(language: string): string {
  return (
    (
      {
        javascript: "js",
        typescript: "ts",
        python: "py",
        rust: "rs",
        bash: "sh",
        shell: "sh",
        shellscript: "sh",
        powershell: "ps1",
        csharp: "cs",
        cpp: "cpp",
        "c++": "cpp",
        "c#": "cs",
        ruby: "rb",
        yaml: "yml",
        markdown: "md",
        plaintext: "txt",
        text: "txt",
        dockerfile: "dockerfile",
        java: "java",
        go: "go",
        kotlin: "kt",
        swift: "swift",
        html: "html",
        css: "css",
        scss: "scss",
        sql: "sql",
        json: "json",
        xml: "xml",
        js: "js",
        ts: "ts",
        jsx: "jsx",
        tsx: "tsx",
        php: "php",
        lua: "lua",
      } as Record<string, string>
    )[language.toLowerCase()] ?? "txt"
  );
}

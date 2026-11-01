import { CopyButton } from "@ovule/ui/copy-button";
import { useState } from "react";
import { useService } from "@ovule/ioc/react";
import workspaceTokens from "@ovule/workspace/workspace.token";
import { useTranslation } from "react-i18next";
import { Tool } from "@ovule/ui/tool";
import { Terminal, TerminalHeader, TerminalOutput } from "@ovule/ui/terminal";
import { CodeBlock, CodeBlockCopyButton } from "@ovule/ui/code-block";
import { InlineCitation } from "@ovule/ui/inline-citation";
import type { MessagePartRendererProps } from "@ovule/conversation/messages/message-list";
import { safeRemoteUrl } from "./part-assets";
import { chatPartData, chatToolPresentation, chatText } from "./chat-part-data";

export function CodePart({ part, streaming }: MessagePartRendererProps) {
  const data = chatPartData(part.dataJson);
  const { t } = useTranslation();
  return (
    <CodeBlock
      code={part.text ?? chatText(data.code)}
      language={chatText(data.language) || "text"}
      isIncomplete={streaming}
    >
      <CodeBlockCopyButton aria-label={t("messageList.codeCopy")} />
    </CodeBlock>
  );
}
export function TerminalPart({ part, streaming }: MessagePartRendererProps) {
  const [copyError, setCopyError] = useState(false);
  const data = chatPartData(part.dataJson);
  const { t } = useTranslation();
  const text =
    part.text ??
    [chatText(data.output ?? data.stdout ?? data.text), chatText(data.stderr)]
      .filter(Boolean)
      .join("\n");
  return (
    <Terminal aria-busy={streaming}>
      <TerminalHeader>
        <span>{chatText(data.title) || part.name || t("chatElements.terminal")}</span>
        <CopyButton
          text={text}
          aria-label={t("chatElements.copyOutput")}
          onCopy={() => setCopyError(false)}
          onError={() => setCopyError(true)}
        />
      </TerminalHeader>
      <TerminalOutput>
        {chatText(data.command) && `$ ${chatText(data.command)}\n`}
        {text}
      </TerminalOutput>
      {copyError && <p role="alert">{t("messageList.codeCopyFailed")}</p>}
    </Terminal>
  );
}
export function ToolPart({ part, streaming }: MessagePartRendererProps) {
  const data = chatPartData(part.dataJson);
  const { t } = useTranslation();
  const output = data.output ?? data.result;
  const exitCode =
    output &&
    typeof output === "object" &&
    "exit_code" in output &&
    typeof output.exit_code === "number"
      ? output.exit_code
      : undefined;
  const warnings =
    output && typeof output === "object" && "warnings" in output && Array.isArray(output.warnings)
      ? output.warnings
          .filter((warning: unknown): warning is string => typeof warning === "string")
          .slice(0, 8)
      : [];
  const state = chatToolPresentation(data, streaming, part.kind === "tool-result");
  const terminal =
    output && typeof output === "object" && ("stdout" in output || "stderr" in output);
  return (
    <Tool
      title={chatText(data.title ?? data.name ?? data.tool) || part.name || t("chatElements.tool")}
      state={state}
      label={t(
        state === "completed" && warnings.length
          ? "chatElements.completedWithWarnings"
          : `chatElements.${state}`,
      )}
      description={
        [
          typeof data.durationMs === "number" ? `${Math.round(data.durationMs)} ms` : undefined,
          exitCode !== undefined ? t("chatElements.exitCode", { code: exitCode }) : undefined,
        ]
          .filter(Boolean)
          .join(" · ") || undefined
      }
    >
      {data.input !== undefined && (
        <>
          <p>{t("chatElements.input")}</p>
          <CodeBlock code={chatText(data.input)} language="json">
            <CodeBlockCopyButton aria-label={t("messageList.codeCopy")} />
          </CodeBlock>
        </>
      )}
      {output !== undefined && (
        <>
          <p>{t("chatElements.output")}</p>
          {terminal ? (
            <TerminalPart
              part={{ ...part, dataJson: JSON.stringify(output), text: undefined }}
              streaming={state === "running"}
            />
          ) : (
            <CodeBlock
              code={chatText(output)}
              language={typeof output === "string" ? "text" : "json"}
            >
              <CodeBlockCopyButton aria-label={t("messageList.codeCopy")} />
            </CodeBlock>
          )}
        </>
      )}
      {warnings.map((warning, index) => (
        <p key={index} role="status">
          {warning}
        </p>
      ))}
      {typeof data.error === "string" && (
        <details>
          <summary>{t("chatElements.errorDetails")}</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{data.error}</pre>
        </details>
      )}
    </Tool>
  );
}
export function CitationPart({ part }: MessagePartRendererProps) {
  const workspace = useService(workspaceTokens.workspace);
  const { t } = useTranslation();
  const data = chatPartData(part.dataJson);
  const sources = Array.isArray(data.sources) ? data.sources : [data];
  return (
    <span data-slot="sources">
      {sources.map((source, index) => {
        if (!source || typeof source !== "object") return null;
        const href = safeRemoteUrl(source.url ?? part.url);
        if (!href) return <span key={index}>{t("messageParts.unsafeLink")}</span>;
        const title = chatText(source.title) || part.name || new URL(href).hostname;
        return (
          <InlineCitation
            key={`${href}:${index}`}
            href={href}
            title={title}
            description={chatText(source.description)}
            onOpen={() => workspace.requestBrowserUse(href)}
          >
            {chatText(source.label) || `[${index + 1}]`}
          </InlineCitation>
        );
      })}
    </span>
  );
}

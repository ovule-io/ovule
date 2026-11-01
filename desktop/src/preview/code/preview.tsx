import "./preview.css";
import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { code, type HighlightResult } from "@streamdown/code";
import { FilePreviewState, filePreviewName } from "../shared/file-preview-state";

export function CodePreview({
  url,
  loadText,
  language,
}: {
  url: string;
  loadText: (url: string) => Promise<string>;
  language?: string;
}) {
  const [document, setDocument] = useState<{ url: string; text?: string; error?: string }>();
  const [highlighted, setHighlighted] = useState<{
    url: string;
    text: string;
    result: HighlightResult;
  }>();
  useEffect(() => {
    let disposed = false;
    window.document.title = filePreviewName(url) ?? "Local file";
    if (!language) {
      setDocument({ url, error: "Unsupported local code file" });
      return;
    }
    void loadText(url)
      .then((text) => {
        if (!disposed) {
          setDocument({ url, text });
          window.document.title = decodeURIComponent(
            new URL(url).pathname.split("/").at(-1) || url,
          );
        }
      })
      .catch((error) => {
        if (!disposed) setDocument({ url, error: String(error) });
      });
    return () => {
      disposed = true;
    };
  }, [url, language, loadText]);
  useEffect(() => {
    if (document?.url !== url || document.text === undefined || !language) return;
    let disposed = false;
    const text = document.text;
    const apply = (result: HighlightResult) => {
      if (!disposed) setHighlighted({ url, text, result });
    };
    const result = code.highlight(
      {
        code: text,
        language: language as Parameters<typeof code.highlight>[0]["language"],
        themes: code.getThemes(),
      },
      apply,
    );
    if (result) apply(result);
    return () => {
      disposed = true;
    };
  }, [document, url, language]);
  if (!document || document.url !== url) return <FilePreviewState kind="loading" />;
  if (document.error)
    return <FilePreviewState error={document.error} fileName={filePreviewName(url)} />;
  const tokens =
    highlighted?.url === url && highlighted.text === document.text
      ? highlighted.result.tokens
      : undefined;
  return (
    <main
      className="preview-code"
      data-preview-code-url={url}
      tabIndex={0}
      aria-label="File content"
    >
      <pre data-ovule-code={language}>
        <code>
          {tokens
            ? tokens.map((line, index) => (
                <Fragment key={index}>
                  {index > 0 ? "\n" : ""}
                  {line.map((token, offset) => (
                    <span
                      key={offset}
                      style={
                        {
                          "--code-light": token.htmlStyle?.color ?? token.color,
                          "--code-dark": token.htmlStyle?.["--shiki-dark"] ?? token.color,
                        } as CSSProperties
                      }
                    >
                      {token.content}
                    </span>
                  ))}
                </Fragment>
              ))
            : document.text}
        </code>
      </pre>
    </main>
  );
}

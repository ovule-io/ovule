import "./preview.css";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Streamdown, defaultRemarkPlugins } from "streamdown";
import { code } from "@streamdown/code";
import { FilePreviewState, filePreviewName } from "../shared/file-preview-state";

export function MarkdownPreview({
  url,
  loadText,
  resolveSource = (url) => url,
}: {
  url: string;
  loadText(url: string): Promise<string>;
  resolveSource?(url: string): string;
}) {
  const [loaded, setLoaded] = useState<{ url: string; text?: string; error?: string }>();
  const remarkPlugins = useMemo(() => {
    const localLinks = () => (tree: unknown) => {
      const visit = (value: unknown) => {
        if (!value || typeof value !== "object") return;
        const node = value as { type?: string; url?: string; children?: unknown[] };
        if (
          (node.type === "link" || node.type === "definition") &&
          typeof node.url === "string" &&
          !node.url.startsWith("#")
        ) {
          try {
            const target = new URL(node.url, url);
            // Keep local references through URL hardening without allowing
            // file:/javascript: URLs in arbitrary embedded Markdown HTML.
            if (target.protocol === "file:")
              node.url = `#ovule-local-file=${encodeURIComponent(target.href)}`;
          } catch {
            /* Let the default sanitizer handle invalid references. */
          }
        }
        node.children?.forEach(visit);
      };
      visit(tree);
    };
    return [...Object.values(defaultRemarkPlugins), localLinks];
  }, [url]);
  useEffect(() => {
    let active = true;
    document.title = filePreviewName(url) ?? "Local file";
    void loadText(url)
      .then((text) => {
        if (active) {
          setLoaded({ url, text });
          document.title = decodeURIComponent(new URL(url).pathname.split("/").at(-1) || url);
        }
      })
      .catch((error) => {
        if (active) setLoaded({ url, error: String(error) });
      });
    return () => {
      active = false;
    };
  }, [url, loadText]);
  if (loaded?.url !== url) return <FilePreviewState kind="loading" />;
  if (loaded.error)
    return <FilePreviewState error={loaded.error} fileName={filePreviewName(url)} />;
  const Link = ({ href, node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) => {
    let target: string | undefined;
    try {
      const local = href?.startsWith("#ovule-local-file=")
        ? decodeURIComponent(href.slice("#ovule-local-file=".length))
        : undefined;
      const resolved = new URL(local ?? href ?? "", url);
      if (["file:", "http:", "https:", "mailto:"].includes(resolved.protocol))
        target = !local && href?.startsWith("#") ? href : resolveSource(resolved.href);
    } catch {
      /* Unsafe/invalid links remain plain text. */
    }
    return <a {...props} href={target} />;
  };
  return (
    <main
      className="preview-markdown"
      data-preview-markdown-url={url}
      tabIndex={0}
      aria-label="File content"
    >
      <Streamdown
        mode="static"
        controls={false}
        plugins={{ code }}
        components={{ a: Link }}
        remarkPlugins={remarkPlugins}
      >
        {loaded.text ?? ""}
      </Streamdown>
    </main>
  );
}

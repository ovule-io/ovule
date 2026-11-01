import { useEffect, useState } from "react";
import { FilePreviewState } from "../shared/file-preview-state";
import styles from "./preview.module.css";

export function safeHtmlDocument(source: string): { html: string; scriptsOnly: boolean } {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const active = parsed.querySelectorAll(
    "script, iframe, object, embed, link, base, meta[http-equiv]",
  );
  const removed = active.length;
  active.forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((node) => {
    for (const attribute of Array.from(node.attributes))
      if (attribute.name.toLowerCase().startsWith("on") || attribute.name === "srcdoc")
        node.removeAttribute(attribute.name);
  });
  const policy = parsed.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob: https: http:; font-src data:; media-src data: blob: https: http:; base-uri 'none'; form-action 'none'";
  parsed.head.prepend(policy);
  const referrer = parsed.createElement("meta");
  referrer.name = "referrer";
  referrer.content = "no-referrer";
  parsed.head.prepend(referrer);
  const visible =
    parsed.body.textContent?.trim() || parsed.body.querySelector("img,svg,canvas,video");
  return {
    html: `<!doctype html>${parsed.documentElement.outerHTML}`,
    scriptsOnly: Boolean(removed && !visible),
  };
}

export function HtmlPreview({ url, loadText }: { url: string; loadText(): Promise<string> }) {
  const [loaded, setLoaded] = useState<{
    url: string;
    html?: string;
    scriptsOnly?: boolean;
    error?: string;
  }>();
  useEffect(() => {
    let active = true;
    document.title = `Preview · ${url}`;
    void loadText()
      .then((html) => {
        if (active) setLoaded({ url, ...safeHtmlDocument(html) });
      })
      .catch((error) => {
        if (active) setLoaded({ url, error: String(error) });
      });
    return () => {
      active = false;
    };
  }, [url, loadText]);
  if (loaded?.url !== url) return <FilePreviewState kind="loading" />;
  if (loaded.error) return <FilePreviewState error={loaded.error} fileName={url} />;
  if (loaded.scriptsOnly)
    return (
      <main className={styles.status} role="status">
        <strong>Interactive scripts were removed</strong>
        <p>This HTML depends on scripts or external resources.</p>
      </main>
    );
  return (
    <iframe
      data-preview-html-url={url}
      className={styles.preview}
      title="Local HTML preview"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={loaded.html}
    />
  );
}

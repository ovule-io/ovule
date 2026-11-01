import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ImagePreview } from "../src/preview/image/preview";
import { CodePreview } from "../src/preview/code/preview";
import { MarkdownPreview } from "../src/preview/markdown/preview";
import { HtmlPreview } from "../src/preview/html/preview";
import "@ovule/ui/theme.css";
import "../src/preview/styles.css";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><script>window.svgExecuted=true</script><rect viewBox="0 0 40 40" fill="coral"/></svg>';
const html = "<h1>HTML preview</h1><script>window.htmlExecuted=true</script>";
const markdown = "# Markdown preview\n\nA **rendered** file.";
const loadSvg = async () => ({
  name: "logo.svg",
  extension: "svg",
  sizeBytes: BigInt(svg.length),
  bytes: Array.from(new TextEncoder().encode(svg)),
});
const readSvg = async () => svg;
const readHtml = async () => html;
const readMarkdown = async () => markdown;
function Fixture() {
  const [kind, setKind] = useState("svg");
  const [source, setSource] = useState(false);
  const url = `file:///tmp/demo.${kind}`;
  const loadText = kind === "svg" ? readSvg : kind === "html" ? readHtml : readMarkdown;
  return (
    <div style={{ display: "grid", gridTemplateRows: "40px minmax(0, 1fr)", height: "100%" }}>
      <nav>
        {["svg", "html", "md"].map((value) => (
          <button
            key={value}
            onClick={() => {
              setKind(value);
              setSource(false);
            }}
          >
            {value}
          </button>
        ))}
        <button aria-label="Toggle source" aria-pressed={source} onClick={() => setSource(!source)}>
          Source
        </button>
      </nav>
      <div style={{ minHeight: 0 }}>
        {source ? (
          <CodePreview
            key={kind}
            url={url}
            loadText={loadText}
            language={kind === "svg" ? "xml" : kind === "html" ? "html" : "markdown"}
          />
        ) : kind === "svg" ? (
          <ImagePreview url={url} loadFile={loadSvg} />
        ) : kind === "html" ? (
          <HtmlPreview url={url} loadText={readHtml} />
        ) : (
          <MarkdownPreview url={url} loadText={readMarkdown} />
        )}
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);

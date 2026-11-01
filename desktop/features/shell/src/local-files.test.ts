import { expect, test } from "bun:test";
import {
  localExplorerAddress,
  localExplorerSource,
  htmlPreviewSource,
  htmlPreviewRequest,
} from "./local-files";

const base = "ovule://-/main";
test("Markdown and unsupported archives navigate to explicit preview documents", () => {
  for (const [name, route] of [
    ["README.md", "/local-markdown"],
    ["guide.markdown", "/local-markdown"],
    ["archive.zip", "/local-unsupported"],
    ["package.7z", "/local-unsupported"],
  ]) {
    const file = `file:///tmp/${name}`;
    const source = localExplorerSource(file, base);
    expect(new URL(source).pathname).toBe(route);
    expect(localExplorerAddress(source, base)).toBe(file);
  }
  for (const file of [
    "file:///tmp/",
    "file:///tmp/page.html",
    "file:///tmp/image.png",
    "file:///tmp/video.mp4",
  ])
    expect(localExplorerSource(file, base)).toBe(file);
});
test("Office files use the local preview route and retain their original file URL", () => {
  for (const extension of ["pdf", "doc", "docx", "xlsx", "xlsm", "pptx", "pptm", "csv"]) {
    const file = `file:///tmp/My%20Files/report.${extension}`;
    const source = localExplorerSource(file, base);
    expect(new URL(source).pathname).toBe("/local-office");
    expect(localExplorerAddress(source, base)).toBe(file);
  }
  expect(localExplorerSource("https://example.com/report.xlsx", base)).toBe(
    "https://example.com/report.xlsx",
  );
});
test("YAML navigations go to a read-only app document before Chromium can download them", () => {
  const file = "file:///tmp/My%20Code/config%23prod.yaml";
  const source = localExplorerSource(file, base);
  expect(new URL(source).pathname).toBe("/local-code");
  expect(new URL(source).searchParams.get("url")).toBe(file);
  expect(localExplorerAddress(source, base)).toBe(file);
  expect(localExplorerSource("file:///tmp/config.yml", base)).toContain("/local-code?");
});
test("preview mapping retains non-code pages and cannot unwrap remote lookalikes", () => {
  for (const url of ["https://example.com/a.yaml", "file:///tmp/", "file:///tmp/index.html"])
    expect(localExplorerSource(url, base)).toBe(url);
  const hostile = "https://example.com/local-code?url=file:///tmp/private.yaml";
  expect(localExplorerAddress(hostile, base)).toBe(hostile);
});

test("only local grant origins and preview paths unwrap display metadata", () => {
  const file = "file:///tmp/hello.md";
  const source = `ovule://${"a".repeat(48)}.local/markdown?url=${encodeURIComponent(file)}`;
  expect(localExplorerAddress(source, base)).toBe(file);
  for (const hostile of [
    source.replace("ovule:", "https:"),
    source.replace(".local/", ".local.evil/"),
    source.replace("/markdown?", "/main?"),
  ])
    expect(localExplorerAddress(hostile, base)).toBe(hostile);
});

test("HTML recipes survive origin changes without sharing content through localStorage", () => {
  const recipe = htmlPreviewSource("thread-1", "docs/a #b.html");
  expect(htmlPreviewRequest(recipe)).toEqual({ threadId: "thread-1", path: "docs/a #b.html" });
  const guest = `ovule://${"c".repeat(48)}.local/html?url=${encodeURIComponent(recipe)}`;
  expect(localExplorerAddress(guest, base)).toBe(recipe);
  expect(htmlPreviewRequest(recipe.replace("ovule:", "https:"))).toBeUndefined();
});

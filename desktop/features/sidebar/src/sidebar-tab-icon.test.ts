import { expect, test } from "bun:test";
import { sidebarTabIconName, sidebarTabIconSource } from "./sidebar-tab-icon";

test("web pages use favicons, internal pages use Lucide, and local files use Catppuccin", () => {
  expect(sidebarTabIconSource({ kind: "browser", url: "https://example.com/image.png" })).toBe(
    "web",
  );
  for (const kind of ["browser", "terminal", "workflow", "spice", "handoff"] as const) {
    expect(sidebarTabIconSource({ kind })).toBe("internal");
  }
  expect(sidebarTabIconSource({ kind: "browser", url: "file:///tmp/report.pdf" })).toBe("file");
  expect(sidebarTabIconSource({ kind: "office", target: "C:\\work\\report.xlsx" })).toBe("file");
  expect(sidebarTabIconSource({ kind: "terminal", target: "README.md" })).toBe("internal");
});
test("local document and media tabs use their file type including encoded paths", () => {
  expect(
    sidebarTabIconName({ kind: "browser", url: "file:///tmp/%E6%96%87%E6%A1%A3%20%231.PDF" }),
  ).toBe("pdf");
  expect(sidebarTabIconName({ kind: "office", target: "C:\\work\\report.xlsx" })).toBe(
    "spreadsheet",
  );
  expect(sidebarTabIconName({ kind: "browser", url: "file:///tmp/clip.mp4" })).toBe("video");
  expect(sidebarTabIconName({ kind: "browser", url: "file:///tmp/image.png" })).toBe("image");
  expect(sidebarTabIconName({ kind: "browser", url: "file:///tmp/README.md" })).toBe("markdown");
  expect(sidebarTabIconName({ kind: "browser", url: "file:///tmp/report.doc" })).toBe("document");
  expect(sidebarTabIconName({ kind: "browser", url: "file:///tmp/unknown.custom" })).toBe("file");
  expect(sidebarTabIconName({ kind: "browser", url: "file:///tmp/folder.md/" })).toBe("folder");
});

test("preview grants preserve Catppuccin types and remote query strings cannot impersonate files", () => {
  for (const [extension, icon] of [
    ["docx", "document"],
    ["xlsx", "spreadsheet"],
    ["pptx", "presentation"],
    ["pdf", "pdf"],
    ["md", "markdown"],
  ]) {
    const url = `ovule://${"a".repeat(48)}.local/office?url=${encodeURIComponent(`file:///tmp/文档.${extension}`)}`;
    expect(sidebarTabIconSource({ kind: "browser", url })).toBe("file");
    expect(sidebarTabIconName({ kind: "browser", url, target: "file:///tmp/old.pdf" })).toBe(icon);
  }
  expect(
    sidebarTabIconSource({
      kind: "browser",
      url: "https://example.com/office?url=file:///tmp/a.pdf",
      target: "file:///tmp/old.pdf",
    }),
  ).toBe("web");
});

test("persisted legacy preview wrappers keep their file icon", () => {
  expect(
    sidebarTabIconName({
      kind: "browser",
      url: "ovule://-/local-office?url=file:///tmp/report.xlsx",
    }),
  ).toBe("spreadsheet");
  expect(
    sidebarTabIconSource({
      kind: "browser",
      url: "ovule://-/local-office?url=file:///tmp/report.xlsx",
    }),
  ).toBe("file");
});

test("code files select their language artwork through native preview URLs", () => {
  const expected = {
    "app.ts": "typescript",
    "app.tsx": "typescript-react",
    "app.jsx": "javascript-react",
    "main.js": "javascript",
    "main.py": "python",
    "main.rs": "rust",
    "main.go": "go",
    "config.yaml": "yaml",
    "config.json": "json",
    "style.scss": "sass",
    Dockerfile: "docker",
    Makefile: "makefile",
  };
  for (const [name, icon] of Object.entries(expected)) {
    const file = `file:///tmp/${name}`;
    const url = `ovule://${"b".repeat(48)}.local/code?url=${encodeURIComponent(file)}`;
    expect(sidebarTabIconName({ kind: "browser", url })).toBe(icon);
    expect(sidebarTabIconSource({ kind: "browser", url })).toBe("file");
  }
  expect(sidebarTabIconName({ kind: "browser", url: "file:///tmp/%E4%BB%A3%E7%A0%81.tsx" })).toBe(
    "typescript-react",
  );
  expect(sidebarTabIconName({ kind: "office", target: "C:\\work\\main.py" })).toBe("python");
});

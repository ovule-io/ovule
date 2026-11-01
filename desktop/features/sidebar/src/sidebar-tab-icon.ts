import { fileCodeLanguage } from "@ovule/file-types";
import { previewSourceAddress } from "./preview-source";
import type { PaneInstance } from "@ovule/panes/tab";

const languageIcons = {
  javascript: "javascript",
  jsx: "javascript-react",
  typescript: "typescript",
  tsx: "typescript-react",
  python: "python",
  rust: "rust",
  go: "go",
  c: "c",
  cpp: "cpp",
  csharp: "csharp",
  java: "java",
  kotlin: "kotlin",
  swift: "swift",
  ruby: "ruby",
  php: "php",
  shellscript: "bash",
  fish: "bash",
  powershell: "powershell",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  toml: "toml",
  ini: "config",
  css: "css",
  scss: "sass",
  less: "less",
  sql: "database",
  xml: "xml",
  vue: "vue",
  svelte: "svelte",
  diff: "diff",
  cmake: "cmake",
  dockerfile: "docker",
  makefile: "makefile",
} as const;
const extensionIcons = {
  html: "html",
  htm: "html",
  md: "markdown",
  markdown: "markdown",
  pdf: "pdf",
  doc: "document",
  docx: "document",
  dotx: "document",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  csv: "spreadsheet",
  ppt: "presentation",
  pptx: "presentation",
  pptm: "presentation",
  ppsx: "presentation",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  ico: "image",
  mp4: "video",
  webm: "video",
  mov: "video",
  mkv: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
} as const;
export type SidebarTabIconName =
  | (typeof extensionIcons)[keyof typeof extensionIcons]
  | (typeof languageIcons)[keyof typeof languageIcons]
  | "file"
  | "folder";

/** Resolve the artwork only after sidebarTabIconSource identifies a local file. */
export function sidebarTabIconName(
  tab: Pick<PaneInstance, "kind" | "url" | "target">,
): SidebarTabIconName {
  const target = iconTarget(tab);
  let pathname = target;
  if (/^file:/i.test(target)) {
    try {
      pathname = decodeURIComponent(new URL(target).pathname);
    } catch {
      return "file";
    }
  }
  if (/[\\/]$/.test(pathname)) return "folder";
  const extension = pathname.split(/[\\/]/).at(-1)?.split(".").at(-1)?.toLowerCase();
  return extension && extension in extensionIcons
    ? extensionIcons[extension as keyof typeof extensionIcons]
    : codeIcon(target, pathname);
}
function codeIcon(target: string, pathname: string): SidebarTabIconName {
  const url = target.startsWith("file:")
    ? target
    : `file:///${encodeURI(pathname.replaceAll("\\", "/"))}`;
  const language = fileCodeLanguage(url);
  return language && language in languageIcons
    ? languageIcons[language as keyof typeof languageIcons]
    : "file";
}

export function sidebarTabIconSource(
  tab: Pick<PaneInstance, "kind" | "url" | "target">,
): "web" | "file" | "internal" {
  const target = iconTarget(tab);
  if (["browser", "files", "office", "markdown"].includes(tab.kind)) {
    if (/^file:\/\//i.test(target) || /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(target)) return "file";
    if (tab.kind !== "browser" && /\.[a-z0-9]+$/i.test(target)) return "file";
  }
  return tab.kind === "browser" && /^https?:\/\//i.test(target) ? "web" : "internal";
}

function iconTarget(tab: Pick<PaneInstance, "url" | "target">): string {
  const current = previewSourceAddress(tab.url ?? "");
  const target = previewSourceAddress(tab.target ?? "");
  if (
    (!current || current === "about:blank" || current.startsWith("ovule:")) &&
    target.startsWith("file:")
  )
    return target;
  return current || target;
}

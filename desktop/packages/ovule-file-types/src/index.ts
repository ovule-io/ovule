const languages: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  py: "python",
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  rb: "ruby",
  php: "php",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",
  ps1: "powershell",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  vue: "vue",
  svelte: "svelte",
  diff: "diff",
  patch: "diff",
  cmake: "cmake",
};

export function fileCodeLanguage(address: string): string | undefined {
  try {
    const url = new URL(address);
    if (url.protocol !== "file:" || url.pathname.endsWith("/")) return;
    const name = decodeURIComponent(url.pathname.split("/").at(-1) ?? "").toLowerCase();
    if (name === "dockerfile") return "dockerfile";
    if (name === "makefile") return "makefile";
    return languages[name.split(".").at(-1) ?? ""];
  } catch {
    return;
  }
}

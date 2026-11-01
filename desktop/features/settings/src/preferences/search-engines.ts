import type { SearchEngine } from "./preferences";

export const searchEngines: ReadonlyArray<{ id: SearchEngine; name: string; url: string }> = [
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=" },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=" },
  { id: "baidu", name: "Baidu", url: "https://www.baidu.com/s?wd=" },
  { id: "duckduckgo", name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
];
export const defaultSearchUrl = searchEngines[0]!.url;

export function searchUrl(value: string | null | undefined): string {
  if (!value) return defaultSearchUrl;
  try {
    const url = new URL(value);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password)
      return value;
  } catch {
    /* Invalid stored preferences fall back to the default. */
  }
  return defaultSearchUrl;
}
export function searchEngine(url: string): SearchEngine | "custom" {
  return searchEngines.find((engine) => engine.url === url)?.id ?? "custom";
}

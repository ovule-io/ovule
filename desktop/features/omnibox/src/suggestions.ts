import type { BrowserSuggestion } from "@ovule/shell-api";

export function mergeSuggestions(
  query: string,
  primary: BrowserSuggestion[],
  additional: BrowserSuggestion[],
): BrowserSuggestion[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const matches = additional.filter((item) => {
    const text = `${item.title} ${item.target}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const seen = new Set<string>();
  return [...primary, ...matches]
    .filter((item) => {
      if (seen.has(item.target)) return false;
      seen.add(item.target);
      return true;
    })
    .slice(0, 8);
}

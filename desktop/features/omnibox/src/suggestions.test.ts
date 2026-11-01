import { expect, test } from "bun:test";
import { mergeSuggestions } from "./suggestions";
const search = { id: "search", kind: "search", title: "Search", detail: "", target: "shadcn/ui" };
const tab = {
  id: "tab",
  kind: "tab",
  title: "Combobox – shadcn/ui",
  detail: "",
  target: "https://ui.shadcn.com/docs/components/combobox",
};
test("omnibox matches tab titles and URLs while preserving the primary search action", () => {
  expect(mergeSuggestions("shadcn/ui", [search], [tab])).toEqual([search, tab]);
  expect(mergeSuggestions("shadcn combobox", [], [tab])).toEqual([tab]);
  expect(mergeSuggestions("unrelated", [], [tab])).toEqual([]);
  expect(mergeSuggestions("", [], [tab])).toEqual([]);
  expect(mergeSuggestions("shadcn", [tab], [tab])).toEqual([tab]);
});

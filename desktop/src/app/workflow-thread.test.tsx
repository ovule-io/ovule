import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HydrateFallback } from "./HydrateFallback";
test("HydrateFallback delays a centered spinning loader shell", async () => {
  const html = renderToStaticMarkup(<HydrateFallback />);
  expect(html).toContain('class="hydrate-fallback"');
  expect(html).toContain("hydrate-fallback-spinner");
  expect(html).toContain("animate-spin");
  expect(html).toContain("lucide-loader-circle");
  const css = await Bun.file(new URL("./tailwind.css", import.meta.url)).text();
  expect(css).toContain("place-items: center");
  expect(css).toContain("160ms both");
});

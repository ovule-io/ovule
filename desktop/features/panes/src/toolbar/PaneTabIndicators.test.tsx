import { describe, expect, test } from "bun:test";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PaneTabIndicators } from "./PaneTabIndicators";

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: {} } } });
function render(node: ReactNode) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

describe("PaneTabIndicators", () => {
  test("renders thread child tabs as workspace indicators", () => {
    const html = render(
      <PaneTabIndicators
        tabs={[
          {
            id: "browser-1",
            kind: "browser",
            title: "Baidu",
            placement: "thread",
            requestVersion: 0,
          },
          {
            id: "files-1",
            kind: "files",
            title: "Local files",
            placement: "thread",
            requestVersion: 0,
          },
        ]}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('data-tab-id="browser-1"');
    expect(html).toContain('data-tab-id="files-1"');
    expect(html).toContain('aria-label="Baidu"');
    expect(html).toContain('aria-label="Local files"');
  });
});

test("shows the three most recently visited tabs, adding overflow only at four", () => {
  const tabs = [1, 2, 3, 4].map((id) => ({
    id: `tab-${id}`,
    kind: "browser" as const,
    title: `Tab ${id}`,
    requestVersion: 0,
    lastVisited: id === 1 ? 10 : id,
  }));
  const html = render(<PaneTabIndicators tabs={tabs} onSelect={() => undefined} />);
  expect(html.indexOf('data-tab-id="tab-1"')).toBeLessThan(html.indexOf('data-tab-id="tab-4"'));
  expect(html.indexOf('data-tab-id="tab-4"')).toBeLessThan(html.indexOf('data-tab-id="tab-3"'));
  expect(html).not.toContain('data-tab-id="tab-2"');
  expect(html).toContain("+1");
  const three = render(<PaneTabIndicators tabs={tabs.slice(0, 3)} onSelect={() => undefined} />);
  expect(three.match(/data-tab-id=/g)).toHaveLength(3);
  expect(three).not.toContain("+1");
});

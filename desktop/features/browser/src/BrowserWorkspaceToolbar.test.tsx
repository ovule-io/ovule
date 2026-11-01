import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BrowserWorkspaceToolbarContent as BrowserWorkspaceToolbar,
  browserAddressHost,
} from "./BrowserWorkspaceToolbar";
import type { WorkspaceToolbarContext } from "@ovule/panes/pane";
import { collapsedAncestorCount, fileBreadcrumbs } from "./FileBreadcrumbs";

const context: WorkspaceToolbarContext = {
  tab: {
    id: "browser",
    kind: "browser",
    title: "Design",
    url: "https://figma.com/design/123",
    requestVersion: 0,
  } as WorkspaceToolbarContext["tab"],
  command() {},
  startEditing() {},
  copyAddress: () => true,
  editing: false,
  addressEditor: <input aria-label="address-editor" />,
  downloads: <button>downloads</button>,
};

test("browser workspace toolbar keeps link and host before navigation and downloads", () => {
  const html = renderToStaticMarkup(<BrowserWorkspaceToolbar {...context} />);
  const labels = [
    "browser.copyUrl",
    ">figma.com<",
    "browser.back",
    "browser.forward",
    "browser.reload",
    ">downloads<",
  ];
  const positions = labels.map((label) => html.indexOf(label));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(html).not.toContain("address-editor");
  expect(html.match(/disabled=""/g)).toHaveLength(2);
});

test("editing replaces the host with the address editor while preserving pane controls", () => {
  const html = renderToStaticMarkup(<BrowserWorkspaceToolbar {...context} editing />);
  expect(html).toContain("address-editor");
  expect(html).not.toContain(">figma.com<");
  expect(html).toContain("browser.reload");
  expect(html).not.toContain("browser.closeTab");
  expect(html).toContain(">downloads<");
});

test("host labels retain ports and handle local or incomplete addresses", () => {
  expect(browserAddressHost("https://example.com:8443/a?q=b")).toBe("example.com:8443");
  expect(browserAddressHost("file:///tmp/test.html")).toBe("file:///tmp/test.html");
  expect(browserAddressHost("localhost")).toBe("localhost");
});

test("file toolbar displays decoded breadcrumbs with navigable encoded ancestors", () => {
  const html = renderToStaticMarkup(
    <BrowserWorkspaceToolbar
      {...context}
      tab={{ ...context.tab, url: "file:///tmp/My%20Code/src/app.tsx" }}
    />,
  );
  expect(html).toContain('aria-label="breadcrumb"');
  expect(html).toContain('title="file:///tmp/My%20Code/"');
  expect(html).toContain(">My Code<");
  expect(html).toContain('aria-current="page"');
  expect(html).toContain(">app.tsx<");
  expect(html).toContain("explorerTitlebar.editAddress");
  expect(html).toContain("browser.copyUrl");
});

test("overflow collapses middle ancestors progressively while retaining root and file", () => {
  const widths = [20, 100, 90, 80, 100];
  expect(collapsedAncestorCount(widths, 500)).toBe(0);
  expect(collapsedAncestorCount(widths, 420)).toBe(1);
  expect(collapsedAncestorCount(widths, 310)).toBe(2);
  expect(collapsedAncestorCount(widths, 200)).toBe(3);
  expect(collapsedAncestorCount(widths, 40)).toBe(3);
  expect(collapsedAncestorCount([20, 600], 40)).toBe(0);
});

test("file breadcrumbs preserve root, remote hosts, unicode and encoded path separators", () => {
  expect(fileBreadcrumbs("file://server/share/a%23b%3Fc.ts")).toEqual([
    { label: "server", url: "file://server/" },
    { label: "share", url: "file://server/share/" },
    { label: "a#b?c.ts", url: "file://server/share/a%23b%3Fc.ts" },
  ]);
  expect(fileBreadcrumbs("file:///")).toEqual([{ label: "/", url: "file:///" }]);
  expect(fileBreadcrumbs("https://example.com")).toEqual([]);
  expect(fileBreadcrumbs("file:///tmp/%ZZ")).toEqual([]);
});

test("file toolbar offers the platform reveal action", () => {
  for (const macOS of [true, false]) {
    const html = renderToStaticMarkup(
      <BrowserWorkspaceToolbar
        {...context}
        tab={{ ...context.tab, url: "file:///tmp/logo.svg" }}
        macOS={macOS}
        revealFile={async () => true}
      />,
    );
    expect(html).toContain(macOS ? "browser.revealInFinder" : "browser.revealInExplorer");
  }
});

test("pending navigation exposes a spinner beside the submitted address", () => {
  const html = renderToStaticMarkup(
    <BrowserWorkspaceToolbar
      {...context}
      tab={{
        ...context.tab,
        title: "New tab",
        url: "https://www.bing.com/search?q=slow",
        toolbarState: { loading: "true" },
      }}
    />,
  );
  expect(html).toContain("www.bing.com");
  expect(html).toContain("animate-spin");
  expect(html).not.toContain(">New tab<");
});

test("Markdown, HTML and SVG breadcrumbs expose the preview/source toggle", () => {
  for (const extension of ["md", "html", "svg"]) {
    for (const source of ["true", "false"]) {
      const html = renderToStaticMarkup(
        <BrowserWorkspaceToolbar
          {...context}
          tab={{ ...context.tab, url: `file:///tmp/demo.${extension}`, toolbarState: { source } }}
        />,
      );
      expect(html).toContain(source === "true" ? "browser.showPreview" : "browser.showSource");
      expect(html).toContain(`aria-pressed="${source === "false"}"`);
    }
  }
});

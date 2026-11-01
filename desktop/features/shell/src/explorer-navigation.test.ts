import { describe, expect, test } from "bun:test";
import { explorerOpenDestination, resolveBrowserTarget } from "./explorer-navigation";

describe("Explorer link routing", () => {
  test("links and new browsing contexts default to overlay", () => {
    for (const type of ["navigation", "open", "newwindow"])
      expect(
        explorerOpenDestination(type, {
          url: "https://example.com/",
          userGesture: true,
        }),
      ).toBe("overlay");
    expect(explorerOpenDestination("newwindow", { url: "file:///tmp/page.html" })).toBe("overlay");
  });
  test("HTTP popups retain their native window routing", () => {
    for (const userGesture of [true, false])
      expect(
        explorerOpenDestination("popup", {
          url: "https://example.com/sign-in",
          userGesture,
        }),
      ).toBe("popup");
  });
  test("redirects and internal route navigation stay in the current Explorer", () => {
    expect(
      explorerOpenDestination("navigation", {
        url: "https://example.com/redirect",
        userGesture: false,
      }),
    ).toBe("current");
    expect(
      explorerOpenDestination("navigation", {
        url: "ovule://-/thread",
        userGesture: true,
      }),
    ).toBe("current");
    expect(explorerOpenDestination("open", { url: "ovule://-/thread" })).toBe("ignore");
  });
  test("unsupported schemes cannot open a preview", () => {
    for (const url of [
      "javascript:alert(1)",
      "mailto:example@example.com",
      "data:text/html,test",
      "",
    ])
      expect(explorerOpenDestination("open", { url })).toBe("ignore");
  });
});

test("HTML previews keep their trusted internal route when promoted from New Tab", () => {
  expect(resolveBrowserTarget("ovule://-/preview-html?thread=t&path=index.html")).toBe(
    "ovule://-/preview-html?thread=t&path=index.html",
  );
  expect(resolveBrowserTarget("ovule://untrusted/preview")).toContain(
    "https://www.bing.com/search",
  );
});

test("address bar searches use the configured engine without changing direct URLs", () => {
  expect(resolveBrowserTarget("snow & clouds", "https://www.google.com/search?q=")).toBe(
    "https://www.google.com/search?q=snow%20%26%20clouds",
  );
  expect(resolveBrowserTarget("你好", "https://www.baidu.com/s?wd=")).toBe(
    "https://www.baidu.com/s?wd=%E4%BD%A0%E5%A5%BD",
  );
  expect(resolveBrowserTarget("https://example.com", "https://duckduckgo.com/?q=")).toBe(
    "https://example.com/",
  );
  expect(resolveBrowserTarget("query", "javascript:alert(1)")).toBe(
    "https://www.bing.com/search?q=query",
  );
});

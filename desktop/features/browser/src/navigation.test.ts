import { describe, expect, test } from "bun:test";
import { resolveOmnibox } from "./navigation";

const messages = {
  enterAddress: "empty",
  credentialsUnsupported: "credentials",
  unsupportedScheme: "scheme",
  invalidSearchUrl: "search",
};

describe("browser omnibox", () => {
  test("normalizes URLs, hosts and local files", () => {
    expect(resolveOmnibox("global.cn", "https://search/?q=", messages)).toEqual({
      kind: "url",
      target: "https://global.cn/",
    });
    expect(resolveOmnibox("localhost:3000/a", "https://search/?q=", messages).target).toBe(
      "http://localhost:3000/a",
    );
    expect(resolveOmnibox("C:\\work\\index.html", "https://search/?q=", messages).target).toBe(
      "file:///C:/work/index.html",
    );
  });

  test("keeps workspace HTML as a preview and searches free text", () => {
    expect(resolveOmnibox("docs/index.html", "https://search/?q=", messages)).toEqual({
      kind: "preview",
      target: "docs/index.html",
    });
    expect(resolveOmnibox("hello world", "https://search/?q=", messages).target).toBe(
      "https://search/?q=hello%20world",
    );
  });

  test("routes custom protocols to native confirmation while rejecting script and internal URLs", () => {
    expect(resolveOmnibox("lark://client/open.html", "https://search/?q=", messages)).toEqual({
      kind: "url",
      target: "lark://client/open.html",
    });
    expect(
      resolveOmnibox("lark://client/open?token=example", "https://search/?q=", messages).target,
    ).toBe("lark://client/open?token=example");
    expect(resolveOmnibox("mailto:test@example.com", "https://search/?q=", messages).target).toBe(
      "mailto:test@example.com",
    );
    expect(() => resolveOmnibox("https://a:b@example.com", "https://search/?q=", messages)).toThrow(
      "credentials",
    );
    expect(() => resolveOmnibox("javascript:alert(1)", "https://search/?q=", messages)).toThrow(
      "scheme",
    );
  });
});

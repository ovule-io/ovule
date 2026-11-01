import { expect, test } from "bun:test";
import { createExplorerLoader } from "./preview-loader";
import type { ExplorerElement } from "./explorer";

test("only the latest file grant navigates; superseded grants are revoked", async () => {
  const oldLocation = globalThis.location;
  const oldDocument = globalThis.document;
  Object.assign(globalThis, {
    location: new URL("ovule://-/main"),
    document: { documentElement: { dataset: { theme: "dark" }, lang: "zh-CN" } },
  });
  try {
    const pending: ((grant: { id: string; kind: string; url: string }) => void)[] = [];
    const revoked: string[] = [];
    const api = {
      createFilePreview: (_url: string) =>
        new Promise<{ id: string; kind: string; url: string }>((resolve) => pending.push(resolve)),
      createHtmlPreview: async () => {
        throw new Error("Unexpected HTML request");
      },
      revokePreview: async (id: string) => {
        revoked.push(id);
        return true;
      },
    };
    const load = createExplorerLoader(async () => api);
    const element = {
      getBoundingClientRect: () => ({ width: 700, height: 600 }),
      src: "",
      dataset: {},
      isConnected: true,
      load: (source: string) => {
        element.src = source;
      },
    } as unknown as ExplorerElement;
    load(element, "file:///tmp/a.yaml", true);
    load(element, "file:///tmp/b.yaml", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending[1]!({ id: "b".repeat(48), kind: "code", url: "file:///tmp/b.yaml" });
    pending[0]!({ id: "a".repeat(48), kind: "code", url: "file:///tmp/a.yaml" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(new URL(element.src).hostname).toBe(`${"b".repeat(48)}.local`);
    expect(new URL(element.src).searchParams.get("theme")).toBe("dark");
    expect(revoked).toEqual(["a".repeat(48)]);
    load(element, "https://example.com");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(element.src).toBe("https://example.com");
    expect(revoked).not.toContain("b".repeat(48));
  } finally {
    Object.assign(globalThis, { location: oldLocation, document: oldDocument });
  }
});

test("a failed navigation reports an error and revokes its unused HTML grant", async () => {
  const oldLocation = globalThis.location;
  const oldDocument = globalThis.document;
  Object.assign(globalThis, {
    location: new URL("ovule://-/main"),
    document: { documentElement: { dataset: {}, lang: "en" } },
  });
  try {
    const requests: string[][] = [];
    const revoked: string[] = [];
    const errors: string[] = [];
    const id = "d".repeat(48);
    const loader = createExplorerLoader(async () => ({
      createFilePreview: async () => {
        throw new Error("Unexpected file request");
      },
      createHtmlPreview: async (thread, path) => {
        requests.push([thread, path]);
        return { id, kind: "html", url: path };
      },
      revokePreview: async (id) => {
        revoked.push(id);
        return true;
      },
    }));
    const element = {
      dataset: {},
      isConnected: true,
      getBoundingClientRect: () => ({ width: 600, height: 400 }),
      load: () => {
        throw new Error("Guest detached");
      },
      dispatchEvent: (event: CustomEvent<{ message: string }>) => {
        errors.push(event.detail.message);
        return true;
      },
    } as unknown as ExplorerElement;
    loader(element, "ovule://-/preview-html?thread=thread-1&path=doc.html");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual([["thread-1", "doc.html"]]);
    expect(revoked).toEqual([id]);
    expect(errors).toEqual(["Guest detached"]);
  } finally {
    Object.assign(globalThis, { location: oldLocation, document: oldDocument });
  }
});

test("native history grants survive navigation and are all revoked when the owner closes", async () => {
  const saved = {
    location: globalThis.location,
    document: globalThis.document,
    ResizeObserver: globalThis.ResizeObserver,
  };
  Object.assign(globalThis, {
    location: new URL("ovule://-/main"),
    document: { documentElement: { dataset: {}, lang: "en" } },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  try {
    const revoked: string[] = [];
    let next = 0;
    const load = createExplorerLoader(async () => ({
      createFilePreview: async (url) => ({ id: String(++next).repeat(48), kind: "code", url }),
      createHtmlPreview: async () => {
        throw Error("unexpected");
      },
      revokePreview: async (id) => {
        revoked.push(id);
        return true;
      },
    }));
    const element = Object.assign(new EventTarget(), {
      dataset: {},
      src: "",
      isConnected: true,
      getBoundingClientRect: () => ({ width: 600, height: 400 }),
      load(source: string) {
        this.src = source;
      },
    }) as unknown as ExplorerElement;
    const dispose = load.observe(element);
    load(element, "file:///tmp/a.ts", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    load(element, "file:///tmp/b.py");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revoked).toEqual([]);
    dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revoked.sort()).toEqual(["1".repeat(48), "2".repeat(48)]);
  } finally {
    Object.assign(globalThis, saved);
  }
});

test("HTML source mode uses a file grant and preview mode restores native rendering", async () => {
  const saved = { location: globalThis.location, document: globalThis.document };
  Object.assign(globalThis, {
    location: new URL("ovule://-/main"),
    document: { documentElement: { dataset: {}, lang: "en" } },
  });
  try {
    const requests: string[] = [];
    const loader = createExplorerLoader(async () => ({
      createFilePreview: async (url) => {
        requests.push(url);
        return { id: "a".repeat(48), kind: "html", url };
      },
      createHtmlPreview: async () => {
        throw new Error("Unexpected workspace HTML");
      },
      revokePreview: async () => true,
    }));
    const element = {
      src: "",
      dataset: { previewMode: "source" },
      isConnected: true,
      getBoundingClientRect: () => ({ width: 500, height: 400 }),
      load(source: string) {
        this.src = source;
      },
    } as unknown as ExplorerElement;
    loader(element, "file:///tmp/demo.html");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toEqual(["file:///tmp/demo.html"]);
    expect(new URL(element.src).searchParams.get("mode")).toBe("source");
    element.dataset.previewMode = "preview";
    loader(element, "file:///tmp/demo.html");
    expect(element.src).toBe("file:///tmp/demo.html");
  } finally {
    Object.assign(globalThis, saved);
  }
});

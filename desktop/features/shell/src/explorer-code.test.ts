import { expect, test } from "bun:test";
import { installExplorerCode, fileCodeLanguage } from "./explorer-code";
import type { ExplorerElement } from "./explorer";

test("local code detection accepts source files and excludes web pages and directories", () => {
  expect(fileCodeLanguage("file:///tmp/My%20Code/APP.TSX?v=1")).toBe("tsx");
  expect(fileCodeLanguage("file:///tmp/Cargo.toml")).toBe("toml");
  expect(fileCodeLanguage("file:///tmp/Dockerfile")).toBe("dockerfile");
  for (const url of [
    "https://example.com/a.ts",
    "file:///tmp/a.ts/",
    "file:///tmp/index.html",
    "file:///tmp/a.pdf",
    "file:///tmp/%ZZ.ts",
    "bad",
  ]) {
    expect(fileCodeLanguage(url)).toBeUndefined();
  }
});

test("highlighter reads only eligible, loaded local documents", async () => {
  for (const state of [
    { url: "https://example.com/a.ts", documentId: "remote", isLoading: false },
    { url: "file:///tmp/a.ts", documentId: "loading", isLoading: true },
    { url: "file:///tmp/a.html", documentId: "html", isLoading: false },
  ]) {
    let reads = 0;
    const element = Object.assign(new EventTarget(), {
      getNavigationState: async () => state,
      executeJavaScript: async () => {
        reads++;
      },
    }) as unknown as ExplorerElement;
    const dispose = installExplorerCode(element);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reads).toBe(0);
    dispose();
  }
});

test("disposal prevents an outstanding document read from starting", async () => {
  let resolve!: (value: unknown) => void;
  let reads = 0;
  const element = Object.assign(new EventTarget(), {
    getNavigationState: () =>
      new Promise((done) => {
        resolve = done;
      }),
    executeJavaScript: async () => {
      reads++;
    },
  }) as unknown as ExplorerElement;
  const dispose = installExplorerCode(element);
  dispose();
  resolve({ url: "file:///tmp/a.ts", documentId: "old", isLoading: false });
  await new Promise((done) => setTimeout(done, 0));
  expect(reads).toBe(0);
});

test("highlighting produces colored safe text and binds writes to the original document", async () => {
  const calls: { source: string; documentId?: string }[] = [];
  let painted!: () => void;
  const ready = new Promise<void>((done) => {
    painted = done;
  });
  const element = Object.assign(new EventTarget(), {
    getNavigationState: async () => ({
      url: "file:///tmp/a.ts",
      documentId: "source-document",
      isLoading: false,
    }),
    executeJavaScript: async (source: string, options: { expectedDocumentId?: string }) => {
      calls.push({ source, documentId: options.expectedDocumentId });
      if (calls.length === 1) return 'const text = "<script>";';
      painted();
    },
  }) as unknown as ExplorerElement;
  const dispose = installExplorerCode(element);
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("highlight timeout")), 5000)),
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.documentId === "source-document")).toBe(true);
    expect(calls[1].source).toContain("span.textContent = token.text");
    expect(calls[1].source).toContain('"light":"#');
    expect(calls[1].source).toContain('"dark":"#');
  } finally {
    dispose();
  }
});

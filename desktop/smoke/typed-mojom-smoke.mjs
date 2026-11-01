import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_CDP_PORT);
const restart = process.env.OVULE_SMOKE_RESTART === "1";
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  let page;
  const deadline = Date.now() + 30_000;
  while (!page && Date.now() < deadline) {
    page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith("ovule://-/main"));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(page, "native app page");
  await page.waitForFunction(() => typeof globalThis.tuffite?.invoke === "function");
  const report = await page.evaluate(
    async ({ restart, workspace }) => {
      const api = await import("/shell_api.js");
      const framework = await import("/tuffite.js");
      if (Object.hasOwn(globalThis, "ovule")) throw new Error("legacy application global remains");
      const snapshot = await api.workspace.snapshot();
      const existing = snapshot.projects.find((project) => project.name === "Typed Mojom smoke");
      if (restart && !existing) throw new Error("project was not persisted across graceful exit");
      if (!restart) {
        await api.workspace.createProject("Typed Mojom smoke");
        const created = await api.workspace.createThread({ workspacePath: workspace });
        const thread = created.threads.at(-1);
        if (
          !thread ||
          typeof created.projects.find((project) => project.name === "Typed Mojom smoke")
            ?.createdAt !== "number"
        )
          throw new Error("typed timestamp response");
        const bytes = new Uint8Array([0, 1, 127, 255]);
        const saved = await api.content.saveWorkspaceFile(thread.id, "typed.csv", bytes);
        const loaded = await api.content.readWorkspaceFile(thread.id, "typed.csv");
        if (saved.sizeBytes !== 4n || loaded.bytes.join() !== bytes.join())
          throw new Error("Rust byte codec roundtrip");
      }
      const directories = await framework.path.directories();
      if (!directories.data) throw new Error("C++ typed response");
      const bytes = new Uint8Array([0, 42, 255]);
      await framework.fs.writeFile(framework.BaseDirectory.Data, "typed-probe.bin", bytes);
      const read = await framework.fs.readFile(framework.BaseDirectory.Data, "typed-probe.bin");
      if (read.join() !== bytes.join()) throw new Error("C++ byte codec roundtrip");
      await framework.fs.removeFile(framework.BaseDirectory.Data, "typed-probe.bin");
      const denied = async (operation) => {
        try {
          await operation();
        } catch (error) {
          if ((error.status ?? error.cause?.status) === 2) return true;
          throw error;
        }
        throw new Error("unauthorized call succeeded");
      };
      // The disposable fixture grants CreateProject but omits RenameProject.
      const rustDenied = await denied(() => api.workspace.renameProject("absent", "denied"));
      const cppDenied = await denied(() =>
        framework.fs.writeFile(framework.BaseDirectory.Resource, "forbidden.bin", bytes),
      );
      const rustScopeDenied = await denied(() => api.workspace.browserSuggestions(null, "query"));
      const cppScopeDenied = await denied(() => framework.dialog.openDirectory());
      const denyPrecedence = await denied(() =>
        framework.fs.writeFile(framework.BaseDirectory.Data, "protected.bin", bytes),
      );
      const traversalDenied = await denied(() =>
        framework.fs.writeFile(framework.BaseDirectory.Data, "../escape.bin", bytes),
      );
      let captured;
      let transportCalls = 0;
      const sentinel = new Error("capture-only transport");
      const capture = api.createOvuleApi(async (channel, id, fingerprint, payload) => {
        transportCalls++;
        captured = { channel, id, fingerprint, payload };
        throw sentinel;
      });
      // Invalid inputs must fail locally before dispatching anything.
      try {
        await capture.workspace.createProject(123);
      } catch (error) {
        if (error === sentinel) throw new Error("invalid input reached transport");
      }
      if (transportCalls !== 0) throw new Error("input validation dispatched IPC");
      const record = async (operation) => {
        try {
          await operation();
        } catch (error) {
          if (error === sentinel) return;
          throw error;
        }
        throw new Error("capture transport unexpectedly succeeded");
      };
      await record(() => capture.workspace.renameProject("absent", "denied"));
      const channelForgeryDenied = await denied(() =>
        framework.invokeBinary(
          "ovule.Workspace.Snapshot",
          captured.id,
          captured.fingerprint,
          captured.payload,
        ),
      );
      await record(() => capture.workspace.snapshot());
      let schemaMismatchRejected = false;
      try {
        await framework.invokeBinary(
          captured.channel,
          captured.id,
          captured.fingerprint ^ 1n,
          captured.payload,
        );
      } catch (error) {
        if (error.code !== "schema_mismatch") throw error;
        schemaMismatchRejected = true;
      }
      if (!schemaMismatchRejected) throw new Error("mismatched schema reached handler");
      return {
        restart,
        rustAllowed: true,
        rustDenied,
        cppAllowed: true,
        cppDenied,
        applicationGlobal: false,
        rustScopeDenied,
        cppScopeDenied,
        denyPrecedence,
        traversalDenied,
        channelForgeryDenied,
        schemaMismatchRejected,
        localInputValidation: true,
      };
    },
    { restart, workspace: process.env.OVULE_SMOKE_WORKSPACE },
  );
  console.log(JSON.stringify(report));
  await page
    .evaluate(async () => (await import("/tuffite.js")).window.close())
    .catch((error) => {
      if (!/closed|destroyed|Target/i.test(String(error))) throw error;
    });
} finally {
  await browser.close().catch(() => undefined);
}

import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { main, availablePort, waitFor, waitHttp } from "./runner.mjs";

await main("shell-api-status", async (c) => {
  await c.claimPackage();
  const port = await availablePort(0);
  const app = c.launch(port);
  await waitHttp(`http://127.0.0.1:${port}/json/version`, app);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const page = await waitFor(
      () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => /\/main$/.test(new URL(page.url()).pathname)),
      "main page",
    );
    await waitFor(
      async () =>
        page.evaluate(async () =>
          Boolean(await (await import("/shell_api.js")).workspace.snapshot()),
        ),
      "native snapshot",
    );
    const result = await page.evaluate(async () => {
      const framework = await import("/tuffite.js");
      const capture = async (request) => {
        try {
          await request();
          return { unexpectedSuccess: true };
        } catch (error) {
          return {
            code: error.code,
            status: error.cause?.status ?? error.status,
            message: error.message,
          };
        }
      };
      const mismatch = await capture(() =>
        framework.invokeBinary("ovule.Workspace.Snapshot", 0n, 0n, new Uint8Array(8)),
      );
      const denied = await capture(() =>
        globalThis.tuffite.invoke("tuffite.NotGranted.Run", new Uint8Array()),
      );
      const invalid = await capture(() =>
        globalThis.tuffite.invoke("tuffite.Window.SetBounds", new Uint8Array()),
      );
      const emptyCurrent = await capture(() =>
        globalThis.tuffite.invoke("tuffite.Window.Current", new Uint8Array()),
      );
      await (await import("/shell_api.js")).workspace.snapshot();
      return { mismatch, denied, invalid, emptyCurrent };
    });
    assert.equal(result.mismatch.code, "access_denied");
    assert.equal(result.mismatch.status, 2);
    assert.match(result.mismatch.message, /binding mismatch.*ovule.Workspace.Snapshot/);
    assert.match(result.mismatch.message, /Debug or Release/);
    assert.equal(result.denied.code, "access_denied");
    assert.match(result.denied.message, /ShellAPI access denied/);
    assert.equal(result.invalid.code, "invalid_argument");
    assert.equal(result.emptyCurrent.code, "invalid_argument");
    console.log(JSON.stringify(result));
    console.log(
      "shell_api_status=ok snapshot=true binding_mismatch=true dispatch_status_codes=true",
    );
  } finally {
    await browser.close();
  }
});

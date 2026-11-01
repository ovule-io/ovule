import assert from "node:assert/strict";
import http from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { main, availablePort, waitHttp, waitFor, sleep } from "./runner.mjs";
import { windowsProbe } from "./platform/windows/adapter.mjs";

await main("runtime-capabilities", async (c) => {
  await c.claimPackage();
  const total = 1024 * 1024;
  const server = http.createServer((request, response) => {
    if (request.url === "/runtime.bin") {
      const offset = Number(/^bytes=(\d+)-/.exec(request.headers.range ?? "")?.[1] ?? 0);
      response.writeHead(offset ? 206 : 200, {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="runtime.bin"',
        "accept-ranges": "bytes",
        "content-length": total - offset,
        ...(offset ? { "content-range": `bytes ${offset}-${total - 1}/${total}` } : {}),
      });
      let remaining = total - offset;
      const timer = setInterval(() => {
        const count = Math.min(8192, remaining);
        response.write(Buffer.alloc(count, 0x61));
        remaining -= count;
        if (!remaining) {
          clearInterval(timer);
          response.end();
        }
      }, 25);
      response.on("close", () => clearInterval(timer));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      '<!doctype html><title>Runtime fixture</title><a id="external" href="ovule-smoke-external://fixture">Open test application</a>',
    );
  });
  await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
  const url = `http://localhost:${server.address().port}`;
  const port = await availablePort(0);
  const appProcess = c.launch(port, { extra: ["--no-first-run", "--enable-logging", "--v=1"] });
  let browser;
  try {
    await waitHttp(`http://127.0.0.1:${port}/json/version`, appProcess, undefined, 120000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const page = await waitFor(
      () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page.url().startsWith("ovule://-/main")),
      "application window",
    );
    await page.waitForFunction(() => typeof globalThis.tuffite?.invoke === "function");
    const profiles = await page.evaluate(async () =>
      JSON.parse(await (await import("/shell_api.js")).terminal.shellProfiles()),
    );
    assert.ok(profiles.length > 0);
    assert.equal(new Set(profiles.map((profile) => profile.id)).size, profiles.length);
    const profile =
      profiles.find((profile) => profile.id === "cmd") ??
      profiles.find((profile) => profile.id === "sh") ??
      profiles[0];
    const session = await page.evaluate(
      async ({ profile, root }) => {
        const api = (await import("/shell_api.js")).terminal;
        const opened = JSON.parse(await api.openSession("smoke-pane", profile.id, root, 80, 24));
        const attached = JSON.parse(await api.openSession("smoke-pane", profile.id, root, 80, 24));
        if (opened.id !== attached.id) throw new Error("Reattach spawned another shell");
        await api.resizeSession(opened.id, 120, 32);
        return opened;
      },
      { profile, root: c.root },
    );
    const windows = profile.id === "cmd";
    await page.evaluate(
      async ({ id, command }) =>
        (await import("/shell_api.js")).terminal.writeSession(
          id,
          new TextEncoder().encode(command),
        ),
      {
        id: session.id,
        command: windows ? "set OVULE_PTY_VALUE=stateful\r" : "export OVULE_PTY_VALUE=stateful\n",
      },
    );
    await page.evaluate(
      async ({ id, command }) =>
        (await import("/shell_api.js")).terminal.writeSession(
          id,
          new TextEncoder().encode(command),
        ),
      {
        id: session.id,
        command: windows
          ? "echo __%OVULE_PTY_VALUE%__\r"
          : "printf '__%s__\\n' \"$OVULE_PTY_VALUE\"\n",
      },
    );
    let cursor = 0n;
    let output = "";
    await waitFor(async () => {
      const read = await page.evaluate(
        async ({ id, cursor }) =>
          JSON.parse(
            await (await import("/shell_api.js")).terminal.readSession(id, BigInt(cursor)),
          ),
        { id: session.id, cursor: String(cursor) },
      );
      cursor = BigInt(read.cursor);
      output += Buffer.from(read.data).toString("utf8");
      if (output.includes("\x1b[6n"))
        await page.evaluate(
          async (id) =>
            (await import("/shell_api.js")).terminal.writeSession(
              id,
              new TextEncoder().encode("\x1b[1;1R"),
            ),
          session.id,
        );
      return output.includes("__stateful__");
    }, "persistent native PTY output");
    assert.equal(
      await page.evaluate(
        async (id) => (await import("/shell_api.js")).terminal.closeSession(id),
        session.id,
      ),
      true,
    );
    console.log("native_pty=passed profiles, input, state, resize, reattach, close");

    await page.evaluate(async (url) => {
      const element = document.createElement("explorer");
      element.behavior = "navigation: browser;";
      element.allow = "publickey-credentials-get *; publickey-credentials-create *";
      element.style.cssText = "position:fixed;inset:0;display:block;z-index:99999";
      const ready = new Promise((accept) =>
        element.addEventListener("loadstop", accept, { once: true }),
      );
      element.src = url;
      document.body.append(element);
      window.runtimeExplorer = element;
      await ready;
    }, url);
    const guest = await waitFor(
      () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page.url() === `${url}/`),
      "Explorer fixture",
    );
    const browserCdp = await browser.newBrowserCDPSession();
    await browserCdp.send("Browser.setDownloadBehavior", { behavior: "default" });
    assert.equal(
      await page.evaluate((url) => runtimeExplorer.download(`${url}/runtime.bin`), url),
      true,
    );
    const download = await waitFor(
      () =>
        page.evaluate(async () =>
          (await runtimeExplorer.getDownloads()).find((item) => item.receivedBytes > 0),
        ),
      "download progress",
    );
    const foreign = await page.evaluate(
      async ({ id, url }) => {
        const element = document.createElement("explorer");
        const ready = new Promise((accept) =>
          element.addEventListener("loadstop", accept, { once: true }),
        );
        element.src = url;
        document.body.append(element);
        await ready;
        const result = [
          await element.pauseDownload(id),
          await element.resumeDownload(id),
          await element.cancelDownload(id),
        ];
        element.remove();
        return result;
      },
      { id: download.id, url },
    );
    assert.deepEqual(foreign, [false, false, false]);
    assert.equal(await page.evaluate((id) => runtimeExplorer.pauseDownload(id), download.id), true);
    await waitFor(
      () =>
        page.evaluate(
          async (id) =>
            (await runtimeExplorer.getDownloads()).find(
              (item) => item.id === id && item.paused && item.canResume,
            ),
          download.id,
        ),
      "paused download",
    );
    await sleep(150);
    assert.equal(
      await page.evaluate((id) => runtimeExplorer.resumeDownload(id), download.id),
      true,
    );
    const completed = await waitFor(
      () =>
        page.evaluate(
          async (id) =>
            (await runtimeExplorer.getDownloads()).find(
              (item) => item.id === id && item.state === "complete",
            ),
          download.id,
        ),
      "resumed download completion",
    );
    assert.equal(completed.receivedBytes, total);
    const directory = join(c.root, "downloads");
    await mkdir(directory);
    const published = await page.evaluate(
      async ({ completed, directory }) => {
        const api = (await import("/shell_api.js")).browser;
        await api.setDownloadDirectory(directory);
        const record = await api.publishDownload(completed.path, completed.url);
        return { ...record, bytes: String(record.bytes), createdAt: String(record.createdAt) };
      },
      { completed, directory },
    );
    assert.equal(published.bytes, String(total));
    console.log("native_downloads=passed ownership, pause, resume, completion, publication");

    if (process.platform === "win32") {
      await windowsProbe("foreground", c.packageRoot);
      await guest.bringToFront();
      console.log(
        "external_fixture=" +
          JSON.stringify(
            await guest.evaluate(() => ({
              visibility: document.visibilityState,
              focused: document.hasFocus(),
            })),
          ),
      );
      await guest.locator("#external").click();
      try {
        console.log(await windowsProbe("external-protocol-dismiss", c.packageRoot));
      } catch (error) {
        console.log(await windowsProbe("owned-tree", c.packageRoot));
        throw error;
      }
      assert.equal(guest.url(), `${url}/`);
      await page.evaluate(() => runtimeExplorer.load("ovule-smoke-external://typed"));
      console.log(await windowsProbe("external-protocol-dismiss", c.packageRoot));
    } else
      console.log(
        "SKIP external protocol native dialog dismissal: Windows UIAutomation adapter required",
      );

    await page.evaluate(() => {
      window.externalRequests = [];
      runtimeExplorer.behavior = "navigation: browser; external-protocol: delegate timeout(1s);";
      runtimeExplorer.addEventListener("externalprotocol", (event) => {
        event.preventDefault();
        window.externalRequests.push(event.detail);
      });
    });
    await guest.locator("#external").click();
    await waitFor(
      () => page.evaluate(() => externalRequests.length === 1),
      "delegated external protocol",
    );
    const delegated = await page.evaluate(async () => {
      const request = externalRequests[0];
      return {
        url: request.url,
        origin: request.initiatingOrigin,
        dismissed: await request.dismiss(),
        duplicate: await request.accept(),
      };
    });
    assert.equal(delegated.url, "ovule-smoke-external://fixture");
    assert.equal(delegated.origin, new URL(url).origin);
    assert.equal(delegated.dismissed, true);
    assert.equal(delegated.duplicate, false);
    await page.evaluate(() => {
      runtimeExplorer.behavior = "external-protocol: delegate timeout(40ms);";
    });
    await guest.locator("#external").click();
    await waitFor(
      () => page.evaluate(() => externalRequests[1]?.signal.aborted),
      "external protocol deadline",
    );
    assert.equal(await page.evaluate(() => externalRequests[1].accept()), false);
    await page.evaluate(() => {
      runtimeExplorer.behavior = "external-protocol: block;";
      runtimeExplorer.load("ovule-smoke-external://blocked");
    });
    await sleep(150);
    assert.equal(await page.evaluate(() => externalRequests.length), 2);
    if (process.platform === "win32") {
      assert.doesNotMatch(
        await windowsProbe("owned-tree", c.packageRoot),
        /Open an external application\?/,
      );
    }
    console.log("explorer_behavior=passed delegate, origin, one-shot, timeout, block");

    const cdp = await guest.context().newCDPSession(guest);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    const result = await guest.evaluate(async () => {
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { id: "localhost", name: "Ovule smoke" },
          user: { id: new Uint8Array([1, 2, 3]), name: "fixture", displayName: "Fixture" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          timeout: 10000,
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            residentKey: "required",
            userVerification: "required",
          },
        },
      });
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: "localhost",
          userVerification: "required",
          timeout: 10000,
          allowCredentials: [{ type: "public-key", id: credential.rawId }],
        },
      });
      return { available, matches: assertion.id === credential.id };
    });
    assert.deepEqual(result, { available: true, matches: true });
    console.log("webauthn_virtual_platform=passed resident credential create/assert");
    console.log(
      "SKIP physical Windows Hello, Touch ID and iCloud passkeys: real platform credentials required",
    );
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise((accept) => server.close(accept));
  }
});

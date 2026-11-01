import assert from "node:assert/strict";
import path from "node:path";
import http from "node:http";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { main, availablePort, port, waitFor, waitHttp } from "./runner.mjs";

await main("pane-experience", async (c) => {
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9291));
  let expandedCatalog = false;
  let providerRequests = 0;
  const provider = http.createServer((request, response) => {
    if (request.headers.authorization !== "Bearer sk-pane-smoke-credential-1234567890") {
      response.writeHead(401).end();
      return;
    }
    providerRequests++;
    const ids = [
      "deepseek-flash",
      "deepseek-v4-pro",
      ...(expandedCatalog ? ["deepseek-test-new-model"] : []),
    ];
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const app = c.launch(number, {
    extraEnv: {
      OVULE_TEST_MODE: "1",
      OVULE_TEST_DEEPSEEK_MODELS_ENDPOINT: `http://127.0.0.1:${provider.address().port}/models`,
    },
  });
  let browser;
  try {
    await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${number}`);
    const pages = () => browser.contexts().flatMap((context) => context.pages());
    const page = await waitFor(
      async () => {
        for (const candidate of pages())
          if (await candidate.locator(".titlebar").count()) return candidate;
      },
      "main titlebar",
      90000,
    );
    await page.getByRole("button", { name: "Close setup", exact: true }).click();
    await page.getByRole("button", { name: "New Conversation", exact: true }).click();
    const thread = await waitFor(
      () => pages().find((p) => new URL(p.url()).pathname === "/thread"),
      "thread",
    );
    const request = async (channel, payload) =>
      thread.evaluate(
        ({ channel, payload }) =>
          new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timer = setTimeout(() => {
              tuffite.removeEventListener("message", receive);
              reject(new Error(`Timeout: ${channel}`));
            }, 10000);
            const receive = (event) => {
              const data = event.data;
              if (data?.type !== "app-response" || data.requestId !== requestId) return;
              clearTimeout(timer);
              tuffite.removeEventListener("message", receive);
              if (data.error) reject(new Error(data.error));
              else resolve(data.result);
            };
            tuffite.addEventListener("message", receive);
            tuffite.postMessage(
              { type: "app-request", requestId, channel, payload },
              { targetOrigin: location.origin },
            );
          }),
        { channel, payload },
      );

    const threadId = await page.evaluate(async () => {
      const api = (await import("/shell_api.js")).workspace;
      const before = new Set((await api.snapshot()).threads.map((t) => t.id));
      const after = await api.createThread({});
      return after.threads.find((t) => !before.has(t.id))?.id;
    });
    assert.ok(threadId);
    await request("workspace.refresh", {});
    await request("thread.select", { threadId });
    const terminal = await request("workbench.open", {
      kind: "terminal",
      threadId,
      newInstance: true,
      placement: "thread",
    });
    const guestFor = (tabId) =>
      waitFor(
        () => pages().find((p) => new URL(p.url()).searchParams.get("tab") === tabId),
        `pane ${tabId}`,
      );
    const terminalPage = await guestFor(terminal.tabId);
    await terminalPage.locator(".xterm-screen").waitFor();
    const fit = async () => {
      try {
        await terminalPage.waitForFunction(
          () => {
            const screen = document.querySelector(".xterm-screen")?.getBoundingClientRect();
            return screen && innerHeight - screen.bottom >= 0 && innerHeight - screen.bottom < 35;
          },
          undefined,
          { timeout: 5000 },
        );
      } catch (error) {
        console.log(
          await terminalPage.evaluate(() =>
            Array.from(document.querySelectorAll("html,body,.terminal-panel,.xterm-screen")).map(
              (e) => ({
                tag: e.tagName,
                cls: e.className,
                rect: e.getBoundingClientRect().toJSON(),
                height: getComputedStyle(e).height,
                rows: getComputedStyle(e).gridTemplateRows,
                display: getComputedStyle(e).display,
                viewport: innerHeight,
              }),
            ),
          ),
        );
        await page.screenshot({ path: path.join(c.artifacts, "terminal-fit-failure.png") });
        throw error;
      }
      const dimensions = await terminalPage.evaluate(() => ({
        height: innerHeight,
        bottom: document.querySelector(".xterm-screen").getBoundingClientRect().bottom,
      }));
      console.log(`terminal_fit=${JSON.stringify(dimensions)}`);
    };
    await fit();
    await terminalPage.locator(".xterm-helper-textarea").evaluate((element) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "unsent-pane-marker");
      element.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
      );
    });
    await terminalPage.waitForFunction(() =>
      document.querySelector(".xterm-screen").textContent.includes("unsent-pane-marker"),
    );
    const marker = await terminalPage.evaluate(() => (window.paneTestMarker = crypto.randomUUID()));
    await page.screenshot({ path: path.join(c.artifacts, "terminal-fill.png") });
    const initialBounds = await page.evaluate(async () => {
      const { window: api } = await import("/tuffite.js");
      const current = await api.current();
      await api.setBounds({ ...current.bounds, height: 900 });
      return current.bounds;
    });
    await terminalPage.waitForFunction(() => innerHeight > 700);
    await fit();
    const filePath = path.join(c.root, "pane-readme.md");
    await writeFile(filePath, "# Pane preview\n\n**Markdown content**\n");
    const files = await request("workbench.open", {
      kind: "files",
      threadId,
      newInstance: true,
      target: filePath,
      placement: "thread",
    });
    const filesPage = await guestFor(files.tabId);
    await filesPage.locator(".milkdown").waitFor();
    await filesPage.getByText("Markdown content", { exact: true }).waitFor();
    assert.equal(await filesPage.getByText("Workspace:", { exact: false }).count(), 0);
    await page.locator(".pane-active-tab").filter({ hasText: filePath }).waitFor();
    await page.screenshot({ path: path.join(c.artifacts, "markdown-titlebar.png") });
    await request("tab.select", { tabId: terminal.tabId });
    assert.equal(
      await terminalPage.evaluate(() => window.paneTestMarker),
      marker,
      "Switching tabs preserves the existing terminal page",
    );
    await fit();
    await terminalPage.waitForFunction(() =>
      document.querySelector(".xterm-screen").textContent.includes("unsent-pane-marker"),
    );
    await page.evaluate(
      async (bounds) => (await import("/tuffite.js")).window.setBounds(bounds),
      initialBounds,
    );
    await page.evaluate(async () =>
      (await import("/shell_api.js")).setup.runExtensionSetupAction({
        extensionId: "io.ovule.provider.deepseek",
        setupId: "deepseek",
        actionId: "configure",
        values: [{ id: "apiKey", value: "sk-pane-smoke-credential-1234567890" }],
      }),
    );
    expandedCatalog = true;
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Models", exact: true }).click();
    await page.getByRole("button", { name: "DeepSeek · Refresh models", exact: true }).click();
    await waitFor(
      () =>
        page.evaluate(async () =>
          (await (await import("/shell_api.js")).workspace.snapshot()).models.some(
            (model) => model.remoteId === "deepseek-test-new-model",
          ),
        ),
      "new provider model discovered by refresh",
    );
    assert.equal(
      providerRequests,
      2,
      "Refresh reuses the saved credential for exactly one catalog request",
    );
    await page.getByText("deepseek-test-new-model", { exact: true }).waitFor();
    console.log(
      "pane_experience=ok terminal_fill=true resize_fit=true terminal_retained=true markdown_title_path=true no_warning_bar=true saved_credential_refresh=true dynamic_models=true",
    );
  } finally {
    await browser?.close();
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
  }
});

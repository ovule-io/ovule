import { closedNodes, callClosed, clickClosed } from "./isolated-dom.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { main, availablePort, port, waitHttp, waitFor } from "./runner.mjs";
await main("cloudflare-setup", async (c) => {
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9277));
  const app = c.launch(number, {
    singleProcess: process.platform === "win32",
    extra: process.platform === "win32" ? [] : ["--headless", "--no-sandbox"],
  });
  await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${number}`);
  try {
    const page = await waitFor(async () => {
      for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
        if (
          await candidate
            .evaluate(
              async () =>
                typeof (await import("/shell_api.js")).extensions.extensionCatalog === "function",
            )
            .catch(() => false)
        )
          return candidate;
      }
    }, "workspace API");
    const result = await page.evaluate(async () => {
      localStorage.setItem("ovule.onboarding.dismissed", "true");
      const api = await import("/shell_api.js").then((api) => ({
        ...api.workspace,
        ...api.extensions,
        ...api.setup,
        ...api.workflow,
        ...api.message,
        ...api.content,
        ...api.terminal,
        ...api.settings,
      }));
      const catalog = await api.extensionCatalog();
      const command = catalog.slashCommands.find((value) => value.id === "cloudflare");
      const block = catalog.messageBlocks.find((value) => value.kind === "cloudflare-connectivity");
      const snapshot = await api.createThread({});
      const id = snapshot.selectedThreadId ?? snapshot.threads.at(-1).id;
      const sent = await api.sendMessage(id, "/cloudflare");
      let denied = false;
      try {
        await api.runExtensionAction({
          extensionId: "io.ovule.connectivity.cloudflare",
          actionId: "create",
          connectionId: "a".repeat(32),
        });
      } catch {
        denied = true;
      }
      return {
        command,
        block,
        id,
        attemptsBefore: snapshot.attempts.length,
        attemptsAfter: sent.attempts.length,
        card: sent.messages.some((message) =>
          message.parts.some(
            (part) => part.kind === "cloudflare-connectivity" && part.dataJson === "{}",
          ),
        ),
        denied,
      };
    });
    assert.ok(result.command);
    assert.ok(result.block.moduleUrl.endsWith("/dist/ui.js"));
    assert.equal(result.block.hostRenderer, undefined);
    assert.equal(result.attemptsAfter, result.attemptsBefore);
    assert.ok(result.card);
    assert.ok(result.denied);
    const threadUrl = new URL("/thread", page.url());
    threadUrl.searchParams.set("thread", result.id);
    await page.goto(threadUrl.href);
    const liveCard = page.locator(
      '[data-message-block-kind="cloudflare-connectivity"][data-registry="isolated-world"]',
    );
    await liveCard.waitFor();
    await liveCard.evaluate((element) => {
      element.id = "cloudflare-production-card";
    });
    const liveScope = { id: "cloudflare-production-card" };
    await waitFor(
      async () => (await closedNodes(page, liveScope, (node) => node.tag === "section")).length,
      "native message component",
    );
    assert.notEqual(await liveCard.evaluate((block) => getComputedStyle(block).minHeight), "280px");
    // Exercise the production request bridge from its owning realm. No live authorization exists.
    const cdp = await page.context().newCDPSession(page);
    const contexts = [];
    cdp.on("Runtime.executionContextCreated", ({ context }) => contexts.push(context));
    await cdp.send("Runtime.enable");
    const context = contexts.find((context) => context.name === "io.ovule.connectivity.cloudflare");
    assert.ok(context);
    const bridge = await cdp.send("Runtime.evaluate", {
      contextId: context.id,
      expression: `(async () => {
      const host=document.querySelector('#cloudflare-production-card');
      // Native DOM inspection below resolves the closed element in this realm.
      return !!host;
    })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    assert.equal(bridge.result.value, true);
    const nodes = await closedNodes(
      page,
      liveScope,
      (node) => node.tag === "ovule-cloudflare-connectivity",
    );
    const { object } = await cdp.send("DOM.resolveNode", {
      backendNodeId: nodes[0].backendNodeId,
      executionContextId: context.id,
    });
    const reply = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration:
        "function(){return tuffite.isolated.context(this).request('extension.action',{action:'open-external'});}",
      awaitPromise: true,
      returnByValue: true,
    });
    await cdp.send("Runtime.releaseObject", { objectId: object.objectId });
    await cdp.detach();
    assert.equal(reply.result.value.action, "open-external");
    assert.match(reply.result.value.error, /No active Cloudflare authorization/);
    // Separate mounted view with deterministic host replies: credentials never enter the fixture.
    await page.evaluate(async () => {
      const host = document.createElement("div");
      host.id = "cloudflare-fixture";
      document.body.append(host);
      window.cloudflareActions = [];
      window.cloudflarePhase = "idle";
      window.cloudflareWorld = await tuffite.isolated.createWorld({
        name: "io.ovule.connectivity.cloudflare",
      });
      window.cloudflareView = await cloudflareWorld.mount(host, {
        tag: "ovule-cloudflare-connectivity",
        properties: { lang: "zh-CN" },
        onRequest: async ({ method, params }) => {
          if (method !== "extension.action") throw new Error("Unexpected method");
          cloudflareActions.push(params);
          if (params.action === "login") cloudflarePhase = "authorizing";
          if (params.action === "open-external") cloudflarePhase = "choose-account";
          if (params.action === "create") cloudflarePhase = "configured";
          if (params.action === "status" && window.cloudflareHoldStatus)
            await new Promise((resolve) => {
              window.cloudflareReleaseStatus = resolve;
            });
          if (window.cloudflareFailStatus) {
            window.cloudflareFailStatus = false;
            return { action: params.action, error: "Fixture status request failed" };
          }
          return {
            action: params.action,
            data: {
              phase: cloudflarePhase,
              authorizationUrl: "https://dash.cloudflare.com/oauth2/auth?state=fixture",
              accounts: [
                { id: "a".repeat(32), name: '<img src=x onerror="throw 1">' },
                { id: "b".repeat(32), name: "Personal" },
              ],
              apiToken: "MUST-NOT-RENDER",
            },
          };
        },
      });
    });
    const scope = { id: "cloudflare-fixture" };
    const button = (label) =>
      closedNodes(page, scope, (node) => node.tag === "button" && node.text.trim() === label);
    await waitFor(async () => (await button("登录 Cloudflare")).length, "fixture login");
    await clickClosed(page, scope, "登录 Cloudflare");
    await waitFor(
      async () => (await button("在 Workbench 打开授权页面")).length,
      "fixture authorization",
    );
    await clickClosed(page, scope, "在 Workbench 打开授权页面");
    await waitFor(
      async () =>
        page.evaluate(
          () => !window.cloudflareActions.at(-1) || cloudflareActions.at(-1).action === "open",
        ),
      "open action",
    );
    await clickClosed(page, scope, "在系统浏览器继续授权");
    const select = await waitFor(
      async () => (await closedNodes(page, scope, (node) => node.tag === "select"))[0],
      "account selection",
    );
    await callClosed(
      page,
      select,
      "function(){this.value='b'.repeat(32);this.dispatchEvent(new Event('change'));}",
    );
    assert.equal((await closedNodes(page, scope, (node) => node.tag === "img")).length, 0);
    assert.equal(
      (await closedNodes(page, scope, (node) => node.text.includes("MUST-NOT-RENDER"))).length,
      0,
    );
    await clickClosed(page, scope, "在此账户启用连接服务");
    await waitFor(async () => (await button("刷新状态")).length, "configured status");
    assert.equal(
      await page.evaluate(
        () => cloudflareActions.find((action) => action.action === "create").connectionId,
      ),
      "b".repeat(32),
    );
    assert.equal((await button("登录 Cloudflare")).length, 0);
    await page.evaluate(() => {
      window.cloudflareHoldStatus = true;
    });
    await clickClosed(page, scope, "刷新状态");
    const refreshing = await waitFor(
      async () => (await button("正在刷新…"))[0],
      "refresh progress",
    );
    assert.equal(await callClosed(page, refreshing, "function(){return this.disabled;}"), true);
    await page.evaluate(() => {
      window.cloudflareHoldStatus = false;
      window.cloudflareReleaseStatus();
    });
    await waitFor(
      async () =>
        (
          await closedNodes(
            page,
            scope,
            (node) => node.attributes.role === "status" && node.text.includes("已刷新"),
          )
        ).length,
      "refresh feedback",
    );
    await page.evaluate(() => {
      window.cloudflareFailStatus = true;
    });
    await clickClosed(page, scope, "刷新状态");
    await waitFor(
      async () =>
        (
          await closedNodes(
            page,
            scope,
            (node) =>
              node.attributes.role === "alert" &&
              node.text.includes("Fixture status request failed"),
          )
        ).length,
      "refresh failure",
    );
    await clickClosed(page, scope, "刷新状态");
    await waitFor(
      async () =>
        (await closedNodes(page, scope, (node) => node.attributes.role === "alert")).length === 0,
      "refresh retry",
    );
    await page.evaluate(() => cloudflareView.update({ lang: "en", streaming: false }));
    await waitFor(
      async () =>
        (
          await closedNodes(page, scope, (node) =>
            node.text.includes("Verify from a paired device"),
          )
        ).length,
      "English configured status",
    );
    await page.screenshot({ path: join(c.artifacts, "cloudflare-isolated-card.png") });
    await page.evaluate(() => cloudflareWorld.dispose());
    console.log(
      "cloudflare_setup=ok slash=true isolated_world=true production_bridge=true account_selection=true safe_text=true configured_refresh=true refresh_busy=true refresh_feedback=true refresh_error_retry=true real_cloud_mutation=false",
    );
  } finally {
    await browser.close();
  }
});

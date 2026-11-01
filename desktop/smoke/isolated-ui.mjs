import { readFile } from "node:fs/promises";
import ts from "typescript";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { clickClosed, fillClosed, closedNodes, callClosed } from "./isolated-dom.mjs";

/** Run against a native App page with the Ovule UI snapshots registered. No live credentials or mutations. */
export async function smokeIsolatedUi(page) {
  const source = await readFile(
    new URL("../features/message-parts/src/interactive-frame.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    })
    .outputText.replace("export function mountInteractiveFrame", "function mountInteractiveFrame");
  await page.evaluate(compiled + "\nglobalThis.mountFrameSmoke=mountInteractiveFrame;");
  const mountSource = await readFile(
    new URL("../features/shell/src/isolated.ts", import.meta.url),
    "utf8",
  );
  const mountCompiled = ts
    .transpileModule(mountSource, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    })
    .outputText.replace("export const mountIsolated", "const mountIsolated");
  await page.evaluate(
    "(()=>{" + mountCompiled + ";globalThis.mountIsolatedSmoke=mountIsolated;})()",
  );
  const cdp = await page.context().newCDPSession(page);
  const contexts = [];
  cdp.on("Runtime.executionContextCreated", ({ context }) => contexts.push(context));
  await cdp.send("Runtime.enable");
  const definitions = [
    [
      "io.ovule.agent.codex",
      "ovule-onboarding",
      { status: { authenticated: false, detail: "Codex setup" } },
    ],
    [
      "io.ovule.provider.deepseek",
      "ovule-onboarding",
      { status: { authenticated: false, detail: "DeepSeek setup" } },
    ],
    [
      "io.ovule.host",
      "ovule-onboarding",
      { status: { authenticated: false, detail: "Ollama setup" } },
    ],
    ["io.ovule.connectivity.cloudflare", "ovule-cloudflare-connectivity", null],
    ["io.ovule.visuals", "ovule-echarts", null],
    ["io.ovule.visuals", "ovule-excalidraw", null],
    ["io.ovule.visuals", "ovule-office-editor", null],
  ];
  await page.evaluate(async (definitions) => {
    globalThis.uiSmoke = { worlds: [], views: [], requests: [], exported: [] };
    for (let index = 0; index < definitions.length; index++) {
      const [name, tag, setup] = definitions[index];
      const host = document.createElement("div");
      host.id = `ui-smoke-${index}`;
      host.style.cssText = "width:800px;min-height:100px";
      document.body.append(host);
      const world = await tuffite.isolated.createWorld({ name });
      const properties = setup ? { setup, lang: "en", progress: "" } : { lang: "en" };
      const view = await world.mount(host, {
        tag,
        properties,
        onRequest: async ({ method, params }) => {
          uiSmoke.requests.push({ index, method, params });
          if (method === "extension.action")
            return {
              action: params.action,
              data: { phase: params.action === "login" ? "configured" : "idle" },
            };
          if (method === "file.export") {
            uiSmoke.exported.push(...params.bytes);
            return null;
          }
          if (method === "file.exportError") throw new Error(params.message);
          if (!["onboarding.action", "onboarding.open", "compose", "file.dirty"].includes(method))
            throw new Error("Unexpected request: " + method);
          return null;
        },
      });
      uiSmoke.worlds.push(world);
      uiSmoke.views.push(view);
      if (tag === "ovule-echarts")
        await view.update({
          data: {
            option: {
              xAxis: { type: "category", data: ["a"] },
              yAxis: {},
              series: [{ type: "bar", data: [42] }],
            },
          },
        });
      if (tag === "ovule-excalidraw")
        await view.update({
          data: {
            title: "Drawing",
            elements: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 50 }],
          },
        });
      if (tag === "ovule-office-editor") {
        const bytes = Array.from(new TextEncoder().encode("name,value\nhello,42\n"));
        await view.update({
          fileChunk: {
            offset: 0,
            bytes,
            done: true,
            metadata: { name: "fixture.csv", extension: "csv", readOnly: false },
          },
        });
      }
    }
    const frameHost = document.createElement("div");
    frameHost.id = "ui-smoke-frame";
    document.body.append(frameHost);
    const before = uiSmoke.worlds.length;
    uiSmoke.frameCleanup = mountFrameSmoke(
      frameHost,
      {
        title: "Generated card",
        html: '<button id="choose">Choose</button><script>document.querySelector("#choose").addEventListener("click",()=>window.ovule.compose("Verify this choice"));</script>',
      },
      (prompt) => uiSmoke.requests.push({ method: "compose", params: { prompt } }),
    );
    uiSmoke.directFrame = uiSmoke.worlds.length === before;
  }, definitions);
  await fillClosed(page, { id: "ui-smoke-1" }, "DeepSeek API key", "smoke-placeholder");
  await clickClosed(page, { id: "ui-smoke-1" }, "Save API key");
  await page.waitForFunction(() =>
    uiSmoke.requests.some((r) => r.index === 1 && r.method === "onboarding.action"),
  );
  assert.deepEqual(
    await page.evaluate(
      () => uiSmoke.requests.find((r) => r.index === 1 && r.method === "onboarding.action").params,
    ),
    { actionId: "configure", values: { apiKey: "smoke-placeholder" } },
  );
  await page.evaluate(() =>
    uiSmoke.views[1].update({ setup: { status: { authenticated: true, detail: "Configured" } } }),
  );
  assert.equal(
    (await closedNodes(page, { id: "ui-smoke-1" }, (node) => node.tag === "input")).length,
    0,
  );
  await clickClosed(page, { id: "ui-smoke-1" }, "Refresh models");
  await page.waitForFunction(() =>
    uiSmoke.requests.some((r) => r.index === 1 && r.params?.actionId === "refresh"),
  );
  await clickClosed(page, { id: "ui-smoke-0" }, "Sign in with ChatGPT");
  await page.waitForFunction(() =>
    uiSmoke.requests.some((r) => r.index === 3 && r.method === "extension.action"),
  );
  await clickClosed(page, { id: "ui-smoke-3" }, "Sign in to Cloudflare");
  for (let attempt = 0; attempt < 100; attempt++) {
    const inputs = await closedNodes(page, { id: "ui-smoke-6" }, (node) => node.tag === "input");
    if (inputs.length) {
      await callClosed(
        page,
        inputs[0],
        "function(){this.value='edited';this.dispatchEvent(new Event('input',{bubbles:true}));}",
      );
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.evaluate(() => uiSmoke.views[6].update({ exportRevision: 1 }));
  await page.waitForFunction(() => uiSmoke.exported.length > 0);
  assert.match(
    await page.evaluate(() => new TextDecoder().decode(Uint8Array.from(uiSmoke.exported))),
    /edited,value\nhello,42/,
  );
  assert.ok(
    (await closedNodes(page, { id: "ui-smoke-4" }, (node) => node.tag === "canvas")).length,
    "ECharts canvas",
  );
  for (const [index, selector, property, expected] of [
    [5, "svg", "minHeight", "160px"],
    [6, ".office-root", "overflow", "auto"],
  ]) {
    const [element] = await closedNodes(page, { id: `ui-smoke-${index}` }, (node) =>
      selector === "svg" ? node.tag === "svg" : node.attributes.class === "office-root",
    );
    assert.ok(element, `Styled visual component: ${selector}`);
    assert.equal(
      await callClosed(
        page,
        element,
        "function(property){return getComputedStyle(this)[property];}",
        [property],
      ),
      expected,
      `Native CSS module applies inside ${selector}'s shadow root`,
    );
  }
  const browserCdp = await page.context().browser().newBrowserCDPSession();
  const { targetInfos } = await browserCdp.send("Target.getTargets");
  const frameNodes = await closedNodes(
    page,
    { id: "ui-smoke-frame" },
    (node) => node.tag === "iframe",
  );
  assert.ok(frameNodes[0]?.frameId, "Generated frame belongs to this surface");
  const target = targetInfos.find(
    (target) => target.targetId === frameNodes[0].frameId && target.type === "iframe",
  );
  assert.ok(target, "Generated HTML has a sandbox frame target");
  const { sessionId } = await browserCdp.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: false,
  });
  let next = 0;
  const pending = new Map();
  browserCdp.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const handlers = pending.get(message.id);
    if (!handlers) return;
    pending.delete(message.id);
    message.error
      ? handlers.reject(new Error(JSON.stringify(message.error)))
      : handlers.resolve(message.result);
  });
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Sandbox CDP timeout: ${method}`));
      }, 10000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      void browserCdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch(reject);
    });
  await command("Runtime.enable");
  await command("Runtime.runIfWaitingForDebugger");
  const frameResult = await command("Runtime.evaluate", {
    expression: `JSON.stringify({url:location.href,body:document.body?.innerHTML,opaque:(()=>{try{void parent.document;return false;}catch{return true;}})()})`,
    returnByValue: true,
  });
  const info = JSON.parse(frameResult.result.value);
  assert.equal(info.opaque, true, "Generated code cannot access the App DOM");
  assert.ok(info.body?.includes("choose"), "Generated UI loaded");
  const click = await command("Runtime.evaluate", {
    expression: `document.querySelector('#choose').click()`,
    returnByValue: true,
  });
  assert.ok(!click.exceptionDetails, JSON.stringify(click.exceptionDetails));
  await browserCdp.send("Target.detachFromTarget", { sessionId });
  await browserCdp.detach();
  await page.waitForFunction(() => uiSmoke.requests.some((r) => r.method === "compose"));
  for (const name of new Set(definitions.map((d) => d[0]))) {
    const context = contexts.find((context) => context.name === name);
    assert.ok(context, `Native isolated execution context: ${name}`);
    const result = await cdp.send("Runtime.evaluate", {
      contextId: context.id,
      expression:
        "JSON.stringify({name:tuffite.isolated.name,registry:typeof tuffite.isolated.customElements.define,shell:typeof tuffite.invoke})",
      returnByValue: true,
    });
    assert.deepEqual(JSON.parse(result.result.value), {
      name,
      registry: "function",
      shell: "undefined",
    });
  }
  const sharedBefore = contexts.filter((context) => context.name === "io.ovule.visuals").length;
  await page.evaluate(async () => {
    const containers = Array.from({ length: 40 }, () => {
      const node = document.createElement("div");
      document.body.append(node);
      return node;
    });
    const views = await Promise.all(
      containers.map((node) =>
        mountIsolatedSmoke(node, "io.ovule.visuals", "ovule-excalidraw", {
          data: { elements: [] },
        }),
      ),
    );
    await views[0].dispose();
    await views[1].update({ data: { title: "Still mounted", elements: [] } });
    uiSmoke.sharedViews = views;
    uiSmoke.sharedContainers = containers;
  });
  await page.evaluate(() => null);
  assert.equal(
    contexts.filter((context) => context.name === "io.ovule.visuals").length - sharedBefore,
    1,
    "40 message parts share one extension world",
  );
  await page.evaluate(async () => {
    for (const view of uiSmoke.sharedViews) await view.dispose();
    let rejected = false;
    try {
      await uiSmoke.sharedViews[1].update({ data: { elements: [] } });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Disposed shared view accepted an update");
    for (const node of uiSmoke.sharedContainers) node.remove();
  });
  if (process.env.OVULE_ISOLATED_SCREENSHOT)
    await page.screenshot({ path: process.env.OVULE_ISOLATED_SCREENSHOT, fullPage: true });
  const result = await page.evaluate(async () => {
    const closed = uiSmoke.worlds.length;
    const shadows = [...document.querySelectorAll('[id^="ui-smoke-"]')].every((host) =>
      [...host.children].every((node) => node.shadowRoot === null),
    );
    for (const world of uiSmoke.worlds) await world.dispose();
    uiSmoke.frameCleanup?.();
    let rejected = false;
    try {
      await uiSmoke.views[0].update({ progress: "stale" });
    } catch {
      rejected = true;
    }
    for (const host of document.querySelectorAll('[id^="ui-smoke-"]')) host.remove();
    return { worlds: closed, shadows, rejected, directFrame: uiSmoke.directFrame };
  });
  assert.deepEqual(result, { worlds: 7, shadows: true, rejected: true, directFrame: true });
  await cdp.detach();
  console.log(
    "isolated_ui=ok codex=true deepseek=true ollama=true cloudflare=true charts=true drawing=true iframe_compose=true iframe_direct=true office_export=true shared_worlds=true disposal=true",
  );
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.connectOverCDP(
    process.env.OVULE_ISOLATED_CDP ?? "http://127.0.0.1:9249",
  );
  try {
    const page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((page) => /^(ovule|playground):/.test(page.url()));
    if (!page) throw new Error("Missing native App page");
    await smokeIsolatedUi(page);
  } finally {
    await browser.close();
  }
}

import { smokeIsolatedUi } from "./isolated-ui.mjs";
import { smokeConversationNavigation } from "./conversation-navigation.mjs";
import assert from "node:assert/strict";
import WebSocket from "ws";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { smokeOnboarding } from "./onboarding-native-smoke.mjs";

const root = process.env.OVULE_SMOKE_RUN_ROOT;
const port = Number(process.env.OVULE_CDP_PORT ?? "9247");
const restart = process.env.OVULE_SMOKE_RESTART === "1";
assert.ok(root, "OVULE_SMOKE_RUN_ROOT is required");
const workspace = path.join(root, "workspace");
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(path.join(workspace, "smoke.md"), "# Native smoke\n");
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
const waitFor = async (probe, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
let guestSocket;
const step = (name) => console.log(`core_native_smoke=${name}`);
try {
  const app = await waitFor(async () => {
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      if (
        /\/(index\.html|main)$/.test(new URL(page.url() || "about:blank").pathname) &&
        (await page
          .evaluate(
            async () => typeof (await import("/shell_api.js")).workspace.snapshot === "function",
          )
          .catch(() => false))
      )
        return page;
    }
  }, "application ShellAPI");
  if (process.env.OVULE_DEV_URL) {
    assert.ok(app.url().startsWith(process.env.OVULE_DEV_URL));
    const native = await app.evaluate(async () => ({
      bridge: typeof window.tuffite?.invoke,
      vite: performance
        .getEntriesByType("resource")
        .some((entry) => entry.name.includes("/@vite/client")),
    }));
    assert.equal(native.bridge, "function");
    assert.equal(native.vite, true);
    await fs.stat(path.join(root, "data", "workspace.sqlite3"));
    step("development-origin-native-bridge-vite");
  }
  const errors = [];
  app.on("pageerror", (error) => errors.push(error.message));
  app.on("console", (message) => {
    if (/Failed to load Message Block|Unsafe (Message Block|File Editor)/.test(message.text()))
      errors.push(message.text());
  });
  const snapshot = () =>
    app.evaluate(async () => (await import("/shell_api.js")).workspace.snapshot());
  if (process.env.OVULE_SMOKE_SCOPE === "channel-restore")
    assert.ok(process.env.OVULE_CHANNEL_EXTENSION_ROOT);
  if (process.env.OVULE_CHANNEL_EXTENSION_ROOT) {
    if (!restart)
      await app.evaluate(
        async (source) => (await import("/shell_api.js")).setup.installExtension(source),
        process.env.OVULE_CHANNEL_EXTENSION_ROOT,
      );
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(process.env.OVULE_CHANNEL_EXTENSION_ROOT, "extension.json"),
        "utf8",
      ),
    );
    const actionId = manifest.contributes.actions.find(
      (action) => action.handler === "channel.thread.bind",
    )?.id;
    assert.ok(actionId, "Selected package must declare the Thread binding action");
    const catalog = await app.evaluate(async () =>
      (await import("/shell_api.js")).extensions.extensionCatalog(),
    );
    assert.ok(catalog.extensions.some((extension) => extension.id === manifest.id));
    const installed = catalog.extensions.find((extension) => extension.id === manifest.id);
    assert.equal(
      await fs.realpath(installed.installPath),
      await fs.realpath(path.join(root, "data", "extensions", manifest.id.replaceAll(".", "-"))),
    );

    for (const declared of manifest.contributes.slashCommands ?? []) {
      assert.ok(
        catalog.slashCommands.some(
          (command) => command.extensionId === manifest.id && command.id === declared.id,
        ),
      );
    }
    const result = await app.evaluate(
      async ({ extensionId, actionId }) => {
        try {
          await (
            await import("/shell_api.js")
          ).extensions.runExtensionAction({
            extensionId,
            actionId,
            connectionId: "unconfigured-smoke",
            threadId: "missing",
          });
          return "unexpected success";
        } catch (error) {
          return String(error);
        }
      },
      { extensionId: manifest.id, actionId },
    );
    assert.match(result, /Connect this bot before binding a Thread/);
    step(
      restart
        ? "private-channel-restart-persistence"
        : "private-channel-install-and-binding-contract",
    );
  }

  assert.ok((await snapshot()).hosts.some((host) => host.id === "local"));
  step("startup-and-snapshot");
  if (process.env.OVULE_SMOKE_SCOPE === "channel-restore") {
    step("channel-restoration-only");
  } else if (process.env.OVULE_SMOKE_SCOPE === "conversation-navigation") {
    await smokeConversationNavigation(app, root, workspace, port, restart, waitFor);
  } else if (restart && process.env.OVULE_SMOKE_SCOPE === "explorer") {
    const saved = JSON.parse(await fs.readFile(path.join(root, "expected.json"), "utf8"));
    assert.ok((await snapshot()).threads.some((thread) => thread.id === saved.threadId));
    step("explorer-profile-restart-persistence");
  } else if (restart) {
    const saved = JSON.parse(await fs.readFile(path.join(root, "expected.json"), "utf8"));
    const state = await snapshot();
    assert.ok(state.threads.some((thread) => thread.id === saved.threadId));
    assert.ok(state.goals.some((goal) => goal.id === saved.goalId));
    assert.ok(state.nodes.some((node) => node.id === saved.nodeId));
    assert.ok(state.terminalRuns.some((run) => run.id === saved.runId && run.exitCode === 0));
    if (process.platform !== "win32") {
      const onboarding = await app.evaluate(async () =>
        (await import("/shell_api.js")).setup.onboardingStatus(),
      );
      assert.equal(onboarding.defaultAgentId, "ovule-2");
      assert.ok(
        onboarding.agents
          .filter((agent) => agent.driver === "ovule")
          .every((agent) => agent.modelId === "onboarding-deepseek-deepseek-flash"),
      );
    }
    step("sqlite-restart-persistence");
  } else {
    await app.evaluate(async () => localStorage.setItem("ovule.onboarding.dismissed", "true"));
    await smokeOnboarding(app, root);
    step("agent-centered-onboarding");
    const before = (await snapshot()).threads.map((thread) => thread.id);
    const state = await app.evaluate(
      async (root) =>
        (await import("/shell_api.js")).workspace.createThread({ workspacePath: root }),
      workspace,
    );
    const thread = state.threads.find((thread) => !before.includes(thread.id));
    assert.ok(thread);
    step("create-thread");
    // OAuth navigation can mount this overlay; validate the real layout effect
    // and app-shell portal without involving a live identity provider.
    const threadSurface = app.locator('explorer[aria-label="Conversation Thread"]');
    await threadSurface.waitFor();
    const target = await waitFor(
      async () =>
        (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
          (target) => new URL(target.url).pathname === "/thread",
        ),
      "Thread CDP target",
    );
    guestSocket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      guestSocket.once("open", resolve);
      guestSocket.once("error", reject);
    });
    let requestId = 0;
    const pending = new Map();
    guestSocket.on("message", (message) => {
      const response = JSON.parse(String(message));
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error || response.result?.exceptionDetails)
        request.reject(
          new Error(JSON.stringify(response.error ?? response.result.exceptionDetails)),
        );
      else request.resolve(response.result?.result?.value ?? response.result?.data);
    });
    const guestCommand = (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++requestId;
        pending.set(id, { resolve, reject });
        guestSocket.send(JSON.stringify({ id, method, params }));
      });
    const guest = (expression) =>
      new Promise((resolve, reject) => {
        const id = ++requestId;
        pending.set(id, { resolve, reject });
        guestSocket.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
    await waitFor(
      () => guest('Boolean(document.querySelector("textarea"))'),
      "Thread composer ready",
    );
    await app.getByRole("button", { name: "Hide workbench", exact: true }).click();
    // The sidebar button may disappear while the responsive layout rerenders.
    await guest(`document.querySelector('button[aria-label="Show sidebar"]')?.click()`);
    const surfaceIdentity = await threadSurface.evaluate(async (element) => {
      window.__threadSmokeSurface = element;
      return element.getNavigationState();
    });
    const defaultAgentLabel = await app.evaluate(async () => {
      const status = await (await import("/shell_api.js")).setup.onboardingStatus();
      const state = await (await import("/shell_api.js")).workspace.snapshot();
      return state.agents.find((agent) => agent.id === status.defaultAgentId)?.label;
    });
    assert.ok(defaultAgentLabel);
    await waitFor(async () => {
      if (await app.getByRole("button", { name: "New Conversation", exact: true }).count())
        return true;
      await guest(`(() => {
      document.querySelector('button[aria-label="Show sidebar"]')?.click();
    })()`);
      return false;
    }, "conversation sidebar restored after workbench closes");
    await app.getByRole("button", { name: "New Conversation", exact: true }).click();
    await waitFor(
      () => guest(`document.querySelector('textarea')?.placeholder.includes('workspace')`),
      "New Conversation draft surface",
    );

    await waitFor(
      () =>
        guest(
          `document.querySelector('button[aria-label="Conversation Thread Agent"]')?.textContent.includes(${JSON.stringify(defaultAgentLabel)})`,
        ),
      "configured default Agent",
    );
    await guest(`(() => {
    const input = document.querySelector("textarea");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "Native smooth conversation smoke");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
    await waitFor(
      () =>
        guest(`document.querySelector('button[aria-label="Send message"]')?.disabled === false`),
      "message send enabled",
    );
    await guest(`document.querySelector('button[aria-label="Send message"]').click()`);
    await waitFor(
      async () =>
        (await snapshot()).messages.some(
          (message) => message.content === "Native smooth conversation smoke",
        ),
      "first message saved",
    );
    await app.locator(`[data-thread-id="${thread.id}"]`).click();
    await waitFor(
      () => guest('document.querySelector("textarea")?.value === ""'),
      "Thread selection synchronized",
    );
    const retained = await threadSurface.evaluate(async (element) => ({
      sameElement: window.__threadSmokeSurface === element,
      documentId: (await element.getNavigationState()).documentId,
    }));
    assert.equal(retained.sameElement, true);
    assert.equal(
      retained.documentId,
      surfaceIdentity.documentId,
      "first send and Thread switches retain the document",
    );
    assert.equal(await app.locator('[data-thread-surface="loading"]').count(), 0);
    step("default-agent-and-persistent-thread-surface");
    const previewFile = path.join(workspace, "overlay.html");
    await fs.writeFile(
      previewFile,
      '<!doctype html><title>Overlay smoke</title><p>Local preview</p><label>Email <input id="email" type="email" autocomplete="off"></label><script>window.transferMarker = "preserved";</script>',
    );
    const preview = app.locator("[data-explorer-preview]");
    await waitFor(async () => {
      if (await preview.isVisible()) return true;
      await threadSurface.evaluate(
        async (element, url) =>
          element.dispatchEvent(new CustomEvent("open", { detail: { url }, cancelable: true })),
        pathToFileURL(previewFile).href,
      );
      return false;
    }, "Thread preview after surface replacement");
    assert.equal(
      await preview.evaluate(async (element) => Boolean(element.closest(".app-shell"))),
      true,
    );
    await app.screenshot({ path: path.join(root, "browser-overlay.png") });
    const previewExplorer = preview.locator("explorer");
    const previewState = await waitFor(async () => {
      const state = await previewExplorer.evaluate(async (element) => element.getNavigationState());
      return state.url === pathToFileURL(previewFile).href && !state.isLoading ? state : null;
    }, "preview form loaded");
    const formTarget = await waitFor(
      async () =>
        (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
          (target) => target.url === pathToFileURL(previewFile).href,
        ),
      "preview form CDP target",
    );
    const formSocket = new WebSocket(formTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      formSocket.once("open", resolve);
      formSocket.once("error", reject);
    });
    let formRequestId = 0;
    const formRequests = new Map();
    formSocket.on("message", (raw) => {
      const data = JSON.parse(String(raw));
      const pending = formRequests.get(data.id);
      if (!pending) return;
      formRequests.delete(data.id);
      if (data.error || data.result?.exceptionDetails)
        pending.reject(new Error(JSON.stringify(data.error ?? data.result.exceptionDetails)));
      else pending.resolve(data.result?.result?.value);
    });
    const form = (expression) =>
      new Promise((resolve, reject) => {
        const id = ++formRequestId;
        formRequests.set(id, { resolve, reject });
        formSocket.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, returnByValue: true },
          }),
        );
      });
    const typeInExplorer = async (surface, text) => {
      const rect = await form(
        "(()=>{const r=document.querySelector('#email').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
      );
      const bounds = await surface.boundingBox();
      assert.ok(bounds);
      await app.mouse.click(bounds.x + rect.x, bounds.y + rect.y);
      await app.keyboard.type(text);
    };
    await typeInExplorer(previewExplorer, "overlay@example.test");
    assert.equal(await form("document.querySelector('#email').value"), "overlay@example.test");
    await preview.getByRole("button", { name: "Open in workbench", exact: true }).click();
    await preview.waitFor({ state: "detached" });
    const movedExplorer = app.locator("explorer:visible");
    const moved = await waitFor(async () => {
      for (const surface of await movedExplorer.all()) {
        const state = await surface
          .evaluate(async (element) => element.getNavigationState())
          .catch(() => null);
        if (state?.documentId === previewState.documentId) return surface;
      }
    }, "live Explorer moved to Workbench");
    assert.equal(await form("document.querySelector('#email').value"), "overlay@example.test");
    await typeInExplorer(moved, ".ok");
    assert.ok((await form("document.querySelector('#email').value")).includes(".ok"));
    formSocket.close();
    step("browser-overlay-input-and-workbench-handle-transfer");
    await app.getByRole("button", { name: "Hide workbench", exact: true }).click();
    await threadSurface.evaluate(
      async (element, url) =>
        element.dispatchEvent(new CustomEvent("open", { detail: { url }, cancelable: true })),
      pathToFileURL(previewFile).href + "?independent",
    );
    await preview.waitFor();
    const independentState = await waitFor(async () => {
      const state = await preview
        .locator("explorer")
        .evaluate(async (element) => element.getNavigationState());
      return !state.isLoading && state.url.endsWith("?independent") ? state : null;
    }, "independent source loaded");
    await preview.getByRole("button", { name: "Open in independent window", exact: true }).click();
    await preview.waitFor({ state: "detached" });
    const child = await waitFor(
      () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => new URL(page.url()).pathname === "/explorer"),
      "independent Explorer window",
    );
    await waitFor(async () => {
      const state = await child
        .locator("explorer")
        .evaluate(async (element) => element.getNavigationState());
      return state.documentId === independentState.documentId;
    }, "native handle transferred across windows");
    assert.equal(await child.getByRole("alert").count(), 0);
    await child.evaluate(async () => {
      await import("/tuffite.js");
      await (await import("/tuffite.js")).window.close();
    });
    await app.bringToFront();
    step("browser-independent-window-native-handle-transfer");

    if (process.env.OVULE_SMOKE_SCOPE === "explorer") {
      await fs.writeFile(path.join(root, "expected.json"), JSON.stringify({ threadId: thread.id }));
    } else {
      await smokeIsolatedUi(app);
      step("extension-isolated-ui");
      const document = await app.evaluate(
        async ({ id, file }) => {
          await (
            await import("/shell_api.js")
          ).content.saveMarkdown(id, file, "# Saved native smoke\n");
          return (await import("/shell_api.js")).content.readMarkdown(id, file);
        },
        { id: thread.id, file: path.join(workspace, "smoke.md") },
      );
      assert.match(document.content, /Saved native smoke/);
      step("file-read-write");
      const goalState = await app.evaluate(
        async (id) =>
          (await import("/shell_api.js")).workflow.createGoal(
            id,
            "Native smoke goal",
            "Verify composition",
          ),
        thread.id,
      );
      const goal = goalState.goals.find((goal) => goal.title === "Native smoke goal");
      assert.ok(goal);
      const taskState = await app.evaluate(
        async (id) => (await import("/shell_api.js")).workflow.addTask(id, "Native smoke node"),
        goal.id,
      );
      const node = taskState.nodes.find(
        (node) => node.goalId === goal.id && node.title === "Native smoke node",
      );
      assert.ok(node);
      assert.equal(node.threadId, "", "a pending Task has no conversation yet");
      const gated = await app.evaluate(
        async (id) => (await import("/shell_api.js")).workflow.addGate(id, "Native approval"),
        goal.id,
      );
      assert.ok(
        gated.nodes.filter((item) => item.goalId === goal.id).every((item) => !item.threadId),
      );
      assert.ok(
        !gated.legacyDataIssues.some((issue) => issue.id === "workflow-missing-execution-context"),
      );
      await waitFor(
        () => guest('Boolean(document.querySelector("[data-active-workflow]"))'),
        "pinned active Workflow",
      );
      assert.equal(
        await guest(
          'document.querySelector("[data-workflow-activity]")?.textContent.includes("No Agents working in the background")',
        ),
        true,
      );
      assert.equal(
        await guest('document.querySelector("[data-active-workflow] .goal-card") === null'),
        true,
      );
      const floating = await guest(`(() => {
    const card=document.querySelector('[data-active-workflow]');const rect=card.getBoundingClientRect();
    const parent=card.offsetParent.getBoundingClientRect();const header=card.offsetParent.firstElementChild.getBoundingClientRect();
    const handle=card.querySelector('header').getBoundingClientRect();
    return {right:parent.right-rect.right,top:rect.top-header.bottom,x:handle.left+35,y:handle.top+12,left:rect.left};
  })()`);
      assert.ok(
        Math.abs(floating.right - 16) < 2 && Math.abs(floating.top - 16) < 2,
        JSON.stringify(floating),
      );
      await guestCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: floating.x,
        y: floating.y,
        button: "left",
        clickCount: 1,
      });
      await guestCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: floating.x - 40,
        y: floating.y + 25,
        button: "left",
        buttons: 1,
      });
      await guestCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: floating.x - 40,
        y: floating.y + 25,
        button: "left",
        clickCount: 1,
      });
      assert.ok(
        await guest(
          `document.querySelector('[data-active-workflow]').getBoundingClientRect().left < ${floating.left - 20}`,
        ),
      );
      await guest(
        'document.querySelector("[data-active-workflow] header button:last-child").click()',
      );
      await waitFor(
        () => guest('!document.querySelector("[data-active-workflow]")'),
        "activities closed",
      );
      await guest(`document.querySelector('button[aria-label="Activities"]').click()`);
      await waitFor(
        () => guest('Boolean(document.querySelector("[data-active-workflow]"))'),
        "activities restored",
      );
      step("workflow-activities-drag-close-restore");
      await waitFor(
        () =>
          guest(
            'Boolean([...document.querySelectorAll("button")].find((button) => button.title.startsWith("Gate: Native approval")))',
          ),
        "inline Workflow Gate",
      );
      await guest(
        '[...document.querySelectorAll("button")].find((button) => button.title.startsWith("Gate: Native approval")).click()',
      );
      await waitFor(
        () =>
          guest('document.querySelector("[role=dialog]")?.textContent.includes("Native approval")'),
        "Gate requirements dialog",
      );
      assert.equal(
        await guest(
          `Boolean(document.querySelector('button[aria-label="Conversation Thread Agent"]'))`,
        ),
        true,
      );
      await waitFor(
        () =>
          guest(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    return Boolean(dialog) && dialog.getAnimations().every((animation) => animation.playState === 'finished');
  })()`),
        "Gate animation settled",
      );
      const gateLayout = await guest(`(() => {
    const dialog = document.querySelector('[role=dialog]');
    const rect = dialog.getBoundingClientRect();
    const composer = document.querySelector('textarea').closest('.composer').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, dialog: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, composerBottom: composer.bottom, transform: getComputedStyle(dialog).transform, conversationDisplay: getComputedStyle(document.querySelector('[data-conversation-root]')).display };
  })()`);
      console.log(`core_native_smoke_gate_layout=${JSON.stringify(gateLayout)}`);
      assert.ok(
        gateLayout.dialog.left >= 0 &&
          gateLayout.dialog.right <= gateLayout.width &&
          gateLayout.dialog.top >= 0 &&
          gateLayout.dialog.bottom <= gateLayout.height,
        "Gate dialog stays within the Thread viewport",
      );
      assert.ok(
        gateLayout.composerBottom <= gateLayout.height + 1,
        "composer stays within the Thread viewport",
      );
      const dialogPixels = await new Promise((resolve, reject) => {
        const id = ++requestId;
        pending.set(id, { resolve, reject });
        guestSocket.send(
          JSON.stringify({
            id,
            method: "Page.captureScreenshot",
            params: { format: "png", captureBeyondViewport: false },
          }),
        );
      });
      await fs.writeFile(
        path.join(root, "workflow-gate-guest.png"),
        Buffer.from(dialogPixels, "base64"),
      );
      await app.screenshot({ path: path.join(root, "workflow-gate-dialog.png") });
      await guest(`document.querySelector('[role=dialog] button[aria-label="Cancel"]').click()`);
      assert.equal(
        await guest('document.body.textContent.includes("Clear old Workflow data")'),
        false,
      );
      const approvalGoal = await app.evaluate(async (threadId) => {
        const created = await (
          await import("/shell_api.js")
        ).workflow.createGoal(
          threadId,
          "Native approval interaction",
          "Confirm the completed manual requirement",
        );
        const goal = created.goals.find((goal) => goal.title === "Native approval interaction");
        const updated = await (
          await import("/shell_api.js")
        ).workflow.addGate(goal.id, "Native ready approval");
        return updated.nodes.find((node) => node.goalId === goal.id);
      }, thread.id);
      assert.equal(approvalGoal.status, "waiting");
      await waitFor(
        () =>
          guest(
            `document.querySelector('[data-active-workflow]')?.textContent.includes("Native approval interaction")`,
          ),
        "latest Goal pinned",
      );
      await waitFor(
        () =>
          guest(
            'Boolean([...document.querySelectorAll("button")].find((button) => button.title.startsWith("Gate: Native ready approval")))',
          ),
        "ready Gate rendered",
      );
      await guest('document.querySelector("[data-review-gate]").click()');
      await waitFor(
        () =>
          guest(
            'Boolean([...document.querySelectorAll("[role=dialog] button")].find((button) => button.textContent.trim() === "Approve" && !button.disabled))',
          ),
        "Gate approval enabled",
      );
      await guest(
        '[...document.querySelectorAll("[role=dialog] button")].find((button) => button.textContent.trim() === "Approve").click()',
      );
      await waitFor(
        async () =>
          (await snapshot()).nodes.find((node) => node.id === approvalGoal.id)?.status ===
          "approved",
        "Gate approved through conversation dialog",
      );
      step("workflow-lazy-node-threads-and-inline-gate");
      await app.evaluate(async (goalId) => {
        for (let index = 0; index < 7; index++)
          await (
            await import("/shell_api.js")
          ).workflow.addGate(goalId, `Scroll requirement ${index}`);
      }, goal.id);
      await guest(
        `document.querySelector('[data-active-workflow] header button[title="Open Workflow"]').click()`,
      );
      const workflowTarget = await waitFor(
        async () =>
          (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((target) => {
            const url = new URL(target.url || "about:blank");
            return url.pathname === "/pane" && url.searchParams.get("kind") === "workflow";
          }),
        "Workflow tab target",
      );
      const workflowSocket = new WebSocket(workflowTarget.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        workflowSocket.once("open", resolve);
        workflowSocket.once("error", reject);
      });
      let workflowRequest = 0;
      const workflowPending = new Map();
      workflowSocket.on("message", (message) => {
        const response = JSON.parse(String(message));
        const request = workflowPending.get(response.id);
        if (!request) return;
        workflowPending.delete(response.id);
        if (response.error || response.result?.exceptionDetails)
          request.reject(new Error(JSON.stringify(response)));
        else request.resolve(response.result?.result?.value ?? response.result?.data);
      });
      const workflowCommand = (method, params) =>
        new Promise((resolve, reject) => {
          const id = ++workflowRequest;
          workflowPending.set(id, { resolve, reject });
          workflowSocket.send(JSON.stringify({ id, method, params }));
        });
      const workflowEvaluate = (expression) =>
        workflowCommand("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        });
      try {
        await waitFor(
          () =>
            workflowEvaluate(
              'Boolean(document.querySelector("[data-workflow-panel] [data-workflow-activity]"))',
            ),
          "Workflow graph and activities",
        );
        const layout = await workflowEvaluate(`(() => {
      const panel=document.querySelector('[data-workflow-panel]');panel.querySelector('details').open=true;
      return new Promise(resolve=>requestAnimationFrame(()=>{
        panel.scrollTop=panel.scrollHeight;
        resolve({titles:[...panel.querySelectorAll('h2,h3')].filter(h=>h.textContent==='Native smoke goal').length,
          scrollTop:panel.scrollTop,scrollHeight:panel.scrollHeight,height:panel.clientHeight,overflow:getComputedStyle(panel).overflowY});
      }));
    })()`);
        const nodeLayout = await workflowEvaluate(`(() => {
      const nodes=[...document.querySelectorAll('[data-workflow-node]')];
      return nodes.map(node=>({height:node.getBoundingClientRect().height, content:node.scrollHeight, available:node.clientHeight}));
    })()`);
        assert.ok(nodeLayout.length > 0);
        assert.ok(
          nodeLayout.every(
            (node) =>
              Math.abs(node.height - nodeLayout[0].height) < 1 && node.content <= node.available,
          ),
          JSON.stringify(nodeLayout),
        );
        assert.equal(layout.titles, 1);
        assert.equal(layout.overflow, "auto");
        assert.ok(layout.scrollTop > 0, JSON.stringify(layout));
        await fs.writeFile(
          path.join(root, "workflow-tab-guest.png"),
          Buffer.from(await workflowCommand("Page.captureScreenshot", { format: "png" }), "base64"),
        );
        step("workflow-tab-flat-graph-activities-and-scroll");
      } finally {
        workflowSocket.close();
      }
      const terminal = await app.evaluate(
        async ({ id, command }) =>
          (await import("/shell_api.js")).terminal.startTerminal(id, command),
        {
          id: thread.id,
          command:
            process.platform === "win32"
              ? "echo OVULE_TERMINAL_SMOKE"
              : "printf OVULE_TERMINAL_SMOKE",
        },
      );
      const run = terminal.terminalRuns.find((run) => run.threadId === thread.id);
      assert.ok(run);
      const finished = await waitFor(
        async () =>
          (await snapshot()).terminalRuns.find(
            (item) => item.id === run.id && item.exitCode !== undefined,
          ),
        "terminal completion",
      );
      assert.equal(finished.exitCode, 0);
      assert.match(finished.stdout, /OVULE_TERMINAL_SMOKE/);
      step("terminal-execution");
      await app.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
      await app
        .locator('[data-framework-content="settings"]')
        .locator("[data-settings-panel]")
        .waitFor();
      const settings = app.locator('[data-framework-content="settings"] [data-settings-panel]');
      await settings.getByRole("button", { name: "Extensions", exact: true }).click();
      const catalogForPaths = await app.evaluate(async () =>
        (await import("/shell_api.js")).extensions.extensionCatalog(),
      );
      const displayedExtension =
        catalogForPaths.extensions.find((extension) => extension.source === "installed") ??
        catalogForPaths.extensions[0];
      assert.ok(displayedExtension?.installPath);
      const pathRow = settings.locator(`[data-extension-install-path="${displayedExtension.id}"]`);
      await pathRow.waitFor();
      assert.ok((await pathRow.textContent()).includes(displayedExtension.installPath));
      assert.equal(
        await pathRow.getByRole("button", { name: "Copy installation path", exact: true }).count(),
        1,
      );
      step("extension-installation-path-visible");
      step("settings-feature-scope");
      await fs.writeFile(
        path.join(root, "expected.json"),
        JSON.stringify({ threadId: thread.id, goalId: goal.id, nodeId: node.id, runId: run.id }),
      );
    }
  }
  assert.deepEqual(errors, []);
  await app
    .evaluate(async () => (await import("/tuffite.js")).window.close())
    .catch((error) => {
      if (!/closed|destroyed|Target/i.test(String(error))) throw error;
    });
  step("shutdown-requested");
} catch (error) {
  for (const page of browser.contexts().flatMap((context) => context.pages())) {
    if (/\/(index\.html|main)$/.test(new URL(page.url() || "about:blank").pathname)) {
      await page.screenshot({ path: path.join(root, "failure.png") }).catch(() => undefined);
      await fs
        .writeFile(path.join(root, "failure.html"), await page.content())
        .catch(() => undefined);
    }
  }
  throw error;
} finally {
  guestSocket?.close();
  await browser.close().catch(() => undefined);
}

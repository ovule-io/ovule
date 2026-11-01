import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { smokeThinkingStream } from "./thinking-stream.mjs";

export async function smokeConversationNavigation(app, root, workspace, port, restart, waitFor) {
  const expected = path.join(root, "navigation-expected.json");
  if (restart) {
    const saved = JSON.parse(await fs.readFile(expected, "utf8"));
    const snapshot = await app.evaluate(async () =>
      (await import("/shell_api.js")).workspace.snapshot(),
    );
    assert.ok(snapshot.threads.some((thread) => thread.id === saved.threadId));
    if (process.env.OVULE_LARK_WORKER_MOCK_E2E === "1") {
      await waitFor(async () => {
        const result = await app.evaluate(
          async (extensionId) =>
            JSON.parse(
              (
                await (
                  await import("/shell_api.js")
                ).extensions.runExtensionAction({
                  extensionId,
                  actionId: "status",
                  connectionId: "default",
                })
              ).dataJson,
            ),
          saved.extensionId,
        );
        return result.connections.some(
          (connection) =>
            connection.connected &&
            connection.ownerPaired &&
            connection.boundThreadId === saved.threadId,
        );
      }, "Restored paired bot and Thread binding");
      console.log("core_native_smoke=channel-pairing-and-binding-restart");
    }
    console.log("core_native_smoke=conversation-navigation-restart");
    return;
  }
  const closeSetup = app
    .locator(".titlebar")
    .getByRole("button", { name: "Close setup", exact: true });
  if (await closeSetup.count()) await closeSetup.click();
  if (
    process.env.OVULE_LARK_WORKER_MOCK_E2E === "1" ||
    process.env.OVULE_SMOKE_THINKING_STREAM === "1"
  ) {
    await app.evaluate(async () => {
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
      await api.runExtensionSetupAction({
        extensionId: "io.ovule.provider.deepseek",
        setupId: "deepseek",
        actionId: "configure",
        values: [{ id: "apiKey", value: "sk-deepseek-native-smoke-1234567890" }],
      });
      const status = await api.onboardingStatus();
      const model = status.models.find(
        (model) => model.remoteId === "deepseek-v4-special" && model.available,
      );
      if (!model) throw new Error("Fake DeepSeek model was not discovered");
      const configured = await api.completeOnboarding({
        agents: [
          {
            id: "ovule",
            label: "Ovule",
            driver: "ovule",
            modelId: model.id,
          },
        ],
        defaultAgentId: "ovule",
      });
      if (
        !configured.agents.some(
          (agent) => agent.id === "ovule" && agent.modelId?.includes("deepseek-v4-special"),
        )
      ) {
        throw new Error("Smoke onboarding did not select the fake DeepSeek model");
      }
    });
  }
  const created = await app.evaluate(
    async (folder) =>
      (await import("/shell_api.js")).workspace.createThread({ workspacePath: folder }),
    workspace,
  );
  const thread = created.threads.at(-1);
  assert.ok(thread);
  await app.locator(`[data-thread-id="${thread.id}"]`).first().click();
  const surface = app.locator('explorer[aria-label="Conversation Thread"]');
  await surface.waitFor();
  const target = await waitFor(
    async () =>
      (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((target) =>
        target.url.includes("/thread?"),
      ),
    "Thread target",
  );
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map();
  socket.on("message", (message) => {
    const response = JSON.parse(String(message)),
      handler = pending.get(response.id);
    if (!handler) return;
    pending.delete(response.id);
    if (response.error || response.result?.exceptionDetails)
      handler.reject(new Error(JSON.stringify(response)));
    else handler.resolve(response.result?.result?.value);
  });
  const guest = (expression) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  try {
    await waitFor(() => guest('Boolean(document.querySelector("textarea"))'), "Thread composer");
    if (process.env.OVULE_SMOKE_THINKING_STREAM === "1") {
      await smokeThinkingStream(guest, app, thread.id, root, waitFor);
      await fs.writeFile(expected, JSON.stringify({ threadId: thread.id }));
      return;
    }
    await surface.evaluate(async (element) => {
      window.__navigationSurface = element;
      return true;
    });
    const identity = await surface.evaluate(async (element) => element.getNavigationState());
    const show = app
      .locator(".titlebar")
      .getByRole("button", { name: "Show workbench", exact: true });
    if (await show.count()) await show.click();
    // Exercise enough real requests to cross queue/id boundaries without
    // exceeding the documented concurrent request limit.
    await guest(
      `(async()=>{for(let batch=0;batch<40;batch++){await Promise.all(Array.from({length:8},async ()=>(await import("/shell_api.js")).extensions.extensionCatalog()));await (await import("/shell_api.js")).workspace.snapshot();}return true;})()`,
    );
    console.log("core_native_smoke=shell-api-360-requests-no-transport-errors");
    // Restoring the sidebar is a real guest -> parent request using MessageEvent.source.
    const reply = await guest(`new Promise((resolve,reject)=>{
      const id=crypto.randomUUID();const timer=setTimeout(()=>reject(new Error('Root message timed out')),5000);
      const receive=event=>{if(event.data?.type==='app-response' && event.data.requestId===id){clearTimeout(timer);tuffite.removeEventListener('message',receive);resolve(event.data)}};
      tuffite.addEventListener('message',receive);
      tuffite.postMessage({type:'app-request',requestId:id,channel:'layout.toggleSidebar',payload:{}},{targetOrigin:location.origin});
    })`);
    assert.equal(reply.result?.toggled, true);
    // The workbench can compact the sidebar; the explicit affordance restores its labels.
    await guest(`document.querySelector('button[aria-label="Show sidebar"]')?.click()`);
    const newConversation = app.getByRole("button", { name: "New Conversation", exact: true });
    await newConversation.waitFor();
    await newConversation.click();
    await waitFor(
      () => guest(`document.querySelector('textarea')?.placeholder.includes('workspace')`),
      "New Conversation blank draft",
    );
    assert.equal(await app.locator(".workbench").count(), 0);
    const after = await surface.evaluate(async (element) => ({
      same: element === window.__navigationSurface,
      state: element.getNavigationState(),
    }));
    assert.equal(after.same, true);
    assert.equal(
      (await surface.evaluate(async (element) => element.getNavigationState())).documentId,
      identity.documentId,
    );
    console.log("core_native_smoke=new-conversation-standard-messaging-no-reload");
    await app.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
    const settings = app.locator('[data-framework-content="settings"] [data-settings-panel]');
    await settings.waitFor();
    await settings.getByRole("button", { name: "Extensions", exact: true }).click();
    const catalog = await app.evaluate(async () =>
      (await import("/shell_api.js")).extensions.extensionCatalog(),
    );
    const extension =
      catalog.extensions.find((extension) => extension.source === "installed") ??
      catalog.extensions[0];
    const row = settings.locator(`[data-extension-install-path="${extension.id}"]`);
    await row.waitFor();
    assert.ok((await row.textContent()).includes(extension.installPath));
    assert.equal(
      await row.getByRole("button", { name: "Copy installation path", exact: true }).count(),
      1,
    );
    await app.screenshot({ path: path.join(root, "extension-installation-path.png") });
    console.log("core_native_smoke=extension-installation-path-visible");
    if (process.env.OVULE_SMOKE_CHANNEL_ACTIONS === "1") {
      assert.equal(process.env.OVULE_CHANNEL_WORKER_MOCK, "1", "Real accounts must not be used");
      await app.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(process.env.OVULE_CHANNEL_EXTENSION_ROOT, "extension.json"),
          "utf8",
        ),
      );
      await guest(`window.channelCardExtensionId=${JSON.stringify(manifest.id)}`);
      await guest(await fs.readFile(process.env.OVULE_CHANNEL_CARD_FIXTURE, "utf8"));
      const gateEvidence = await guest(`window.smokeLarkGate()`);
      assert.equal(gateEvidence.approvals, 5);
      assert.equal(gateEvidence.rejections, 1);
      assert.equal(gateEvidence.footerAligned, true);
      console.log("core_native_smoke=lark-guided-gates", JSON.stringify(gateEvidence));
      const card = "window.channelCardElement";
      await waitFor(
        () => guest(`${card}?.querySelector('section')?.getAttribute('aria-busy') === 'false'`),
        "Card initial refresh",
      );
      assert.equal(
        await guest(`${card}.querySelector('select[name="bot-connection"]') === null`),
        true,
      );
      await guest(
        `${card}.dispatchEvent(new CustomEvent('ovule:extension-action-result', { detail: { action: 'status', data: { connections: [{ connectionId: 'default', configured: false, state: 'waiting_for_authorization' }] } } }))`,
      );
      assert.equal(
        await guest(`${card}.querySelector('select[name="bot-connection"]') === null`),
        true,
      );
      await guest(
        `channelCardSmoke.failNext=true; ${card}.querySelector('[data-action="refresh"]').click()`,
      );
      await waitFor(
        () =>
          guest(
            `${card}.querySelector('[role="alert"]')?.textContent.includes('Fixture connection interrupted')`,
          ),
        "Visible empty-card errors",
      );
      await guest(`${card}.querySelector('[data-action="refresh"]').click()`);
      await waitFor(
        () =>
          guest(
            `!${card}.querySelector('[role="alert"]') && ${card}.querySelector('section').getAttribute('aria-busy') === 'false'`,
          ),
        "Refresh retry releases busy state",
      );
      await guest(`${card}.querySelector('[data-action="connect-existing"]').click()`);
      // A send must remain available while a network operation is pending.
      const sent = await guest(
        `(async()=> (await import("/shell_api.js")).message.sendMessage(${JSON.stringify(thread.id)}, 'Native channel action regression').then(state=>state.messages.some(message=>message.content==='Native channel action regression')))()`,
      );
      assert.equal(sent, true);
      if (process.env.OVULE_LARK_WORKER_MOCK_MANUAL_AUTH === "1") {
        await waitFor(
          () => guest(`${card}.querySelector('section').getAttribute('aria-busy') === 'false'`),
          "Pending authorization controls",
        );
        assert.equal(
          await guest(`${card}.querySelector('select[name="bot-connection"]') === null`),
          true,
        );
        await guest(`${card}.querySelector('[data-action="refresh"]').click()`);
      }
      await waitFor(async () => {
        const result = await guest(
          `({ error: ${card}.querySelector('[role="alert"]')?.textContent, ready: ${card}.querySelector('section').getAttribute('aria-busy') === 'false' && ${card}.querySelector('select[name="bot-connection"]')?.textContent.includes('mock') })`,
        );
        assert.ok(!result.error, result.error);
        return result.ready;
      }, "Mock bot registration and status polling");
      await guest(`${card}.querySelector('[data-action="refresh"]').click()`);
      await waitFor(
        () => guest(`${card}.querySelector('section').getAttribute('aria-busy') === 'false'`),
        "Configured bot refresh",
      );
      if (process.env.OVULE_LARK_WORKER_MOCK_E2E === "1") {
        const statusAction = manifest.contributes.actions.find(
          (action) => action.handler === "channel.status.read",
        ).id;
        const bindAction = manifest.contributes.actions.find(
          (action) => action.handler === "channel.thread.bind",
        ).id;
        const readStatus = () =>
          app.evaluate(
            async ({ extensionId, actionId }) =>
              JSON.parse(
                (
                  await (
                    await import("/shell_api.js")
                  ).extensions.runExtensionAction({
                    extensionId,
                    actionId,
                    connectionId: "default",
                  })
                ).dataJson,
              ),
            { extensionId: manifest.id, actionId: statusAction },
          );
        await waitFor(
          async () =>
            (await readStatus()).connections.some(
              (connection) => connection.ownerPaired && connection.lastDeliveryAtMs,
            ),
          "Owner pairing and Agent reply delivery",
        );
        await app.evaluate(
          async ({ extensionId, actionId, threadId }) =>
            (await import("/shell_api.js")).extensions.runExtensionAction({
              extensionId,
              actionId,
              threadId,
              connectionId: "default",
            }),
          { extensionId: manifest.id, actionId: bindAction, threadId: thread.id },
        );
        const records = (await fs.readFile(process.env.OVULE_LARK_WORKER_MOCK_LOG, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const completedProviderTurn = await app.evaluate(async () =>
          (await (await import("/shell_api.js")).workspace.snapshot()).attempts.some(
            (attempt) =>
              attempt.status === "succeeded" &&
              attempt.modelProvider === "deepseek" &&
              /DEEPSEEK_NATIVE_CDP_OK|DeepSeek native provider response/.test(attempt.output),
          ),
        );
        assert.equal(
          completedProviderTurn,
          true,
          "Channel ingress completed the configured provider turn",
        );
        assert.ok(
          records.some(
            (record) =>
              ["send", "finalize"].includes(record.event) &&
              /DEEPSEEK_NATIVE_CDP_OK|DeepSeek native provider response/.test(
                JSON.stringify(record.payload),
              ),
          ),
          "The worker delivered the actual provider reply",
        );
        assert.ok(
          records.some(
            (record) =>
              record.event === "send" &&
              record.payload.options?.replyTo === "om_mock_pair" &&
              record.payload.options?.replyInThread === false &&
              JSON.stringify(record.payload.content).includes("配对成功"),
          ),
          "First owner pairing sends a confirmation reply to the original /pair message",
        );
        const pid = records.findLast((record) => record.event === "started").payload.pid;
        assert.ok(Number.isSafeInteger(pid) && pid > 1);
        process.kill(pid, "SIGKILL");
        await waitFor(
          async () => !(await readStatus()).connections[0].connected,
          "Terminated worker detected",
        );
        await guest(`${card}.querySelector('[data-action="refresh"]').click()`);
        await waitFor(
          async () =>
            (await readStatus()).connections.some(
              (connection) =>
                connection.connected &&
                connection.ownerPaired &&
                connection.boundThreadId === thread.id,
            ),
          "Refresh restores saved credentials and paired owner",
        );
        console.log("core_native_smoke=channel-pair-agent-reply-worker-exit-refresh-recovery");
      }

      await guest(`${card}.data={ connections: [] }`);
      assert.match(
        await guest(`${card}.querySelector('select[name="bot-connection"]').textContent`),
        /mock/,
      );
      assert.equal(await guest(`Boolean(${card}.querySelector('[role="alert"]'))`), false);
      assert.equal(
        await guest(
          `(() => { const block=${card}; const bounds=block.getBoundingClientRect(); return [...block.querySelectorAll('button, select')].every(element => {const rect=element.getBoundingClientRect();return rect.left>=bounds.left && rect.right<=bounds.right;}); })()`,
        ),
        true,
        "Card controls stay within their container",
      );
      await waitFor(
        () =>
          guest(
            `${card}.querySelector('section').getAttribute('aria-busy') === 'false' && !${card}.querySelector('[data-action="refresh"]').disabled`,
          ),
        "Restored card controls are usable",
      );
      if (process.env.OVULE_LARK_WORKER_MOCK_E2E === "1") {
        await waitFor(
          () => guest(`${card}.querySelector('[data-state="connected"]') !== null`),
          "Restored card reflects live connected status",
        );
      }
      await app.screenshot({ path: path.join(root, "channel-setup-card.png") });
      await guest(`${card}.remove()`);
      console.log("core_native_smoke=channel-card-empty-errors-retry-connect-refresh-send");
    }
    await fs.writeFile(
      expected,
      JSON.stringify({ threadId: thread.id, extensionId: process.env.OVULE_CHANNEL_EXTENSION_ID }),
    );
  } finally {
    socket.close();
  }
}

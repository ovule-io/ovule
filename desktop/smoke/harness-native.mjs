import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { main, availablePort, waitFor } from "./runner.mjs";

async function assertRoundedPixels(page, artifacts) {
  await page
    .locator("[data-agent-browser] .explorer-transfer-preview")
    .waitFor({ state: "detached" });
  const feedback = page.locator("[data-agent-browser] .ovule-control-feedback");
  const bounds = await feedback.boundingBox();
  assert.ok(bounds && bounds.width > 24 && bounds.height > 24);
  const viewportBounds = await feedback.evaluate((el) =>
    el.parentElement.getBoundingClientRect().toJSON(),
  );
  for (const key of ["x", "y", "width", "height"])
    assert.ok(
      Math.abs(bounds[key] - viewportBounds[key]) < 1,
      `Feedback ${key} must match its viewport below the toolbar`,
    );
  console.log(
    "rounded_probe_geometry",
    JSON.stringify({
      bounds,
      viewport: await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      })),
    }),
  );
  const sample = async (label) => {
    const buffer = await page.screenshot({ scale: "css" });
    await writeFile(join(artifacts, `rounded-${label}.png`), buffer);
    const png = buffer.toString("base64");
    return page.evaluate(
      async ({ png, bounds }) => {
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        // Secondary native windows can retain a different device scale factor.
        const scaleX = bitmap.width / innerWidth;
        const scaleY = bitmap.height / innerHeight;
        return [
          [bounds.x + 1, bounds.y + bounds.height - 2],
          [bounds.x + bounds.width - 2, bounds.y + bounds.height - 2],
          [bounds.x + bounds.width / 2, bounds.y + 1],
        ].map(([x, y]) =>
          Array.from(
            context.getImageData(Math.floor(x * scaleX), Math.floor(y * scaleY), 1, 1).data,
          ),
        );
      },
      { png, bounds },
    );
  };
  await feedback.evaluate((el) => {
    el.style.transition = "none";
    el.removeAttribute("data-active");
    el.firstElementChild.removeAttribute("data-visible");
  });
  const baseline = await sample("baseline");
  for (const x of [0, bounds.width]) {
    await page
      .locator("[data-agent-browser] explorer")
      .evaluate(
        (el, position) =>
          el.dispatchEvent(new CustomEvent("ovule:control-activity", { detail: position })),
        { x, y: bounds.height },
      );
    console.log(
      "rounded_probe_active",
      JSON.stringify(
        await feedback.evaluate((el) => ({
          opacity: getComputedStyle(el).opacity,
          box: el.getBoundingClientRect().toJSON(),
          mask: getComputedStyle(el.parentElement).maskImage,
        })),
      ),
    );
    const active = await sample(x === 0 ? "left" : "right");
    assert.deepEqual(
      active.slice(0, 2),
      baseline.slice(0, 2),
      "Promoted native halo/gradient must not paint outside either lower rounded corner",
    );
    assert.notDeepEqual(active[2], baseline[2], "Native edge feedback must remain visible");
  }
  await feedback.evaluate((el) => {
    el.style.removeProperty("transition");
    el.firstElementChild.removeAttribute("data-visible");
  });
}

// Scripted decisions consume real tool results; this grades mechanics, not model quality.
await main("harness-native", async (c) => {
  await c.claimPackage();
  const placement = c.opts["browser-placement"] ?? "overlay";
  assert.ok(["overlay", "sidebar", "workbench", "window"].includes(placement));
  let agentPage;
  const ids = [
    "browser.native",
    "context.native",
    "computer.native",
    "approval.native",
    "telemetry.native",
  ];
  const cases = new Map(
    ids.map((id) => [id, { id, status: "fail", duration_ms: 0, reason: "not reached" }]),
  );
  const started = Date.now();
  let server, browser, app, failure;
  const seen = {
    skill: false,
    resource: false,
    memory: false,
    recall: false,
    browser: false,
    image: false,
    stale: false,
    takeover: false,
    approvalDenied: false,
    computerImage: false,
    computerScreenshot: undefined,
    computerError: undefined,
  };
  const trajectory = [];
  const mark = (id, status, extra = {}) =>
    cases.set(id, { id, status, duration_ms: Date.now() - started, ...extra });
  try {
    const port = await availablePort(0),
      cdp = await availablePort(0),
      base = `http://127.0.0.1:${port}`;
    const workspace = join(c.root, "workspace"),
      skillRoot = join(c.root, "eval-guide");
    await mkdir(workspace);
    await mkdir(skillRoot);
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: eval-guide\ndescription: Verify harness native fixture conventions.\n---\nNATIVE_PRIVATE_SKILL_BODY Read reference.txt.\n",
    );
    await writeFile(join(skillRoot, "reference.txt"), "NATIVE_REFERENCE_VERIFIED");
    const imageCount = (body) =>
      body.messages.reduce(
        (count, m) =>
          count +
          (Array.isArray(m.content)
            ? m.content.filter(
                (item) =>
                  item.type === "image_url" && item.image_url?.url?.startsWith("data:image/"),
              ).length
            : 0),
        0,
      );
    const image = (body) => imageCount(body) > 0;
    function imageInfo(body, tool) {
      const messages = body.messages.filter(
        (m) =>
          Array.isArray(m.content) &&
          m.content.some(
            (i) => i.type === "text" && i.text?.includes(`Image returned by tool ${tool}`),
          ),
      );
      const url = messages.at(-1)?.content.find((i) => i.type === "image_url")?.image_url?.url;
      assert.ok(url?.startsWith("data:image/png;base64,"), `Missing typed PNG from ${tool}`);
      const data = Buffer.from(url.slice("data:image/png;base64,".length), "base64");
      assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      const width = data.readUInt32BE(16),
        height = data.readUInt32BE(20);
      assert.ok(
        width >= 200 && height >= 100 && data.length > 1024,
        "Screenshot is empty or unexpectedly small",
      );
      return { width, height, bytes: data.length };
    }

    const observedTools = new Map();
    function results(body) {
      for (const m of body.messages.filter((m) => m.role === "tool")) {
        const text =
          typeof m.content === "string"
            ? m.content
            : m.content
                ?.filter((i) => i.type === "text")
                .map((i) => i.text)
                .join("\n");
        let value;
        try {
          value = JSON.parse(text);
        } catch {
          value = { raw: text };
        }
        observedTools.set(m.tool_call_id, value);
      }
      const recall = body.messages.some(
        (m) => typeof m.content === "string" && m.content.includes("HARNESS_RECALL"),
      );
      const prefix = `native-${recall ? "recall" : "setup"}-`;
      return [...observedTools]
        .filter(([id]) => id?.startsWith(prefix))
        .sort(([a], [b]) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
        .map(([, value]) => value);
    }

    const ref = (r, index, role) => r[index].elements.find((e) => e.role === role).ref;
    const actions = [
      ["ovule_skills", () => ({ action: "list" })],
      ["ovule_skills", (r) => ({ action: "read", id: r[0].skills[0].id })],
      [
        "ovule_skills",
        (r) => ({ action: "resource", id: r[0].skills[0].id, path: "reference.txt" }),
      ],
      [
        "ovule_memory",
        () => ({
          action: "put",
          key: "native-fact",
          title: "Verified native fixture",
          body: "NATIVE_MEMORY_VERIFIED",
          source: "native harness fixture",
          expectedRevision: 0,
        }),
      ],
      ["ovule_browser", () => ({ action: "open", url: `${base}/form` })],
      ["ovule_browser", () => ({ action: "snapshot" })],
      [
        "ovule_browser",
        (r) => ({ action: "type", ref: ref(r, 5, "input"), text: "HARNESS_FORM_VERIFIED" }),
      ],
      ["ovule_browser", (r) => ({ action: "type", ref: ref(r, 5, "input"), text: "STALE_INPUT" })],
      ["ovule_browser", () => ({ action: "snapshot" })],
      ["ovule_browser", (r) => ({ action: "click", ref: ref(r, 8, "button") })],
      ["ovule_browser", () => ({ action: "snapshot" })],
      ["ovule_browser", () => ({ action: "screenshot" })],
      ["ovule_browser", (r) => ({ action: "click", ref: ref(r, 10, "button") })],
      ["ovule_browser", () => ({ action: "snapshot" })],
      ["ovule_computer_control", () => ({ action: "screenshot" })],
      ["ovule_computer_control", () => ({ action: "move" })],
    ];
    server = createServer(async (req, res) => {
      try {
        if (req.url === "/form") {
          res.writeHead(200, { "content-type": "text/html" });
          res.end(
            "<!doctype html><title>Harness form</title><input aria-label=\"Fixture value\"><button onclick=\"document.querySelector('output').textContent=document.querySelector('input').value\">Apply</button><output>Waiting</output>",
          );
          return;
        }
        if (req.url === "/models") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              data: [{ id: "deepseek-v4-special", object: "model", owned_by: "deepseek" }],
            }),
          );
          return;
        }
        if (req.url !== "/chat/completions") {
          res.writeHead(404);
          res.end();
          return;
        }
        assert.equal(req.headers.authorization, "Bearer sk-deepseek-native-smoke-1234567890");
        let source = "";
        for await (const chunk of req) {
          source += chunk;
          // Leave bounded transport headroom for the 16 MiB native media budget
          // plus tool history and the rest of the provider request.
          if (source.length > 32 * 1024 * 1024) throw new Error("fixture request too large");
        }
        const body = JSON.parse(source);
        const pendingCalls = new Set();
        for (const message of body.messages) {
          if (message.role === "assistant") {
            assert.equal(
              pendingCalls.size,
              0,
              "Unanswered tool call before next assistant message",
            );
            for (const call of message.tool_calls ?? []) pendingCalls.add(call.id);
          } else if (message.role === "tool")
            assert.ok(
              pendingCalls.delete(message.tool_call_id),
              "Tool result has no matching assistant call",
            );
          else assert.equal(pendingCalls.size, 0, "User content interrupted tool results");
        }
        assert.equal(pendingCalls.size, 0, "Tool results are missing");
        const r = results(body),
          n = r.length;
        const recall = body.messages.some(
          (m) => typeof m.content === "string" && m.content.includes("HARNESS_RECALL"),
        );
        if (!n)
          assert.ok(!source.includes("NATIVE_PRIVATE_SKILL_BODY"), "Skill body eagerly disclosed");
        trajectory.push({
          recall,
          round: n,
          image: image(body),
          toolNames: body.tools?.map((t) => t.function.name),
        });
        let action;
        if (recall) {
          if (!n) action = ["ovule_memory", { action: "get", key: "native-fact" }];
          else {
            assert.equal(r[0].memory.body, "NATIVE_MEMORY_VERIFIED");
            seen.recall = true;
          }
        } else {
          if (n === 5) {
            agentPage = app;
            const preview = app.locator("[data-agent-browser] [data-explorer-panel]");
            assert.notEqual(await preview.evaluate((el) => getComputedStyle(el).maskImage), "none");
            assert.deepEqual(
              await app.locator("[data-agent-browser] .ovule-control-feedback").evaluate((el) => {
                const style = getComputedStyle(el);
                return [style.borderTopLeftRadius, style.borderBottomLeftRadius, style.clipPath];
              }),
              ["0px", "13px", "border-box"],
              "Feedback must share the masked viewport's inner rounded corners",
            );
            await app.screenshot({ path: join(c.artifacts, "browser-overlay.png") });
            const source = app.locator("[data-agent-browser] explorer");
            const marker = await source.evaluate((el) =>
              el.executeJavaScript(
                "globalThis.harnessPageMarker=crypto.randomUUID();globalThis.harnessPageMarker",
              ),
            );
            if (placement !== "overlay") {
              const label =
                placement === "sidebar"
                  ? "Open in sidebar"
                  : placement === "workbench"
                    ? "Open in workbench"
                    : "Open in independent window";
              await app.getByRole("button", { name: label, exact: true }).click();
              if (placement === "window")
                agentPage = await waitFor(
                  () =>
                    browser
                      .contexts()[0]
                      .pages()
                      .find((page) => page.url().startsWith("ovule://-/explorer")),
                  "Agent independent window",
                );
              await app.locator("[data-explorer-preview]").waitFor({ state: "detached" });
              await agentPage.locator("[data-agent-browser] [data-agent-control]").waitFor();
              await waitFor(
                () => agentPage.locator("[data-agent-browser] [data-agent-control]").isEnabled(),
                "Browser ownership after transfer",
              );
              assert.deepEqual(
                await agentPage
                  .locator("[data-agent-browser] .ovule-control-feedback")
                  .evaluate((el) => {
                    const style = getComputedStyle(el);
                    const viewport = getComputedStyle(el.parentElement);
                    return [
                      style.borderTopLeftRadius,
                      style.borderBottomLeftRadius,
                      style.clipPath,
                      viewport.maskImage !== "none",
                    ];
                  }),
                ["0px", "12px", "border-box", true],
                "Promoted viewport and feedback must share their lower corner alpha mask",
              );
              await assertRoundedPixels(agentPage, c.artifacts);
              const restored = await agentPage
                .locator("[data-agent-browser] explorer")
                .evaluate((el) => el.executeJavaScript("globalThis.harnessPageMarker"));
              assert.equal(
                restored,
                marker,
                "Promotion reloaded the page instead of moving its native handle",
              );
              trajectory.push({ placement, live_page_preserved: true });
            }
          }
          if (n === 2) {
            assert.ok(r[1].content.includes("NATIVE_PRIVATE_SKILL_BODY"));
            seen.skill = true;
          }
          if (n === 3) {
            assert.ok(r[2].content.includes("NATIVE_REFERENCE_VERIFIED"));
            seen.resource = true;
          }
          if (n === 4) {
            assert.equal(r[3].revision, 1);
            seen.memory = true;
          }
          if (n === 8) {
            assert.match(JSON.stringify(r[7]), /fresh snapshot|Stale/);
            seen.stale = true;
          }
          if (n === 11) {
            assert.ok(r[10].text.includes("HARNESS_FORM_VERIFIED"));
            seen.browser = true;
            await agentPage.screenshot({ path: join(c.artifacts, "browser-active.png") });
          }
          if (n === 12) {
            assert.ok(image(body), "Browser image never reached provider");
            seen.image = true;
            trajectory.push({ screenshot: "browser", ...imageInfo(body, "ovule_browser") });
            await agentPage.locator("[data-agent-browser] [data-agent-control]").click();
          }
          if (n === 13) {
            assert.match(JSON.stringify(r[12]), /User has control/);
            seen.takeover = true;
            await agentPage.locator("[data-agent-browser] [data-agent-control]").click();
          }
          if (n === 15) {
            if (r[14].error || r[14].isError) seen.computerError = JSON.stringify(r[14]);
            else {
              assert.ok(
                body.messages.some(
                  (m) =>
                    Array.isArray(m.content) &&
                    m.content.some(
                      (i) => i.type === "text" && i.text?.includes("ovule_computer_control"),
                    ) &&
                    m.content.some(
                      (i) => i.type === "image_url" && i.image_url?.url?.startsWith("data:image/"),
                    ),
                ),
                "Computer image never reached provider",
              );
              seen.computerScreenshot = imageInfo(body, "ovule_computer_control");
              trajectory.push({ screenshot: "computer", ...seen.computerScreenshot });
              seen.computerImage = true;
            }
          }
          if (n === 16) {
            assert.match(JSON.stringify(r[15]), /Denied.*Permission was not approved/);
            seen.approvalDenied = true;
          }
          if (n < actions.length) {
            const [name, args] = actions[n];
            action = [name, args(r)];
            if (
              name === "ovule_computer_control" &&
              !body.tools.some((t) => t.function.name === name)
            ) {
              seen.computerError = "Computer Use not exposed by this Host";
              action = undefined;
            }
          }
        }
        if (action)
          assert.ok(
            body.tools.some((t) => t.function.name === action[0]),
            `Missing tool: ${action[0]}`,
          );
        const delta = action
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `native-${recall ? "recall" : "setup"}-${n}`,
                  type: "function",
                  function: { name: action[0], arguments: JSON.stringify(action[1]) },
                },
              ],
            }
          : { content: recall ? "HARNESS_RECALL_OK" : "HARNESS_NATIVE_OK" };
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        for (const [deltaValue, finish] of [
          [delta, null],
          [{}, action ? "tool_calls" : "stop"],
        ])
          res.write(
            `data: ${JSON.stringify({ id: "harness-native", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: deltaValue, finish_reason: finish }] })}\n\n`,
          );
        res.end("data: [DONE]\n\n");
        if (action?.[0] === "ovule_computer_control" && action[1].action === "move") {
          // Coordinates are deliberately absent: even a broken admission path
          // cannot inject physical input. The expected result is host-UI denial.
          void (async () => {
            await waitFor(
              async () => {
                const state = await app.evaluate(async () =>
                  (await import("/shell_api.js")).workspace.snapshot(),
                );
                return state.attempts.some((attempt) =>
                  attempt.events.some(
                    (event) =>
                      event.kind === "harness/approval" &&
                      JSON.parse(event.detail).status === "pending",
                  ),
                );
              },
              "Agent reaches approval admission",
              60000,
            );
            const confirmation = await waitFor(
              async () => {
                for (const page of browser.contexts().flatMap((context) => context.pages())) {
                  const card = page.locator("[data-agent-approval]").first();
                  if (await card.isVisible().catch(() => false)) return card;
                }
              },
              "inline approval in its owning renderer",
              10000,
            );
            assert.equal(
              await confirmation.evaluate((node) => node.closest("dialog, [role=dialog]") === null),
              true,
              "tool approval is inline, never modal",
            );
            await confirmation.screenshot({ path: join(c.artifacts, "approval-denied.png") });
            await confirmation.locator("button").first().click();
          })().catch((error) => {
            failure = error;
          });
        }
      } catch (error) {
        failure = error;
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    Object.assign(c.env, {
      OVULE_TEST_MODE: "1",
      RUST_LOG: "info,ovule_agent::framework=debug,ovule_agent::runtime::drivers::rig=debug",
      OVULE_TEST_DEEPSEEK_MODELS_ENDPOINT: `${base}/models`,
      OVULE_TEST_DEEPSEEK_API_BASE: base,
      DEEPSEEK_API_KEY: "sk-deepseek-native-smoke-1234567890",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      http_proxy: "",
      https_proxy: "",
      all_proxy: "",
      NO_PROXY: "*",
      no_proxy: "*",
    });
    async function connect() {
      await waitFor(async () => (await fetch(`http://127.0.0.1:${cdp}/json/version`)).ok, "CDP");
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`);
      app = await waitFor(async () => {
        for (const candidate of browser.contexts().flatMap((ctx) => ctx.pages()))
          if (
            candidate.url().startsWith("ovule://-/main") &&
            (await candidate
              .evaluate(
                async () =>
                  typeof (await import("/shell_api.js")).workspace.snapshot === "function",
              )
              .catch(() => false))
          )
            return candidate;
      }, "native ShellAPI");
    }
    const nativeOptions = {
      extra:
        process.env.OVULE_SMOKE_NATIVE_VERBOSE === "1" ? ["--enable-logging=stderr", "--v=1"] : [],
    };
    let child = c.launch(cdp, nativeOptions);
    await connect();
    await app.evaluate(
      async (skill) => {
        const api = await import("/shell_api.js");
        await api.setup.runExtensionSetupAction({
          extensionId: "io.ovule.provider.deepseek",
          setupId: "deepseek",
          actionId: "configure",
          values: [{ id: "apiKey", value: "sk-deepseek-native-smoke-1234567890" }],
        });
        const status = await api.setup.onboardingStatus(),
          model = status.models.find((m) => m.remoteId === "deepseek-v4-special" && m.available);
        if (!model) throw new Error("Fake model missing");
        await api.setup.completeOnboarding({
          agents: [{ id: "ovule", label: "Ovule", driver: "ovule", modelId: model.id }],
          defaultAgentId: "ovule",
        });
        await api.settings.importSkill(skill, true);
        await api.settings.upsertAgent({
          id: "ovule",
          label: "Ovule",
          driver: "ovule",
          modelId: model.id,
          skillIds: ["eval-guide"],
          toolIds: ["computer-use"],
          instructions: "",
          enabled: true,
        });
      },
      join(skillRoot, "SKILL.md"),
    );
    const snapshot = () =>
      app.evaluate(async () => (await import("/shell_api.js")).workspace.snapshot());
    const thread = await app.evaluate(async (path) => {
      const api = await import("/shell_api.js"),
        before = await api.workspace.snapshot(),
        after = await api.workspace.createThread({ workspacePath: path });
      return after.threads.find((t) => !before.threads.some((old) => old.id === t.id));
    }, workspace);
    await app.locator(`[data-thread-id="${thread.id}"]`).first().click();
    async function send(content) {
      const before = (await snapshot()).attempts.map((a) => a.id);
      await app.evaluate(
        async ({ id, content }) => (await import("/shell_api.js")).message.sendMessage(id, content),
        { id: thread.id, content },
      );
      const deadline = Date.now() + 120000;
      let attempt;
      while (Date.now() < deadline) {
        // Grader assertions are fatal; the generic UI polling helper retries
        // thrown assertions until its deadline and obscures the actual failure.
        if (failure) throw failure;
        attempt = (await snapshot()).attempts.find(
          (a) => !before.includes(a.id) && ["succeeded", "failed", "cancelled"].includes(a.status),
        );
        if (attempt) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(attempt, "Timed out waiting for harness tool loop");
      assert.equal(attempt.status, "succeeded", attempt.error || attempt.output);
      return attempt;
    }
    const attempt = await send("HARNESS_NATIVE_SETUP");
    assert.ok(seen.browser && seen.image && seen.stale && seen.takeover);
    mark("browser.native", "pass", {
      metrics: {
        synthetic_dom_input: true,
        typed_image: true,
        stale_ref_rejected: true,
        placement,
        live_page_preserved: true,
      },
    });
    const journal = await app.evaluate(
      async (id) => (await import("/shell_api.js")).agent.executionCalls(id),
      attempt.id,
    );
    assert.ok(
      journal.length >= 15 &&
        journal.every(
          (row) => row.attemptId === attempt.id && ["completed", "failed"].includes(row.state),
        ),
      "Attempt execution journal must contain settled tool calls",
    );
    const events = attempt.events.filter((e) => e.kind.startsWith("harness/"));
    assert.ok(events.some((e) => e.kind === "harness/assembled"));
    assert.ok(events.some((e) => e.kind === "harness/tool"));
    assert.ok(!JSON.stringify(events).includes("NATIVE_MEMORY_VERIFIED"));
    const status = seen.computerImage
      ? "pass"
      : seen.computerError &&
          !/deadline|timeout|timed out/i.test(seen.computerError) &&
          /permission|screen|capture|unavailable|not exposed|denied|allow/i.test(seen.computerError)
        ? "skip"
        : "fail";
    const captureTrace = events
      .filter((event) => event.kind === "harness/tool")
      .map((event) => JSON.parse(event.detail))
      .find((event) => event.tool === "ovule_computer_control");
    mark("computer.native", status, {
      reason: seen.computerError,
      metrics: { ...seen.computerScreenshot, tool_duration_ms: captureTrace?.duration_ms },
    });
    mark("approval.native", seen.approvalDenied ? "pass" : "skip", {
      reason: seen.approvalDenied ? undefined : "Computer tool unavailable",
      metrics: { denied_before_physical_input: true },
    });
    if (seen.approvalDenied)
      assert.ok(
        events.some(
          (event) =>
            event.kind === "harness/approval" && JSON.parse(event.detail).status === "denied",
        ),
      );
    await browser.close();
    browser = undefined;
    await c.stop(child);
    child = c.launch(cdp, { ...nativeOptions, label: "restart" });
    await connect();
    const restored = (await snapshot()).attempts.find((a) => a.id === attempt.id);
    assert.deepEqual(
      restored.events.filter((e) => e.kind.startsWith("harness/")),
      events,
    );

    assert.deepEqual(
      await app.evaluate(
        async (id) => (await import("/shell_api.js")).agent.executionCalls(id),
        attempt.id,
      ),
      journal,
      "Execution journal must survive process restart",
    );
    await send("HARNESS_RECALL");
    assert.ok(seen.recall && seen.skill && seen.resource && seen.memory);
    mark("context.native", "pass", { metrics: { process_restart: true, metadata_only: true } });
    const assistant = (await snapshot()).messages.find(
      (message) => message.attemptId === attempt.id && message.role === "assistant",
    );
    assert.ok(assistant, "Persisted Agent message missing");
    await app.evaluate(
      (messageId) =>
        window.dispatchEvent(
          new CustomEvent("ovule:global-dialog", {
            detail: { kind: "message-telemetry", messageId },
          }),
        ),
      assistant.id,
    );
    const debug = app.locator("[data-harness-telemetry]");
    await debug.locator("[data-execution-journal]").waitFor({ state: "visible" });
    const exported = JSON.parse(await app.locator("[data-message-telemetry-json]").textContent());
    assert.equal(exported.executionJournal.status, "ready");
    assert.deepEqual(
      exported.executionJournal.records,
      journal,
      "Debug JSON and displayed execution records must agree",
    );
    await debug.waitFor();
    assert.ok((await debug.innerText()).includes("ovule-harness/2"));
    assert.ok((await debug.innerText()).includes("ovule_browser"));
    mark("telemetry.native", "pass", {
      metrics: { persisted_events: events.length, raw_bodies: false },
    });
    await debug.evaluate((node) => node.scrollIntoView({ block: "start" }));
    await app.screenshot({ path: join(c.artifacts, "message-debug.png") });
    await app.screenshot({ path: join(c.artifacts, "harness-after-restart.png") });
  } catch (error) {
    if (app && !app.isClosed()) {
      await writeFile(
        join(c.artifacts, "failure-execution-events.json"),
        JSON.stringify(
          await app
            .evaluate(async () => {
              const state = await (await import("/shell_api.js")).workspace.snapshot();
              return state.attempts.map((a) => ({
                id: a.id,
                status: a.status,
                events: a.events.filter((e) => e.kind.startsWith("harness/")),
              }));
            })
            .catch(() => ({ unavailable: true })),
          null,
          2,
        ),
      );
      await writeFile(
        join(c.artifacts, "approval-state.json"),
        JSON.stringify(
          await app
            .evaluate(() => ({
              dialogs: [...document.querySelectorAll("dialog")].map((node) => ({
                open: node.open,
                approval: node.dataset.agentApproval,
                rect: node.getBoundingClientRect().toJSON(),
              })),
            }))
            .catch(() => ({ unavailable: true })),
          null,
          2,
        ),
      );
      await app.screenshot({ path: join(c.artifacts, "failure.png") }).catch(() => {});
    }
    for (const [id, value] of cases)
      if (value.status === "fail")
        cases.set(id, {
          ...value,
          reason: String(error).slice(0, 2048),
          duration_ms: Date.now() - started,
        });
    throw error;
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
    await writeFile(
      join(c.artifacts, "provider-trajectory.json"),
      JSON.stringify(trajectory, null, 2),
    );
    const report = {
      schema_version: 1,
      kind: "deterministic",
      duration_semantics: "shared_scenario_elapsed_to_assertion",
      cases: [...cases.values()],
      artifacts: c.artifacts,
    };
    await writeFile(join(c.artifacts, "harness-report.json"), JSON.stringify(report, null, 2));
    if (process.env.OVULE_EVAL_OUTPUT)
      await writeFile(process.env.OVULE_EVAL_OUTPUT, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
  assert.ok(
    [...cases.values()].every((item) => item.status === "pass"),
    "Native harness cases include failures or skips; inspect report",
  );
});

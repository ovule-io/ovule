import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_CDP_PORT ?? "9247");
const iterations = Number(process.env.OVULE_STRESS_ITERATIONS ?? "30");
let app;

try {
  phase("connect-cdp");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    timeout: 15_000,
  });
  app = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => isOvuleResource(page.url(), "index.html")),
  );
  app.setDefaultTimeout(15_000);
  const diagnostics = [];
  app.on("crash", () => diagnostics.push("outer:crash"));
  app.on("close", () => diagnostics.push("outer:close"));
  app.on("pageerror", (error) => diagnostics.push(`outer:error:${error.message}`));

  phase("prepare-workspace");
  const fixtures = await app.evaluate(async () => {
    localStorage.setItem("ovule.onboarding.dismissed", "true");
    let snapshot = await (await import("/shell_api.js")).workspace.snapshot();
    while (snapshot.threads.length < 3) {
      snapshot = await (await import("/shell_api.js")).workspace.createThread({});
    }
    const threads = snapshot.threads.slice(0, 3);
    const result = [];
    for (const thread of threads) {
      snapshot = await (
        await import("/shell_api.js")
      ).workflow.createGoal(
        thread.id,
        `Stress Workflow ${thread.id}`,
        "Verify repeated Workflow surface switching",
      );
      const goal = snapshot.goals.find(
        (item) => item.threadId === thread.id && item.title === `Stress Workflow ${thread.id}`,
      );
      if (!goal) throw new Error(`failed to create stress Goal for ${thread.id}`);
      snapshot = await (
        await import("/shell_api.js")
      ).workflow.addTask(goal.id, `Stress Node ${thread.id}`, undefined);
      result.push({ threadId: thread.id, goalId: goal.id });
    }
    return result;
  });
  const threadIds = fixtures.map((fixture) => fixture.threadId);
  await app.reload();
  await app.locator('explorer[aria-label="Conversation Thread"]').waitFor({
    state: "attached",
    timeout: 30_000,
  });

  const thread = async () => {
    const page = await waitFor(() =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => isOvuleResource(candidate.url(), "thread.html")),
    );
    page.setDefaultTimeout(15_000);
    return page;
  };

  phase("verify-layout");
  let inner = await thread();
  await inner.getByRole("textbox", { name: "Message" }).waitFor({ timeout: 30_000 });
  const layout = await inner.evaluate(async () => {
    const root = document.documentElement.getBoundingClientRect();
    const conversation = document.querySelector(".conversation").getBoundingClientRect();
    const timeline = document.querySelector(".timeline").getBoundingClientRect();
    const composer = document.querySelector(".composer").getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: rect(root),
      conversation: rect(conversation),
      timeline: rect(timeline),
      composer: rect(composer),
      bottomGap: Math.round(root.bottom - conversation.bottom),
      composerBottomGap: Math.round(conversation.bottom - composer.bottom),
    };
    function rect(value) {
      return {
        x: Math.round(value.x),
        y: Math.round(value.y),
        width: Math.round(value.width),
        height: Math.round(value.height),
        bottom: Math.round(value.bottom),
      };
    }
  });
  assert.ok(layout.conversation.height >= layout.viewport.height - 2, format(layout));
  assert.ok(layout.composer.bottom <= layout.conversation.bottom, format(layout));
  assert.ok(layout.composerBottomGap >= 0 && layout.composerBottomGap <= 28, format(layout));
  assert.ok(layout.timeline.height > 50, format(layout));

  phase("stress-interactions");
  for (let index = 0; index < iterations; index++) {
    const row = app.locator(".thread-row").nth(index % threadIds.length);
    const expectedThreadId = threadIds[index % threadIds.length];
    const expectedGoalId = fixtures[index % fixtures.length].goalId;
    const expectedThread = (await row.locator("strong").textContent())?.trim() ?? "";
    await row.click();
    // The Thread Explorer now stays mounted and receives selection messages.
    // Its original navigation URL must not be treated as the active Thread.
    await inner
      .locator(".goal-card")
      .filter({ hasText: `Stress Workflow ${expectedThreadId}` })
      .waitFor();
    await inner.getByRole("textbox", { name: "Message" }).waitFor();
    await inner.getByRole("combobox", { name: "Conversation Thread Host", exact: true }).waitFor();
    const activity = inner.locator("[data-active-workflow]");
    if (await activity.count()) await activity.locator("header button").last().click();
    await inner
      .locator(".goal-card")
      .filter({ hasText: `Stress Workflow ${expectedThreadId}` })
      .getByRole("button", { name: "Open Workflow", exact: true })
      .click();
    const workflowSurface = app.locator(
      `.tool-surface:has(explorer[src*="kind=workflow"][src*="thread=${expectedThreadId}"][src*="target=${expectedGoalId}"])`,
    );
    await workflowSurface.locator("explorer").waitFor({ state: "attached" });
    await expectActiveSurface(workflowSurface);
    await row.click();
    await app.locator(".workspace [data-workspace-titlebar-root]").waitFor({ state: "detached" });
    assert.equal(await workflowSurface.getAttribute("data-active"), "false");
    assert.ok((await workflowSurface.boundingBox()).x < -90_000);
    assert.equal(
      await app
        .locator('explorer[aria-label="Conversation Thread"]')
        .evaluate(async (element) => getComputedStyle(element).display),
      "block",
    );
    await app
      .locator(`.artifact-row[data-thread-id="${expectedThreadId}"] .artifact-select`)
      .filter({ hasText: "Workflow" })
      .click();
    await expectActiveSurface(workflowSurface);

    if (index % 3 === 0) {
      const closeButtons = app.locator('button[aria-label^="Close "]');
      if (await closeButtons.count())
        await closeButtons.last().evaluate(async (button) => button.click());
    }
    if (index % 5 === 0) {
      assert.equal(
        await inner.locator(".topbar").getByRole("button", { name: "Goal", exact: true }).count(),
        0,
      );
      await row.click();
      const composer = inner.getByRole("textbox", { name: "Message" });
      await composer.fill("/goal ");
      await composer.fill("");
    }
    await app.evaluate(async () => (await import("/shell_api.js")).workspace.snapshot());
    if (app.isClosed()) throw new Error(`outer page closed at iteration ${index + 1}`);
    phase(`iteration-${index + 1}/${iterations}`);
  }

  phase("settle");
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(app.isClosed(), false, `outer page closed: ${diagnostics.join(", ")}`);
  assert.equal(diagnostics.length, 0, diagnostics.join("\n"));
  process.stdout.write(
    `${JSON.stringify({ status: "ok", iterations, threadIds, layout, diagnostics })}\n`,
  );
  process.exit(0);
} catch (error) {
  if (app && !app.isClosed()) {
    process.stderr.write(
      JSON.stringify(
        await app
          .evaluate(async () => ({
            tabs: localStorage.getItem("ovule.workbench.tabs"),
            title: document.querySelector(".workbench .pane-active-tab")?.textContent,
            visible: [
              ...document.querySelectorAll('.tool-surface[data-active="true"] explorer'),
            ].map((e) => e.getAttribute("src")),
          }))
          .catch(() => ({})),
      ) + "\n",
    );
    await app
      .screenshot({ path: `${process.env.OVULE_SMOKE_RUN_ROOT}/stress-failure.png` })
      .catch(() => {});
  }
  process.stderr.write(`[thread-surface-stress] failed: ${error?.stack ?? error}\n`);
  process.exit(1);
}

function phase(name) {
  process.stderr.write(`[thread-surface-stress] ${name}\n`);
}

function format(value) {
  return JSON.stringify(value, null, 2);
}

async function expectActiveSurface(surface) {
  const deadline = Date.now() + 15_000;
  let geometry;
  while (Date.now() < deadline) {
    geometry = await surface.evaluate(async (element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        active: element.getAttribute("data-active"),
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    });
    if (
      geometry.active === "true" &&
      geometry.x >= 0 &&
      geometry.width > 100 &&
      geometry.height > 100
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(geometry, "Active tool surface has no geometry");
  assert.ok(geometry.x >= 0, `Active tool surface remained offscreen: ${format(geometry)}`);
  assert.ok(geometry.width > 100, `Active tool surface is too narrow: ${format(geometry)}`);
  assert.ok(geometry.height > 100, `Active tool surface is too short: ${format(geometry)}`);
  assert.equal(geometry.display, "block", format(geometry));
  assert.equal(geometry.visibility, "visible", format(geometry));
  assert.notEqual(geometry.opacity, "0", format(geometry));
}

function isOvuleResource(value, filename) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "ovule:" &&
      url.host === "-" &&
      url.pathname === (filename === "thread.html" ? "/thread" : "/main")
    );
  } catch {
    return false;
  }
}

async function waitFor(probe, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out; last=${JSON.stringify(value)}`);
}

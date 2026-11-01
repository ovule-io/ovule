import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.OVULE_UI_URL ?? "http://127.0.0.1:4183";
const artifacts = process.env.OVULE_SETTINGS_SMOKE_DIR ?? ".tmp/settings-smoke";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.OVULE_BROWSER ? { executablePath: process.env.OVULE_BROWSER } : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 920 },
  locale: "en-US",
  colorScheme: "dark",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem("ovule.onboarding.dismissed", "true");
  HTMLElement.prototype.postMessage = () => Promise.resolve(true);
  const messages = new EventTarget();
  window.tuffite = {
    addEventListener: (...args) => messages.addEventListener(...args),
    removeEventListener: (...args) => messages.removeEventListener(...args),
    postMessage: async (request) => {
      if (request.type === "app-request") {
        queueMicrotask(() =>
          messages.dispatchEvent(
            new CustomEvent("message", {
              detail: {
                data: { type: "app-response", requestId: request.requestId, result: true },
              },
            }),
          ),
        );
      }
      return true;
    },
  };
});

function holdChunk(name) {
  let requested, release;
  const seen = new Promise((resolve) => {
    requested = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const pattern = new RegExp(`${name}\\.(?:tsx|js)(?:\\?|$)`);
  const handler = async (route) => {
    requested();
    await gate;
    await route.continue();
  };
  return {
    seen,
    release,
    install: () => page.route(pattern, handler),
    remove: () => page.unroute(pattern, handler),
  };
}
async function waitForChunk(hold) {
  let timer;
  try {
    await Promise.race([
      hold.seen,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("lazy chunk was not requested")), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function assertShellPreserved() {
  assert.equal(await page.locator(".titlebar").isVisible(), true);
  assert.equal(await page.locator(".hydrate-fallback").count(), 0);
  assert.equal(await page.getByText("Loading Ovule…", { exact: true }).count(), 0);
  assert.equal(
    await page.evaluate(
      () =>
        window.__originalThread ===
        document.querySelector('explorer[aria-label="Conversation Thread"]'),
    ),
    true,
  );
}
const settingsChunk = holdChunk("ContentView");
const setupChunk = holdChunk("OnboardingPage");
try {
  await settingsChunk.install();
  await setupChunk.install();
  await page.goto(`${base}/main`);
  const mainDocument = await page.evaluate(() => performance.timeOrigin);
  const settingsButton = page
    .locator(".titlebar")
    .getByRole("button", { name: "Settings", exact: true });
  await settingsButton.waitFor();
  await page.locator('explorer[aria-label="Conversation Thread"]').waitFor({ state: "attached" });
  await page.evaluate(() => {
    window.__originalThread = document.querySelector('explorer[aria-label="Conversation Thread"]');
  });
  assert.equal(
    await page
      .locator("[data-chat-sidebar] .theme-toggle, [data-chat-sidebar] .language-toggle")
      .count(),
    0,
  );
  await settingsButton.click();
  await waitForChunk(settingsChunk);
  await assertShellPreserved();
  settingsChunk.release();
  const settings = page.locator('[data-framework-content="settings"]');
  await settings.getByRole("heading", { name: "Preferences", exact: true }).waitFor();
  await assertShellPreserved();
  assert.equal(
    await settings
      .getByRole("radio", { name: "Follow system", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  assert.equal(
    await settings.getByRole("combobox", { name: "Language", exact: true }).textContent(),
    "Follow system",
  );
  await settings.getByRole("radio", { name: "Light", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.emulateMedia({ colorScheme: "dark" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await settings
    .locator(".theme-toggle")
    .screenshot({ path: `${artifacts}/theme-cards-light.png` });
  await settings.getByRole("radio", { name: "Follow system", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  const cardWidths = await settings
    .getByRole("radio")
    .evaluateAll((cards) =>
      cards.map((card) => card.firstElementChild.getBoundingClientRect().width),
    );
  assert.ok(
    cardWidths.every((width) => width > 120),
    "preview cards must fill their columns",
  );
  assert.ok(Math.max(...cardWidths) - Math.min(...cardWidths) < 1);
  await settings.locator(".theme-toggle").screenshot({ path: `${artifacts}/theme-cards.png` });
  await page.screenshot({ path: `${artifacts}/settings-dark.png` });
  // Reset completion must survive both section changes and closing/reopening Settings.
  await settings.getByRole("button", { name: "Hosts", exact: true }).click();
  const resetConnections = settings.getByRole("button", {
    name: "Reset Link connections",
    exact: true,
  });
  await resetConnections.waitFor();
  await resetConnections.click();
  await resetConnections.waitFor({ state: "hidden" });
  await settings.getByRole("button", { name: "General", exact: true }).click();
  await settings.getByRole("button", { name: "Hosts", exact: true }).click();
  assert.equal(await resetConnections.count(), 0);
  const resetIdentity = settings.getByRole("button", {
    name: "Reset this Host Link identity",
    exact: true,
  });
  await resetIdentity.click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Reset Host identity", exact: true })
    .click();
  await resetIdentity.waitFor({ state: "hidden" });
  await settings.getByRole("button", { name: "General", exact: true }).click();
  await settings.getByRole("button", { name: "Hosts", exact: true }).click();
  await settings.getByLabel("This Host pair link", { exact: true }).waitFor();
  assert.equal(await resetIdentity.count(), 0);
  assert.equal(await resetConnections.count(), 0);
  await settingsButton.click();
  await settingsButton.click();
  await settings.getByRole("button", { name: "Hosts", exact: true }).click();
  await settings.getByLabel("This Host pair link", { exact: true }).waitFor();
  assert.equal(await resetIdentity.count(), 0);
  await settings.getByRole("button", { name: "General", exact: true }).click();
  await settings.getByRole("radio", { name: "Follow system", exact: true }).press("ArrowRight");
  assert.equal(
    await settings.getByRole("radio", { name: "Light", exact: true }).getAttribute("aria-checked"),
    "true",
  );
  await settings.getByRole("radio", { name: "Light", exact: true }).press("Home");
  await settings.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await settings.getByRole("heading", { name: "偏好设置", exact: true }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  await settings.getByRole("combobox", { name: "语言", exact: true }).click();
  await page.getByRole("option", { name: "跟随系统", exact: true }).click();
  await settings.getByRole("heading", { name: "Preferences", exact: true }).waitFor();
  await page.locator(".titlebar").getByRole("button", { name: "Open setup", exact: true }).click();
  await waitForChunk(setupChunk);
  await assertShellPreserved();
  setupChunk.release();
  await page.getByRole("heading", { name: "Configure your Agents" }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await assertShellPreserved();
  await page.locator(".titlebar").getByRole("button", { name: "Close setup", exact: true }).click();
  assert.equal(
    await page.evaluate(() => performance.timeOrigin),
    mainDocument,
    "first feature opens must not reload the document",
  );
  await settingsButton.click();
  await settings.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "简体中文", exact: true }).click();
  await page.locator(".titlebar").getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "搜索对话线程" }).click();
  const searchDialog = page.getByRole("dialog");
  await searchDialog.getByRole("option").first().waitFor();
  assert.equal(
    await searchDialog.getByRole("option").evaluateAll((rows) =>
      rows.every((row) => {
        const box = row.getBoundingClientRect();
        const text = row.querySelector("strong").parentElement.getBoundingClientRect();
        return text.top >= box.top && text.bottom <= box.bottom;
      }),
    ),
    true,
    "thread title/detail must stay inside each search row",
  );
  await searchDialog.screenshot({ path: `${artifacts}/thread-search.png` });
  await searchDialog.getByRole("textbox").press("Enter");
  await searchDialog.waitFor({ state: "hidden" });

  // Thread routes exercise the same composer that native Explorer pages render.
  await page.goto(`${base}/thread?language=en`);
  const composer = page.locator(".composer");
  await composer.waitFor();
  assert.equal(await composer.getAttribute("data-slot"), "card-footer");
  assert.equal(await composer.locator('[data-slot="input-group"]').count(), 1);
  assert.equal(
    await composer.locator('[data-slot="input-group-addon"][data-align="block-end"]').count(),
    1,
  );
  const input = composer.getByRole("textbox", { name: "Message", exact: true });
  await input.fill("A draft that must survive opening menus");
  const agent = composer.getByRole("button", { name: "Conversation Thread Agent", exact: true });
  await agent.click();
  await page.getByRole("menuitemradio").first().waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await input.inputValue(), "A draft that must survive opening menus");
  assert.equal(await agent.evaluate((element) => document.activeElement === element), true);
  await input.fill("/on");
  await page.locator("#composer-skill-suggestions").waitFor();
  await input.press("Escape");
  await input.fill("first line");
  await input.press("Shift+Enter");
  assert.equal(await input.inputValue(), "first line\n");
  await composer.getByRole("button", { name: "Add attachment", exact: true }).click();
  await page.getByRole("menuitem", { name: "Attach images", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await composer.locator('input[type="file"]').setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1GQAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await composer.getByRole("img", { name: "pixel.png", exact: true }).waitFor();
  await composer.getByRole("button", { name: "Remove pixel.png", exact: true }).click();
  await input.fill("Composer smoke message");
  await page.screenshot({ path: `${artifacts}/composer.png` });
  await input.press("Enter");
  await page.waitForFunction(() => document.querySelector(".composer textarea")?.value === "");
  await page.goto(`${base}/thread?language=zh-CN`);
  const chineseInput = page.locator(".composer textarea");
  await chineseInput.fill("中文输入和回车发送验证");
  await chineseInput.press("Enter");
  await page.waitForFunction(() => document.querySelector(".composer textarea")?.value === "");
  assert.deepEqual(errors, []);
  console.log("settings_loading_composer_smoke=ok");
} catch (error) {
  console.error("browser_errors", errors);
  console.error(await page.locator("body").innerText());
  await page.screenshot({ path: `${artifacts}/failure.png` });
  throw error;
} finally {
  settingsChunk.release();
  setupChunk.release();
  await context.close();
  await browser.close();
}

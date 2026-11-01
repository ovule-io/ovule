import { setThemeMode, setLanguageMode } from "./settings-preferences.mjs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const executablePath =
  process.env.OVULE_BROWSER ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const baseUrl = process.env.OVULE_UI_URL ?? "http://127.0.0.1:4173";
const screenshot =
  process.env.OVULE_SMOKE_SCREENSHOT ??
  "C:\\Users\\Administrator\\AppData\\Local\\Temp\\ovule-ui-smoke.png";

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, locale: "en-US" });
const errors = [];
page.on("console", (message) => {
  const text = message.text();
  const expectedExplorerWarning =
    text.includes("The tag <%s> is unrecognized in this browser") && text.endsWith(" explorer");
  if (message.type() === "error" && !expectedExplorerWarning) errors.push(`console: ${text}`);
});
page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator(".titlebar").getByRole("button", { name: "Settings" }).waitFor();
  // Stock Edge cannot instantiate Tuffite's native <explorer>. Conversation,
  // composer, Workflow, message-block, and link-routing behavior is covered by
  // the packaged native CDP smoke; this script owns the outer app shell.
  assert.equal(
    await page.locator(".harness-panel").count(),
    0,
    "tools panel must be hidden initially",
  );
  assert.equal(
    await page
      .locator(".titlebar")
      .getByRole("button", { name: /tools panel/i })
      .count(),
    0,
    "titlebar must not contain a workbench toggle",
  );
  await page.locator(".titlebar").getByRole("button", { name: "Open setup" }).click();
  await page.getByRole("heading", { name: "Configure your Agents" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Workspace", exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("textbox", { name: "OpenAI API key" }).count(),
    0,
    "Ovule model controls must be conditional",
  );
  await page.getByRole("checkbox", { name: "Configure Ovule" }).click();
  const provider = page.getByRole("combobox", { name: "Model provider", exact: true });
  await provider.waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "OpenAI API key" }).count(),
    0,
    "provider configuration must wait for an explicit provider choice",
  );
  assert.equal(
    await page.getByRole("combobox", { name: "Model" }).isEnabled(),
    false,
    "model selection requires a provider",
  );
  await provider.click();
  await page.getByRole("option", { name: /OpenAI \/ Codex/ }).click();
  await page.getByRole("textbox", { name: "OpenAI API key" }).waitFor();
  const chatGptLogin = page.getByRole("button", { name: "Sign in with ChatGPT" });
  assert.equal(await chatGptLogin.isEnabled(), true, "ChatGPT sign-in must be clickable");
  await chatGptLogin.click();
  const onboardingModel = page.getByRole("combobox", { name: "Model" });
  await onboardingModel.waitFor();
  await onboardingModel.click();
  await page.getByRole("option", { name: /GPT-6 Astra/ }).click();
  await provider.click();
  await page.getByRole("option", { name: /DeepSeek/ }).click();
  await page.getByLabel("DeepSeek API key").fill("sk-deepseek-ui-smoke-1234567890");
  await page.getByRole("button", { name: "Save API key" }).click();
  await onboardingModel.click();
  await page.getByRole("option", { name: /DeepSeek Flash/ }).click();
  await expectText(onboardingModel, /DeepSeek Flash/);
  assert.equal(
    await page.getByRole("button", { name: "Continue", exact: true }).isEnabled(),
    true,
    "a discovered DeepSeek model must be selected for the active Ovule profile",
  );
  await page.getByRole("button", { name: "Make default", exact: true }).last().click();
  assert.equal(
    await page.getByRole("button", { name: "Default", exact: true }).count(),
    1,
    "onboarding must expose one explicit default Agent",
  );
  assert.equal(
    await page.getByRole("button", { name: "Install Channel CLI", exact: true }).count(),
    0,
    "global onboarding must not expose extension-specific Channel controls",
  );
  await page.locator(".titlebar").getByRole("button", { name: "Close setup", exact: true }).click();
  await page.locator(".onboarding-page-surface").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  await page.locator(".framework.sidebar-collapsed").waitFor();
  await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.locator(".framework:not(.sidebar-collapsed)").waitFor();
  assert.equal(
    await page.getByRole("dialog", { name: "Search Conversation Threads" }).count(),
    0,
    "the titlebar Show sidebar button must not open thread search",
  );
  await page.getByRole("button", { name: "Search Conversation Threads", exact: true }).click();
  const threadSwitcher = page.getByRole("dialog", { name: "Search Conversation Threads" });
  await threadSwitcher.waitFor();
  const threadSearch = threadSwitcher.getByRole("textbox", {
    name: "Search Conversation Thread history",
  });
  await threadSearch.fill("Build a launch");
  await threadSwitcher.getByRole("option", { name: /Build a launch page/i }).waitFor();
  await threadSearch.fill("");
  await threadSwitcher.getByRole("button", { name: "Restore sidebar" }).click();
  await page.locator(".framework:not(.sidebar-collapsed)").waitFor();
  await page.keyboard.press("Control+K");
  await threadSwitcher.waitFor();
  await threadSwitcher.getByRole("button", { name: "Close dialog" }).click();
  await setLanguageMode(page, "zh-CN");
  await page.getByText("搜索…", { exact: true }).waitFor();
  await setLanguageMode(page, "en");
  await page.getByText("Search…", { exact: true }).waitFor();
  await page.locator(".titlebar").getByRole("button", { name: "Settings" }).click();
  await page.locator("[data-settings-panel]").waitFor();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  assert.equal(
    await page.getByRole("tab", { name: "Settings", exact: true }).count(),
    0,
    "Settings must not create a workbench tab",
  );
  await page.getByText("Agent profiles").waitFor();
  await page.getByRole("button", { name: "Models", exact: true }).click();
  await page.getByText("Model catalog").waitFor();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("heading", { name: "Agent Skills" }).waitFor();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("heading", { name: "Capabilities & tools", exact: true }).waitFor();
  await page.getByRole("button", { name: "Toolchains", exact: true }).click();
  await page.getByRole("heading", { name: "Local Toolchains", exact: true }).waitFor();
  const toolchainSection = page.locator("section.catalog-section").filter({
    has: page.getByRole("heading", { name: "Local Toolchains", exact: true }),
  });
  const channelToolchain = toolchainSection.locator("article.catalog-card").filter({
    hasText: "Channel CLI",
  });
  await channelToolchain.getByRole("button", { name: "Install", exact: true }).click();
  const installDialog = page.getByRole("region", { name: "Install local Toolchain" });
  await installDialog.waitFor();
  await installDialog.getByText(/private data directory/i).waitFor();
  await installDialog.getByRole("button", { name: "Install", exact: true }).click();
  await toolchainSection.getByRole("status").waitFor();
  await toolchainSection.getByText("Channel CLI was installed and is ready.").waitFor();
  await page.getByRole("button", { name: "Extensions", exact: true }).click();
  await page.getByRole("heading", { name: "Extensions & capabilities" }).waitFor();
  await page.getByText("DeepSeek Chat", { exact: true }).waitFor();
  await page.getByText("DeepSeek Reasoner", { exact: true }).waitFor();
  await page.getByText("ECharts visualization", { exact: true }).waitFor();
  await page.getByText("excalidraw", { exact: true }).waitFor();
  await page.locator(".titlebar [data-settings-toggle]").click();
  await page.locator("[data-settings-panel]").waitFor({ state: "hidden" });

  const browserTabs = page.getByRole("tab", { name: /Browser/ });
  const browserTabsBeforeSidebar = await browserTabs.count();
  const explorerSurfacesBeforeSidebar = await page
    .locator(".harness-tab-content explorer[title='Browser']")
    .count();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ovule:browser-use", { detail: { target: "dist/index.html" } }),
    ),
  );
  assert.equal(
    await browserTabs.count(),
    browserTabsBeforeSidebar + 1,
    "each Browser-use request must create a tab",
  );
  const firstBrowserOrdinal = browserTabsBeforeSidebar + 1;
  const preview = page.locator("explorer[title='Browser']").first();
  await preview.waitFor({ state: "attached" });
  const expectedPreview = "ovule://-/preview-html";
  assert.equal(
    new URL(await preview.getAttribute("src")).pathname,
    new URL(expectedPreview).pathname,
  );
  assert.equal(await page.locator("iframe[title='Local HTML preview']").count(), 0);
  // Snapshot rendering, sanitization and sandboxing run in explorer-resources-smoke.mjs.
  await page.locator(".harness-panel").getByRole("button", { name: "Hide tools panel" }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ovule:browser-use", { detail: { target: "dist/index.html" } }),
    ),
  );
  await page.locator(".harness-panel:not(.collapsed)").waitFor();
  assert.equal(
    await browserTabs.count(),
    browserTabsBeforeSidebar + 2,
    "a Browser-use request must add a Browser tab",
  );
  assert.equal(
    await page
      .getByRole("tab", { name: `Browser ${firstBrowserOrdinal + 1}` })
      .getAttribute("aria-selected"),
    "true",
  );
  await page
    .locator(".harness-tab-content.active")
    .getByText("Loaded dist/index.html", { exact: false })
    .waitFor();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("ovule:browser-use", { detail: { target: "index.html" } }),
    ),
  );
  assert.equal(
    await browserTabs.count(),
    browserTabsBeforeSidebar + 3,
    "each Browser-use request needs its own tab",
  );
  assert.equal(
    await page
      .getByRole("tab", { name: `Browser ${firstBrowserOrdinal + 2}` })
      .getAttribute("aria-selected"),
    "true",
  );
  await page
    .locator(".harness-tab-content.active")
    .getByText("Loaded index.html", { exact: false })
    .waitFor();
  assert.equal(
    await page.locator(".harness-tab-content explorer[title='Browser']").count(),
    1,
    "only the active Browser tab should retain an Explorer surface",
  );
  await page.getByRole("tab", { name: `Browser ${firstBrowserOrdinal}` }).click();
  const restoredPreview = page.locator(".harness-tab-content.active explorer[title='Browser']");
  await restoredPreview.waitFor({ state: "attached" });
  assert.equal(
    new URL(await restoredPreview.getAttribute("src")).pathname,
    new URL(expectedPreview).pathname,
    "switching back must recreate the Browser tab's Explorer with its previous URL",
  );
  await page.getByRole("tab", { name: `Browser ${firstBrowserOrdinal + 2}` }).click();
  await page.locator(".harness-tab-content.active explorer[title='Browser']").waitFor({
    state: "attached",
  });
  await page.getByRole("button", { name: "Markdown" }).click();
  await page.getByRole("textbox", { name: "Markdown path" }).fill("README.md");
  await page.getByRole("button", { name: "Open Markdown" }).click();
  await page.locator(".milkdown").waitFor();
  await page.getByRole("button", { name: "Save Markdown" }).waitFor();

  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  assert.equal(
    await page.getByRole("tab", { name: /Terminal/ }).count(),
    2,
    "two independent Terminal tabs expected",
  );
  assert.equal(
    await page.getByRole("tab", { name: "Terminal 2" }).getAttribute("aria-selected"),
    "true",
  );
  await page.locator(".harness-tab-content.active .xterm-screen").waitFor();
  const typeTerminal = async (command) => {
    await page.getByRole("textbox", { name: "Terminal command" }).click();
    await page.keyboard.type(command);
  };
  const activeTerminalText = () =>
    page.locator(".harness-tab-content.active .xterm-rows").innerText();
  await typeTerminal("echo terminal-two");
  await page.getByRole("tab", { name: "Terminal 1" }).click();
  await typeTerminal("echo smoke");
  await page.getByRole("tab", { name: "Terminal 2" }).click();
  assert.match(await activeTerminalText(), /echo terminal-two/);
  await page.getByRole("tab", { name: "Terminal 1" }).click();
  await page.getByRole("textbox", { name: "Terminal command" }).press("Enter");
  await page
    .locator(".harness-tab-content.active")
    .getByTestId("terminal-output")
    .getByText(/command completed/)
    .waitFor();
  await page.getByRole("textbox", { name: "Terminal command" }).press("ArrowUp");
  assert.match(await activeTerminalText(), /echo smoke/);
  const activeTerminal = page.locator(".harness-tab-content.active");
  await activeTerminal.locator('button[aria-label="Find in terminal"]').click();
  await activeTerminal.getByRole("textbox", { name: "Find in terminal" }).fill("command completed");
  await activeTerminal.getByRole("textbox", { name: "Find in terminal" }).press("Enter");
  await activeTerminal.getByRole("button", { name: "Close terminal search" }).click();
  const terminalTabsBeforeMenu = await page.getByRole("tab", { name: /Terminal/ }).count();
  await page.getByRole("combobox", { name: "New tool tab" }).click();
  await page.getByRole("option", { name: "Terminal", exact: true }).click();
  await page.getByRole("combobox", { name: "New tool tab" }).click();
  await page.getByRole("option", { name: "Terminal", exact: true }).click();
  await page
    .locator('[role="tab"]')
    .filter({ hasText: /^Terminal/ })
    .nth(terminalTabsBeforeMenu + 1)
    .waitFor();
  assert.equal(
    await page
      .locator('[role="tab"]')
      .filter({ hasText: /^Terminal/ })
      .count(),
    terminalTabsBeforeMenu + 2,
    "the add menu must allow Terminal to be selected repeatedly",
  );
  await page.getByRole("button", { name: "Close Terminal 3", exact: true }).click();
  await page.getByRole("combobox", { name: "New tool tab" }).click();
  await page.getByRole("option", { name: "Terminal", exact: true }).click();
  await page.getByRole("tab", { name: "Terminal 5", exact: true }).waitFor();

  await setThemeMode(page, "light");
  assert.equal(await page.locator("html").getAttribute("data-theme-mode"), "light");
  await setThemeMode(page, "dark");
  assert.equal(await page.locator("html").getAttribute("data-theme-mode"), "dark");

  await page.screenshot({ path: screenshot, fullPage: true });
  assert.deepEqual(errors, []);
  process.stdout.write(`ui_smoke=ok screenshot=${screenshot}\n`);
} catch (error) {
  const title = await page.title().catch(() => "<unavailable>");
  const body = await page
    .locator("body")
    .innerText()
    .catch(() => "<unavailable>");
  process.stderr.write(
    `page_title=${title}\npage_body=${body.slice(0, 4000)}\n` +
      `browser_errors=${errors.join(" | ") || "none"}\n`,
  );
  throw error;
} finally {
  await browser.close();
}

async function expectText(locator, expected) {
  const value = await locator.textContent();
  assert.match(value ?? "", expected);
}

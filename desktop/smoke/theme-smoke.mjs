import { setThemeMode } from "./settings-preferences.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.OVULE_UI_URL ?? "http://127.0.0.1:5173";
const artifactRoot = process.env.OVULE_THEME_SMOKE_DIR ?? ".tmp/theme-smoke";
await mkdir(artifactRoot, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    process.env.OVULE_BROWSER ??
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  const text = message.text();
  const expectedExplorerWarning =
    text.includes("The tag <%s> is unrecognized in this browser") && text.endsWith(" explorer");
  if (message.type() === "error" && !expectedExplorerWarning) errors.push(text);
});
await page.addInitScript(() => {
  localStorage.setItem("ovule.onboarding.dismissed", "true");
  window.__explorerAppearance = [];
  HTMLElement.prototype.postMessage = function (message) {
    if (this.localName === "explorer" && message?.type === "appearance.sync") {
      window.__explorerAppearance.push({
        label: this.getAttribute("aria-label"),
        theme: message.theme,
      });
    }
    return Promise.resolve(true);
  };
});

async function resolveColor(variable) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, variable);
}

async function selectResolvedTheme(theme) {
  await setThemeMode(page, theme);
  assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
}

try {
  await page.goto(`${base}/main?language=en&theme=dark`, { waitUntil: "networkidle" });
  await page.locator(".chat .sidebar").waitFor();
  await page.locator('.thread-row[data-active="true"]').waitFor();
  await page.addStyleTag({ content: "* { transition: none !important; }" });
  await selectResolvedTheme("dark");
  await page.waitForFunction(() =>
    window.__explorerAppearance.some(
      (message) => message.label === "Conversation Thread" && message.theme === "dark",
    ),
  );

  const primary = await resolveColor("--primary");
  const neutralAccent = await resolveColor("--accent");
  const neutralRing = await resolveColor("--ring");
  assert.notEqual(primary, neutralAccent, "brand primary must stay separate from neutral accent");
  assert.notEqual(primary, neutralRing, "focus ring must not reuse the brand primary");

  const dark = await page.evaluate(() => {
    const selected = document.querySelector('.thread-row[data-active="true"]');
    const title = selected.querySelector("strong");
    const caption = selected.querySelector("small");
    return {
      theme: document.documentElement.dataset.theme,
      geistLoaded: document.fonts.check('14px "Geist Variable"'),
      bodyFontFamily: getComputedStyle(document.body).fontFamily,
      bodyFontSize: getComputedStyle(document.body).fontSize,
      sidebar: getComputedStyle(document.querySelector(".sidebar")).backgroundColor,
      selected: getComputedStyle(selected).backgroundColor,
      titleFontSize: getComputedStyle(title).fontSize,
      titleFontWeight: getComputedStyle(title).fontWeight,
      captionFontSize: getComputedStyle(caption).fontSize,
    };
  });
  assert.equal(dark.theme, "dark");
  assert.equal(dark.geistLoaded, true);
  assert.match(dark.bodyFontFamily, /^"?Geist Variable/);
  assert.equal(dark.bodyFontSize, "14px");
  assert.equal(dark.sidebar, await resolveColor("--sidebar"));
  assert.equal(dark.selected, await resolveColor("--sidebar-active"));
  assert.equal(dark.titleFontSize, "14px");
  assert.equal(dark.titleFontWeight, "400");
  assert.equal(dark.captionFontSize, "12px");
  await page.screenshot({ path: `${artifactRoot}/sidebar-dark.png`, fullPage: true });

  await page.locator(".titlebar").getByRole("button", { name: "Open setup" }).click();
  await page.getByRole("heading", { name: "Configure your Agents" }).waitFor();
  const setupType = await page.locator(".onboarding-page").evaluate((dialog) => ({
    body: getComputedStyle(dialog).fontSize,
    button: getComputedStyle(dialog.querySelector(".ui-button")).fontSize,
    cardTitle: getComputedStyle(dialog.querySelector('[role="checkbox"] strong')).fontSize,
    cardWeight: getComputedStyle(dialog.querySelector('[role="checkbox"] strong')).fontWeight,
    iconStrokeWidth: getComputedStyle(dialog.querySelector(".lucide")).strokeWidth,
  }));
  assert.deepEqual(setupType, {
    body: "14px",
    button: "14px",
    cardTitle: "14px",
    cardWeight: "500",
    iconStrokeWidth: "1.5px",
  });
  await page.screenshot({ path: `${artifactRoot}/dark.png`, fullPage: true });
  await page.locator(".titlebar").getByRole("button", { name: "Close setup" }).click();
  await page.locator(".onboarding-page-surface").waitFor({ state: "detached" });

  await selectResolvedTheme("light");
  assert.equal(
    await page.locator(".sidebar").evaluate((sidebar) => getComputedStyle(sidebar).backgroundColor),
    await resolveColor("--sidebar"),
  );
  assert.equal(
    await page
      .locator('.thread-row[data-active="true"]')
      .evaluate((row) => getComputedStyle(row).backgroundColor),
    await resolveColor("--sidebar-active"),
  );
  const lightSidebar = await resolveColor("--sidebar");
  const lightHover = await resolveColor("--sidebar-hover");
  const lightActive = await resolveColor("--sidebar-active");
  assert.notEqual(lightSidebar, lightHover, "light sidebar hover must be visible");
  assert.notEqual(lightHover, lightActive, "light sidebar active must be stronger than hover");
  await page.waitForFunction(() =>
    window.__explorerAppearance.some(
      (message) => message.label === "Conversation Thread" && message.theme === "light",
    ),
  );
  await page.screenshot({ path: `${artifactRoot}/sidebar-light.png`, fullPage: true });
  await page.locator(".titlebar").getByRole("button", { name: "Open setup" }).click();
  await page.getByRole("heading", { name: "Configure your Agents" }).waitFor();
  await page.screenshot({ path: `${artifactRoot}/light.png`, fullPage: true });

  await page.goto(`${base}/thread?thread=thread-0001&language=en&theme=light`, {
    waitUntil: "networkidle",
  });
  await page.locator(".conversation .composer").waitFor();
  assert.equal(await page.locator(".ui-message-scroller").count(), 1);
  assert.equal(await page.locator('.ui-message-scroller-viewport[role="region"]').count(), 1);
  assert.equal(await page.locator('.ui-message-scroller-content[role="log"]').count(), 1);
  assert.ok(await page.locator(".ui-message-animated[data-message-id]").count());
  assert.ok(await page.locator('.ui-message[data-role="assistant"] .ui-message-avatar').count());
  assert.equal(await page.locator('.ui-message[data-role="user"] .ui-message-avatar').count(), 0);
  await page.addStyleTag({ content: "* { transition: none !important; }" });
  const composer = page.locator('.conversation .composer [data-slot="input-group"]');
  const contentAlignment = await page.evaluate(() => {
    const viewportElement = document.querySelector(".ui-message-scroller-viewport");
    const viewport = viewportElement.getBoundingClientRect();
    const viewportStyle = getComputedStyle(viewportElement);
    const composer = document.querySelector(".conversation .composer").getBoundingClientRect();
    return {
      left: Math.round(viewport.left + parseFloat(viewportStyle.paddingLeft) - composer.left),
      right: Math.round(composer.right - (viewport.right - parseFloat(viewportStyle.paddingRight))),
    };
  });
  assert.deepEqual(contentAlignment, { left: 0, right: 0 });
  const composerBeforeFocus = await composer.evaluate((element) => ({
    borderWidth: getComputedStyle(element).borderTopWidth,
    borderRadius: getComputedStyle(element).borderRadius,
    boxShadow: getComputedStyle(element).boxShadow,
  }));
  assert.equal(composerBeforeFocus.borderWidth, "1px");
  assert.equal(composerBeforeFocus.borderRadius, "16px");
  assert.notEqual(composerBeforeFocus.boxShadow, "none");
  assert.equal(await page.getByRole("button", { name: "Add attachment" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "Send message" }).count(), 1);
  await page.getByRole("textbox", { name: "Message" }).focus();
  const composerFocused = await composer.evaluate((element) => ({
    borderColor: getComputedStyle(element).borderTopColor,
    boxShadow: getComputedStyle(element).boxShadow,
  }));
  assert.equal(composerFocused.borderColor, await resolveColor("--ring"));
  assert.notEqual(composerFocused.boxShadow, composerBeforeFocus.boxShadow);
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add attachment" }).click();
  await page.getByRole("menuitem", { name: "Attach images" }).click();
  const fileChooser = await fileChooserPromise;
  assert.equal(fileChooser.isMultiple(), true);
  await page.getByRole("textbox", { name: "Message" }).fill("Draft a new message");
  const sendButton = page.getByRole("button", { name: "Send message" });
  assert.equal(await sendButton.isEnabled(), true);
  assert.equal(
    await sendButton.evaluate((button) => getComputedStyle(button).backgroundColor),
    await resolveColor("--foreground"),
  );

  const userMessage = page.locator('[data-message-role="user"]').first();
  const agentMessage = page.locator('[data-message-role="assistant"]').first();
  await userMessage.waitFor();
  await agentMessage.waitFor();
  assert.equal(
    await userMessage.evaluate((message) => getComputedStyle(message).backgroundColor),
    await resolveColor("--secondary"),
  );
  const agentBackground = await agentMessage.evaluate(
    (message) => getComputedStyle(message).backgroundColor,
  );
  await agentMessage.hover();
  const agentHover = await agentMessage.evaluate(
    (message) => getComputedStyle(message).backgroundColor,
  );
  assert.notEqual(agentBackground, agentHover);
  assert.equal(agentHover, await resolveColor("--surface-3"));
  assert.equal(
    await page
      .locator("[data-workflow-progress]")
      .evaluate((progress) => getComputedStyle(progress).backgroundColor),
    await resolveColor("--foreground"),
  );
  await page.screenshot({ path: `${artifactRoot}/thread-light.png`, fullPage: true });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
  });
  await page.screenshot({ path: `${artifactRoot}/thread-dark.png`, fullPage: true });
  assert.deepEqual(errors, []);
  process.stdout.write(
    `theme_smoke=ok primary=${primary} accent=${neutralAccent} artifacts=${artifactRoot}\n`,
  );
} finally {
  await browser.close();
}

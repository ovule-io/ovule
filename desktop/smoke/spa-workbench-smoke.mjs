import { setThemeMode } from "./settings-preferences.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: process.env.OVULE_BROWSER,
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, locale: "en-US" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("https://example.com/favicon.ico", (route) =>
  route.fulfill({
    status: 200,
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="blue"/></svg>',
  }),
);
await page.addInitScript(() => {
  localStorage.setItem("ovule.onboarding.dismissed", "true");
  localStorage.setItem("ovule.sidebar", "closed");
  const events = new EventTarget();
  // Event-only mock exercises the root RPC. Stock Edge has no native Explorer.
  window.tuffite = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    postMessage: async (data) => {
      window.__responses.push(data);
      return true;
    },
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  window.__responses = [];
  window.addEventListener("message", (event) => {
    if (event.data?.type === "app-response") window.__responses.push(event.data);
  });
});
const base = process.env.OVULE_UI_URL ?? "http://127.0.0.1:5193";
async function resolvedColor(variable) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, variable);
}
async function colorsAreEquivalent(actual, expected) {
  const [actualChannels, expectedChannels] = await page.evaluate(
    ([left, right]) => {
      const channels = (color) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      return [channels(left), channels(right)];
    },
    [actual, expected],
  );
  return actualChannels.every((channel, index) => Math.abs(channel - expectedChannels[index]) <= 1);
}
async function assertEquivalentColor(actual, expected, message) {
  assert.ok(
    await colorsAreEquivalent(actual, expected),
    `${message}: ${actual} is not equivalent to ${expected}`,
  );
}
async function request(channel, payload) {
  const id = crypto.randomUUID();
  await page.evaluate(
    ({ id, channel, payload }) =>
      window.tuffite.dispatchEvent(
        new MessageEvent("message", {
          origin: location.origin,
          source: window,
          data: { type: "app-request", requestId: id, channel, payload },
        }),
      ),
    { id, channel, payload },
  );
  await page.waitForFunction(
    (id) => window.__responses.some((response) => response.requestId === id),
    id,
  );
  const response = await page.evaluate(
    (id) => window.__responses.find((response) => response.requestId === id),
    id,
  );
  assert.equal(response.error, undefined);
  return response.result;
}
async function selectResolvedTheme(theme) {
  await setThemeMode(page, theme);
  assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
}
try {
  await page.goto(`${base}/main`);
  try {
    await page.locator(".chat .sidebar").waitFor();
  } catch (error) {
    console.error(
      "spa_boot_diagnostics=",
      JSON.stringify({
        url: page.url(),
        body: (await page.locator("body").innerText()).slice(0, 500),
        errors,
      }),
    );
    throw error;
  }
  await page.waitForTimeout(200);
  await page.addStyleTag({ content: "* { transition: none !important; }" });
  assert.equal(await page.locator(".primary-nav").count(), 0);
  const lightChrome = await page.evaluate(() => {
    const sidebar = document.querySelector(".sidebar");
    const framework = document.querySelector(".framework");
    const app = document.querySelector(".app-shell");
    const threadViewport = document.querySelector('.sidebar [data-slot="sidebar-content"]');
    for (const [name, element] of Object.entries({ sidebar, framework, app, threadViewport })) {
      if (!(element instanceof Element)) throw new Error(`${name} element is missing`);
    }
    return {
      sidebar: getComputedStyle(sidebar).backgroundColor,
      framework: getComputedStyle(framework).backgroundColor,
      app: getComputedStyle(app).backgroundColor,
      threadOverflow: getComputedStyle(threadViewport).overflowY,
      scrollbarWidth: getComputedStyle(threadViewport, "::-webkit-scrollbar").width,
      scrollbarButton: getComputedStyle(threadViewport, "::-webkit-scrollbar-button").display,
      scrollbarButtonWidth: getComputedStyle(threadViewport, "::-webkit-scrollbar-button").width,
      scrollbarTrack: getComputedStyle(threadViewport, "::-webkit-scrollbar-track").backgroundColor,
      scrollbarThumbBorder: getComputedStyle(threadViewport, "::-webkit-scrollbar-thumb")
        .borderWidth,
    };
  });
  assert.ok(
    lightChrome.framework === "rgba(0, 0, 0, 0)" || lightChrome.framework === lightChrome.app,
    JSON.stringify(lightChrome),
  );
  assert.deepEqual(lightChrome, {
    sidebar: await resolvedColor("--sidebar"),
    framework: lightChrome.framework,
    app: lightChrome.app,
    threadOverflow: "auto",
    scrollbarWidth: "8px",
    scrollbarButton: "none",
    scrollbarButtonWidth: "0px",
    scrollbarTrack: "rgba(0, 0, 0, 0)",
    scrollbarThumbBorder: "0px",
  });
  await page.keyboard.press("Control+K");
  const threadSwitcher = page.getByRole("dialog");
  await threadSwitcher
    .getByRole("heading", { name: "Search Conversation Threads", exact: true })
    .waitFor();
  assert.equal(await threadSwitcher.getByRole("button", { name: "Restore sidebar" }).count(), 0);
  assert.equal(
    await threadSwitcher
      .getByLabel("Search Conversation Thread history", { exact: true })
      .evaluate((input) => getComputedStyle(input).outlineStyle),
    "none",
  );
  assert.deepEqual(
    await threadSwitcher
      .getByRole("option")
      .evaluateAll((rows) => rows.map((row) => getComputedStyle(row).height)),
    ["48px"],
  );
  await page.keyboard.press("Escape");
  await threadSwitcher.waitFor({ state: "hidden" });
  const selectedThread = page.locator('.thread-row[data-active="true"]');
  assert.deepEqual(
    await selectedThread.evaluate((row) => {
      const title = row.querySelector("strong");
      const style = getComputedStyle(row);
      return {
        height: row.getBoundingClientRect().height,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        titleLineHeight: getComputedStyle(title).lineHeight,
        agentAbsent: row.querySelector("small") === null,
        listGap: getComputedStyle(row.parentElement).rowGap,
      };
    }),
    {
      height: 34,
      paddingTop: "4px",
      paddingBottom: "4px",
      titleLineHeight: "20px",
      agentAbsent: true,
      listGap: "1px",
    },
  );
  assert.deepEqual(
    await selectedThread.evaluate((row) => {
      const sidebar = row.closest(".sidebar");
      const sidebarBounds = sidebar.getBoundingClientRect();
      const rowBounds = row.getBoundingClientRect();
      const style = getComputedStyle(sidebar);
      return {
        left: Math.round(rowBounds.left - sidebarBounds.left - parseFloat(style.paddingLeft)),
        right: Math.round(
          sidebarBounds.right -
            parseFloat(style.borderRightWidth) -
            parseFloat(style.paddingRight) -
            rowBounds.right,
        ),
      };
    }),
    { left: 10, right: 10 },
  );
  await assertEquivalentColor(
    await selectedThread.evaluate((row) => getComputedStyle(row).color),
    await resolvedColor("--sidebar-accent-foreground"),
    "selected Thread foreground",
  );
  const selectedBackground = await selectedThread.evaluate(
    (row) => getComputedStyle(row).backgroundColor,
  );
  await assertEquivalentColor(
    selectedBackground,
    await resolvedColor("--sidebar-active"),
    "selected Thread background",
  );
  await page.locator(".sidebar-search").click();
  assert.deepEqual(
    await page
      .getByRole("dialog")
      .locator("[data-slot=input-group]")
      .evaluate((group) => {
        const input = group.querySelector("input");
        const groupStyle = getComputedStyle(group);
        const inputStyle = getComputedStyle(input);
        return {
          groupBorder: groupStyle.borderTopWidth,
          inputBorder: inputStyle.borderTopWidth,
          addonsInside: [...group.querySelectorAll("[data-slot=input-group-addon]")].every(
            (addon) => group.contains(addon),
          ),
        };
      }),
    { groupBorder: "1px", inputBorder: "0px", addonsInside: true },
  );
  const switcherRows = page.getByRole("dialog").getByRole("option");
  await switcherRows.first().waitFor();
  assert.deepEqual(
    await switcherRows.evaluateAll((rows) => ({
      heights: rows.map((row) => getComputedStyle(row).height),
      gap:
        rows.length > 1
          ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom
          : Number.parseFloat(getComputedStyle(rows[0].parentElement).rowGap),
    })),
    { heights: await switcherRows.evaluateAll((rows) => rows.map(() => "48px")), gap: 1 },
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const sidebarHandle = page.locator(".chat [data-separator]");
  const sidebarHandleBounds = await sidebarHandle.boundingBox();
  const sidebarBeforeDrag = await page.locator(".sidebar").boundingBox();
  const workspaceBeforeDrag = await page.locator(".workspace").boundingBox();
  assert.equal(
    Math.round(workspaceBeforeDrag.x - (sidebarBeforeDrag.x + sidebarBeforeDrag.width)),
    0,
  );
  assert.equal(
    Math.round(sidebarHandleBounds.x - (sidebarBeforeDrag.x + sidebarBeforeDrag.width)),
    0,
  );
  await page.mouse.move(sidebarHandleBounds.x, sidebarHandleBounds.y + 120);
  await page.mouse.down();
  await page.mouse.move(sidebarHandleBounds.x + 30, sidebarHandleBounds.y + 120, { steps: 4 });
  assert.ok((await page.locator(".sidebar").boundingBox()).width > sidebarBeforeDrag.width);
  await page.mouse.up();
  assert.ok(
    await page
      .locator(
        '.titlebar button[aria-label="Open setup"], .titlebar button[aria-label="Settings"], .titlebar button[aria-label$="workbench"]',
      )
      .evaluateAll((buttons) =>
        buttons.every((button) => Math.round(button.getBoundingClientRect().width) === 28),
      ),
    "Titlebar product tools use compact 28px targets",
  );
  assert.ok(
    await page
      .locator("svg.lucide")
      .evaluateAll((icons) => icons.every((icon) => getComputedStyle(icon).strokeWidth === "2px")),
    "Lucide icons use the 2px product stroke",
  );
  assert.ok(
    await page
      .locator(
        '.titlebar button[aria-label="Open setup"], .titlebar button[aria-label="Settings"], .titlebar button[aria-label$="workbench"]',
      )
      .evaluateAll((buttons) =>
        buttons.every((button) => getComputedStyle(button).borderRadius === "10px"),
      ),
    "Titlebar product tools use rounded corners",
  );
  assert.ok(
    await page
      .locator(".titlebar .window-controls button")
      .evaluateAll((buttons) =>
        buttons.every(
          (button) =>
            Math.round(button.getBoundingClientRect().width) === 44 &&
            getComputedStyle(button).borderRadius === "0px",
        ),
      ),
    "Native window controls keep 44px square targets",
  );
  const retainedThreadExplorer = await page
    .locator('explorer[aria-label="Conversation Thread"]')
    .elementHandle();
  await page.locator(".titlebar").getByRole("button", { name: "Open setup" }).click();
  await page.locator(".onboarding-page-surface").waitFor();
  const onboardingSurface = page.locator(".onboarding-page-surface");
  assert.equal(await onboardingSurface.getByRole("tab").count(), 0);
  await onboardingSurface.getByRole("heading", { name: "Agents", exact: true }).waitFor();
  assert.equal(await page.locator(".chat").getAttribute("aria-hidden"), "true");
  const onboardingChrome = await page.locator(".onboarding-page").evaluate(async (dialog) => {
    const header = dialog.querySelector("header");
    const body = dialog.querySelector(".onboarding-body");
    const footer = dialog.querySelector("footer");
    const before = {
      header: header.getBoundingClientRect().top,
      footer: footer.getBoundingClientRect().bottom,
    };
    body.scrollTop = body.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return {
      overflow: getComputedStyle(body).overflowY,
      headerDelta: Math.round(header.getBoundingClientRect().top - before.header),
      footerDelta: Math.round(footer.getBoundingClientRect().bottom - before.footer),
    };
  });
  assert.deepEqual(onboardingChrome, { overflow: "auto", headerDelta: 0, footerDelta: 0 });
  await page.getByRole("button", { name: "Add Ovule profile" }).click();
  const newProfile = onboardingSurface.getByRole("article").last();
  const providerCombobox = newProfile.getByRole("combobox", {
    name: "Model provider",
    exact: true,
  });
  await providerCombobox.click();
  await page.getByRole("option", { name: /DeepSeek/i }).click();
  await page.getByRole("button", { name: "Open DeepSeek API keys" }).click();
  await page.locator(".workbench").waitFor();
  await page.locator('.tool-surface[data-active="true"] .tool-explorer').waitFor();
  assert.equal(await page.locator(".onboarding-page-surface").isVisible(), true);
  const setupWorkbenchSources = await page
    .locator('.tool-surface[data-active="true"] explorer')
    .evaluateAll((explorers) => explorers.map((explorer) => explorer.src));
  const setupWorkbenchTitle = await page
    .locator(".workbench .pane-active-tab strong")
    .textContent();
  const setupPaneSurfaces = await page.locator(".tool-surface").evaluateAll((surfaces) =>
    surfaces.map((surface) => ({
      tab: surface.getAttribute("data-tool-tab"),
      active: surface.getAttribute("data-active"),
      style: surface.getAttribute("style"),
    })),
  );
  assert.ok(
    setupWorkbenchSources.includes("https://platform.deepseek.com/api_keys"),
    JSON.stringify({ setupWorkbenchSources, setupWorkbenchTitle, setupPaneSurfaces }),
  );
  const setupPlacement = await page.evaluate(() => {
    const setup = document.querySelector(".onboarding-page-surface").closest("section");
    const chat = document.querySelector(".chat");
    const workbench = document.querySelector(".workbench");
    const setupBounds = setup.getBoundingClientRect();
    const chatBounds = chat.getBoundingClientRect();
    const workbenchBounds = workbench.getBoundingClientRect();
    return {
      setupLeft: Math.round(setupBounds.left),
      chatLeft: Math.round(chatBounds.left),
      setupRight: Math.round(setupBounds.right),
      workbenchLeft: Math.round(workbenchBounds.left),
    };
  });
  assert.equal(setupPlacement.setupLeft, setupPlacement.chatLeft);
  assert.ok(setupPlacement.setupRight < setupPlacement.workbenchLeft);
  assert.equal(
    await providerCombobox.textContent().then((text) => text.includes("DeepSeek")),
    true,
  );
  await page.getByLabel("DeepSeek API key").fill("sk-deepseek-spa-smoke-1234567890");
  await page.getByRole("button", { name: "Save API key", exact: true }).click();
  const modelCombobox = newProfile.getByRole("combobox", { name: "Model", exact: true });
  await modelCombobox.click();
  await page.getByRole("option", { name: /DeepSeek Flash/ }).click();
  assert.equal(
    await modelCombobox.textContent().then((text) => text.includes("DeepSeek Flash")),
    true,
  );
  assert.equal(
    await retainedThreadExplorer.evaluate((element) => element.isConnected),
    true,
    "Opening setup keeps Chat and its Thread Explorer mounted",
  );
  await page.locator(".titlebar").getByRole("button", { name: "Hide workbench" }).click();
  await page.locator(".titlebar").getByRole("button", { name: "Close setup" }).click();
  await page.locator(".onboarding-page-surface").waitFor({ state: "detached" });
  await page
    .locator("[data-chat-sidebar]")
    .getByRole("button", { name: "New Conversation", exact: true })
    .click();
  assert.equal(await page.locator(".chat").getAttribute("aria-hidden"), "false");
  await page.locator(".thread-row").first().click();
  await selectedThread.hover();
  assert.equal(
    await selectedThread.evaluate((row) => getComputedStyle(row).backgroundColor),
    selectedBackground,
  );
  await selectResolvedTheme("dark");
  const darkChrome = await page.evaluate(() => ({
    sidebar: getComputedStyle(document.querySelector(".sidebar")).backgroundColor,
    framework: getComputedStyle(document.querySelector(".framework")).backgroundColor,
    app: getComputedStyle(document.querySelector(".app-shell")).backgroundColor,
    selectedThread: getComputedStyle(document.querySelector('.thread-row[data-active="true"]'))
      .backgroundColor,
    surface: getComputedStyle(document.querySelector(".workspace")).backgroundColor,
    workspacePanel: getComputedStyle(
      document.querySelector(".workspace").closest(".ui-resizable-panel"),
    ).backgroundColor,
    workspaceRadius: getComputedStyle(document.querySelector(".workspace")).borderRadius,
    threadRadius: getComputedStyle(document.querySelector(".workspace [data-thread-surface]"))
      .borderRadius,
    explorerRadius: getComputedStyle(
      document.querySelector('.workspace explorer[aria-label="Conversation Thread"]'),
    ).borderRadius,
  }));
  assert.ok(
    darkChrome.framework === "rgba(0, 0, 0, 0)" || darkChrome.framework === darkChrome.app,
    JSON.stringify(darkChrome),
  );
  assert.equal(darkChrome.sidebar, await resolvedColor("--sidebar"));
  await assertEquivalentColor(
    darkChrome.selectedThread,
    await resolvedColor("--sidebar-active"),
    "selected Thread background",
  );
  assert.equal(darkChrome.workspacePanel, darkChrome.surface);
  assert.equal(darkChrome.workspaceRadius, "0px");
  assert.equal(darkChrome.threadRadius, "0px");
  assert.equal(darkChrome.explorerRadius, "0px");
  assert.notEqual(darkChrome.surface, "rgb(255, 255, 255)");
  await selectResolvedTheme("light");
  assert.equal(await page.locator(".workbench").isVisible(), false);
  const first = await request("workbench.open", {
    kind: "browser",
    target: "https://example.com/one",
    newInstance: true,
  });
  await page.locator(".artifact-row").waitFor();
  assert.equal(
    await page
      .locator(".thread-row")
      .first()
      .evaluate((parent) => {
        const item = parent.closest('[data-slot="sidebar-menu-item"]');
        const child = item?.querySelector(
          ':scope > [data-slot="sidebar-menu-sub"] > [data-slot="sidebar-menu-sub-item"]',
        );
        if (!child) throw new Error("thread artifact submenu is missing");
        return Math.round(
          child.getBoundingClientRect().top - parent.getBoundingClientRect().bottom,
        );
      }),
    1,
  );
  const threadChrome = await page.locator(".thread-row").evaluate((row) => {
    const title = getComputedStyle(row.querySelector("strong"));
    const icon = getComputedStyle(row.querySelector("svg"));
    return {
      title: title.color,
      titleOpacity: title.opacity,
      icon: icon.color,
      iconOpacity: icon.opacity,
    };
  });
  assert.equal(threadChrome.title, threadChrome.icon);
  assert.equal(threadChrome.titleOpacity, "1");
  assert.equal(threadChrome.iconOpacity, "1");
  assert.ok(
    (await colorsAreEquivalent(threadChrome.title, await resolvedColor("--foreground"))) ||
      (await colorsAreEquivalent(
        threadChrome.title,
        await resolvedColor("--sidebar-accent-foreground"),
      )),
    "Thread title and icon must use a normal foreground, never a muted/ghost color",
  );
  const activeArtifact = page.locator(".artifact-row.selected");
  const activeArtifactBackground = await activeArtifact.evaluate(
    (row) => getComputedStyle(row).backgroundColor,
  );
  await activeArtifact.hover();
  assert.equal(
    await activeArtifact.evaluate((row) => getComputedStyle(row).backgroundColor),
    activeArtifactBackground,
  );
  assert.equal(
    await page
      .locator(".artifact-row")
      .first()
      .evaluate((row) => row.offsetHeight),
    28,
  );
  assert.equal(await page.locator(".workbench").isVisible(), false);
  await request("tab.metadata", {
    tabId: first.tabId,
    title: "First artifact",
    url: "https://example.com/one",
  });
  const explorer = await page.locator(`[data-tool-tab="${first.tabId}"] explorer`).elementHandle();
  assert.equal(
    await explorer.evaluate((element) => element.src),
    "https://example.com/one",
    "Browser artifacts must load their URL directly in the Workbench Explorer",
  );
  await request("workbench.open", { kind: "office", target: "report.docx", newInstance: true });
  await request("workbench.open", { kind: "workflow" });
  await request("workbench.open", { kind: "markdown" });
  await request("workbench.open", { kind: "terminal", newInstance: true });
  assert.equal(await page.locator(".artifact-row").count(), 5);
  assert.equal(await page.locator(".workbench").isVisible(), false);
  await page
    .locator(".artifact-row")
    .getByRole("button", { name: "First artifact", exact: true })
    .click();
  const firstSurface = page.locator(`[data-tool-tab="${first.tabId}"]`);
  assert.equal(await firstSurface.getAttribute("data-active"), "true");
  await page.locator(".titlebar").getByRole("button", { name: "Open setup" }).click();
  await page.locator(".onboarding-page-surface").waitFor();
  assert.equal(await firstSurface.getAttribute("data-active"), "false");
  assert.ok((await firstSurface.boundingBox()).x < -90_000);
  await page.locator(".titlebar").getByRole("button", { name: "Close setup" }).click();
  await page.locator(".onboarding-page-surface").waitFor({ state: "detached" });
  assert.equal(await firstSurface.getAttribute("data-active"), "true");
  for (let iteration = 0; iteration < 8; iteration += 1) {
    await page.locator(".thread-row").click();
    assert.equal(await firstSurface.getAttribute("data-active"), "false");
    assert.equal(await page.locator(".workspace > .explorer-titlebar").count(), 0);
    assert.ok((await firstSurface.boundingBox()).x < -90_000);
    assert.equal(
      await page
        .locator('explorer[aria-label="Conversation Thread"]')
        .evaluate((element) => getComputedStyle(element).display),
      "block",
      "The Thread Explorer stays mounted while artifacts move offscreen",
    );
    await page
      .locator(".artifact-row")
      .getByRole("button", { name: "First artifact", exact: true })
      .click();
    assert.equal(await firstSurface.getAttribute("data-active"), "true");
    assert.ok((await firstSurface.boundingBox()).x >= 0);
  }
  assert.equal(
    await page
      .locator('explorer[aria-label="Conversation Thread"]')
      .evaluate((element) => getComputedStyle(element).display),
    "block",
  );
  const chatTitlebar = page.locator(
    'header[data-workspace-titlebar]:has([data-titlebar-slot="sidebar-toggle"])',
  );
  assert.deepEqual(
    await page.locator(".chat").evaluate((chat) => {
      const workspace = chat.querySelector(".workspace");
      const threadExplorer = workspace.querySelector('explorer[aria-label="Conversation Thread"]');
      return {
        chatBackground: getComputedStyle(chat).backgroundColor,
        workspaceBackground: getComputedStyle(workspace).backgroundColor,
        outlineWidth: getComputedStyle(chat, "::after").borderTopWidth,
        explorerRadius: getComputedStyle(threadExplorer).borderRadius,
        workspaceOverflow: getComputedStyle(workspace).overflow,
      };
    }),
    {
      chatBackground: await resolvedColor("--surface"),
      workspaceBackground: await resolvedColor("--background"),
      outlineWidth: "0px",
      explorerRadius: "0px",
      workspaceOverflow: "hidden",
    },
  );
  const initialSidebarLabel = await chatTitlebar
    .getByRole("button")
    .first()
    .getAttribute("aria-label");
  assert.equal(
    initialSidebarLabel,
    "Hide sidebar",
    "Chat Sidebar must start expanded even if an older profile persisted a closed state",
  );
  const sidebarToggle = chatTitlebar.getByRole("button", { name: initialSidebarLabel });
  assert.equal(
    await sidebarToggle.locator("svg").evaluate((icon) => icon.getBoundingClientRect().width),
    16,
  );
  assert.ok(
    (await sidebarToggle.locator("svg").getAttribute("class")).includes(
      initialSidebarLabel === "Hide sidebar" ? "panel-left-close" : "panel-left-open",
    ),
  );
  await sidebarToggle.click();
  const toggledSidebarLabel =
    initialSidebarLabel === "Show sidebar" ? "Hide sidebar" : "Show sidebar";
  const toggledSidebar = chatTitlebar.getByRole("button", { name: toggledSidebarLabel });
  await toggledSidebar.waitFor();
  await toggledSidebar.click();
  assert.ok(
    (await chatTitlebar.getByRole("button", { name: "Add tab" }).boundingBox()).x <
      (await chatTitlebar.locator(".pane-active-tab").boundingBox()).x,
    "The Add tab button sits immediately before the active tab area",
  );
  assert.deepEqual(
    await chatTitlebar.getByRole("button", { name: "Add tab" }).evaluate((button) => ({
      radius: getComputedStyle(button).borderRadius,
      icon: button.querySelector("svg").getBoundingClientRect().width,
    })),
    { radius: "6px", icon: 16 },
  );
  assert.equal(await chatTitlebar.locator(".pane-add-avatar").count(), 0);
  assert.ok(
    await chatTitlebar
      .locator(".pane-divider")
      .evaluateAll((dividers) =>
        dividers.every((divider) => divider.getBoundingClientRect().height === 10),
      ),
  );
  await chatTitlebar.getByRole("button", { name: "Add tab" }).click();
  await chatTitlebar.locator(".pane-add-dropdown").waitFor();
  await chatTitlebar.press("Escape");
  assert.equal(await chatTitlebar.locator(".pane-add-dropdown").count(), 0);
  await chatTitlebar.getByRole("button", { name: "Open in Workbench" }).click();
  assert.equal(await page.locator(".artifact-row").count(), 4);
  await page.locator(".workbench").waitFor();
  assert.equal(
    await explorer.evaluate((element) => element.isConnected),
    true,
    "moving a pane preserves its Explorer",
  );
  const dimensions = await page.evaluate(() => {
    const a = document.querySelector(".chat"),
      b = document.querySelector(".workbench");
    return {
      gap: b.getBoundingClientRect().left - a.getBoundingClientRect().right,
      a: getComputedStyle(a).borderRadius,
      b: getComputedStyle(b).borderRadius,
    };
  });
  assert.deepEqual(dimensions, { gap: 4, a: "12px", b: "12px" });
  const browserTitlebar = page.locator(".workbench header[data-workspace-titlebar]");
  await browserTitlebar.locator(".pane-active-tab").hover();
  await browserTitlebar.getByRole("button", { name: "Reload page" }).waitFor();
  const browserActionOrder = await browserTitlebar.evaluate((titlebar) => {
    const bounds = (label) =>
      titlebar.querySelector(`[aria-label="${label}"]`).getBoundingClientRect().x;
    return {
      edit: bounds("Edit address"),
      reload: bounds("Reload page"),
      close: titlebar.querySelector('[aria-label^="Close "]').getBoundingClientRect().x,
    };
  });
  assert.ok(
    browserActionOrder.edit < browserActionOrder.reload &&
      browserActionOrder.reload < browserActionOrder.close,
    JSON.stringify(browserActionOrder),
  );
  await page
    .locator(".workbench")
    .getByRole("button", { name: "Edit address" })
    .evaluate((button) => button.click());
  const address = page.locator(".workbench").getByRole("combobox");
  await address.fill("example.com/two");
  await page.locator("#pane-suggestions [role=option]").first().waitFor();
  const omniboxAlignment = await page.evaluate(() => {
    const input = document.querySelector(".workbench .pane-omnibox").getBoundingClientRect();
    const dropdown = document.querySelector(".pane-omnibox-dropdown").getBoundingClientRect();
    return {
      left: Math.round(dropdown.left - input.left),
      right: Math.round(input.right - dropdown.right),
    };
  });
  assert.deepEqual(omniboxAlignment, { left: 0, right: 0 });
  await address.press("ArrowDown");
  await address.press("Enter");
  assert.equal(await address.count(), 0);
  const persisted = JSON.parse(
    await page.evaluate(() => localStorage.getItem("ovule.workbench.tabs")),
  );
  assert.equal(persisted.tabs.find((tab) => tab.id === first.tabId).target, "example.com/two");
  await page.locator(".workbench").getByRole("button", { name: "Add tab" }).click();
  await page
    .locator(".workbench .pane-add-dropdown")
    .getByRole("menuitem", { name: "Browser", exact: true })
    .click();
  assert.equal(await page.locator(".workbench .pane-active-tab strong").textContent(), "New tab");
  assert.equal(await page.locator(".workbench .pane-active-tab small").count(), 0);
  await page.locator(".workbench").getByRole("button", { name: "Add tab" }).click();
  await page
    .locator(".workbench .pane-add-dropdown")
    .getByRole("menuitem", { name: "Local files", exact: true })
    .click();
  assert.equal(
    await page.locator(".workbench .pane-active-tab strong").textContent(),
    "Local files",
  );
  await page.locator(".workbench .pane-active-tab").hover();
  assert.equal(await page.locator(".workbench .pane-toolbar-actions input").count(), 0);
  assert.equal(
    await page.locator(".workbench").getByRole("button", { name: "Choose Office file" }).count(),
    1,
  );
  assert.equal(
    await page.locator(".workbench").getByRole("button", { name: "Save Office file" }).count(),
    0,
  );
  await page.locator(".workbench").getByRole("button", { name: "Add tab" }).click();
  await page.getByRole("separator", { name: "Resize workbench panel" }).focus();
  assert.equal(await page.locator(".workbench .pane-add-dropdown").count(), 0);
  await page.locator(".workbench").getByRole("button", { name: "Add tab" }).click();
  await page
    .locator(".workbench .pane-add-dropdown")
    .getByRole("menuitem", { name: "Terminal", exact: true })
    .click();
  const terminalLocationDialog = page.getByRole("dialog", {
    name: "Choose terminal working directory",
  });
  await terminalLocationDialog.waitFor();
  assert.equal(
    await terminalLocationDialog.getByRole("button", { name: "Open terminal" }).count(),
    0,
    "terminal locations open in one click without a second confirmation action",
  );
  await terminalLocationDialog.getByRole("button", { name: /HOME/ }).click();
  await terminalLocationDialog.waitFor({ state: "hidden" });
  await page
    .locator('.workbench .pane-toolbar-actions[data-kind="terminal"]')
    .waitFor({ state: "attached" });
  assert.equal(await page.locator(".workbench .pane-active-tab").count(), 1);
  await page.locator(".workbench .pane-active-tab").hover();
  assert.equal(await page.locator('.pane-toolbar-actions[data-kind="terminal"] strong').count(), 0);
  for (const label of [
    "Copy terminal output",
    "Rerun terminal command",
    "Cancel terminal command",
  ]) {
    assert.equal(await page.locator(".workbench").getByRole("button", { name: label }).count(), 0);
  }
  for (const label of ["Find in terminal", "Clear terminal"]) {
    assert.equal(await page.locator(".workbench").getByRole("button", { name: label }).count(), 1);
  }
  assert.equal(
    await page.locator(".workbench").getByRole("button", { name: "Edit address" }).count(),
    0,
  );
  await page.locator(".workbench").getByRole("button", { name: "Add tab" }).click();
  const remoteHostMenuItem = page
    .locator(".workbench .pane-add-dropdown")
    .getByRole("menuitem", { name: "Remote Host", exact: true });
  await remoteHostMenuItem.waitFor();
  await remoteHostMenuItem.click();
  const remoteHostDialog = page.getByRole("dialog", { name: "Open Remote Host" });
  await remoteHostDialog.waitFor();
  await remoteHostDialog.getByRole("button", { name: /Legacy Link Host/ }).click();
  await remoteHostDialog.waitFor({ state: "hidden" });
  const remoteTabsState = JSON.parse(
    await page.evaluate(() => localStorage.getItem("ovule.workbench.tabs")),
  );
  const remoteTab = remoteTabsState.tabs.find((tab) => tab.kind === "spice");
  assert.match(remoteTab.target, /^remote-control-session:/);
  const remoteHostPaneUrl = new URL("/pane", base);
  remoteHostPaneUrl.searchParams.set("kind", "spice");
  remoteHostPaneUrl.searchParams.set("tab", remoteTab.id);
  remoteHostPaneUrl.searchParams.set("target", remoteTab.target);
  const remoteHostPane = await browser.newPage({
    viewport: { width: 1200, height: 760 },
    locale: "en-US",
  });
  await remoteHostPane.goto(remoteHostPaneUrl.href);
  remoteHostPane.on("pageerror", (error) => errors.push(error.message));
  await remoteHostPane
    .getByText("Remote desktop is available in the native Ovule application", { exact: true })
    .waitFor({ state: "attached" });
  await remoteHostPane.getByLabel("Display quality").waitFor();
  assert.equal(await remoteHostPane.getByText("Latency 18 ms", { exact: true }).count(), 0);
  const remoteDesktopVideo = remoteHostPane.locator('video[tabindex="0"]');
  assert.match((await remoteDesktopVideo.getAttribute("aria-label")) ?? "", /Legacy Link Host/);
  await remoteHostPane.close();
  const reopenedRemoteHostPane = await browser.newPage({
    viewport: { width: 1200, height: 760 },
    locale: "en-US",
  });
  await reopenedRemoteHostPane.goto(remoteHostPaneUrl.href);
  await reopenedRemoteHostPane
    .getByText("Remote desktop is available in the native Ovule application", { exact: true })
    .waitFor({ state: "attached" });
  await reopenedRemoteHostPane.close();
  await page.locator(".workbench .pane-active-tab").click();
  const menuRows = page.locator(".workbench .pane-menu-row");
  assert.deepEqual(
    await page.locator(".workbench").evaluate((workbench) => {
      const region = workbench.querySelector(".pane-tabs-region").getBoundingClientRect();
      const dropdown = workbench.querySelector(".pane-tabs-dropdown").getBoundingClientRect();
      return {
        left: Math.round(dropdown.left - region.left),
        right: Math.round(region.right - dropdown.right),
      };
    }),
    { left: 0, right: 0 },
  );
  assert.equal(await page.locator(".workbench .pane-tabs-dropdown small").count(), 0);
  await assertEquivalentColor(
    await page
      .locator(".workbench .pane-tabs-dropdown")
      .evaluate((panel) => getComputedStyle(panel).backgroundColor),
    await resolvedColor("--popover"),
    "Tabs panel uses the popover background",
  );
  assert.equal(await menuRows.first().evaluate((element) => element.clientHeight), 32);
  assert.equal(
    await menuRows
      .first()
      .getByRole("button", { name: /^Close / })
      .count(),
    1,
  );
  const firstClose = menuRows.first().getByRole("button", { name: /^Close / });
  assert.equal(await firstClose.evaluate((button) => getComputedStyle(button).opacity), "0");
  await menuRows.first().hover();
  await page.waitForTimeout(150);
  assert.ok(Number(await firstClose.evaluate((button) => getComputedStyle(button).opacity)) > 0.9);
  const menuGap = await menuRows.evaluateAll((rows) => {
    const firstBounds = rows[0].getBoundingClientRect();
    const secondBounds = rows[1].getBoundingClientRect();
    return secondBounds.top - firstBounds.bottom;
  });
  assert.equal(menuGap, 1);
  await page.locator(".workbench .pane-active-tab").click();
  const before = (await page.locator(".workbench").boundingBox()).width;
  const resizeHandle = page.getByRole("separator", { name: "Resize workbench panel" });
  await resizeHandle.focus();
  await page.keyboard.press("ArrowLeft");
  assert.ok((await page.locator(".workbench").boundingBox()).width > before);
  const handle = await resizeHandle.boundingBox();
  const beforeDrag = (await page.locator(".workbench").boundingBox()).width;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
  await page.mouse.down();
  await page.mouse.move(handle.x - 30, handle.y + 100, { steps: 4 });
  await page.mouse.up();
  assert.ok((await page.locator(".workbench").boundingBox()).width > beforeDrag);
  await page.locator(".workbench").getByRole("button", { name: "Expand panel" }).click();
  await page.waitForFunction(() => {
    const framework = document.querySelector(".framework").getBoundingClientRect();
    const workbench = document.querySelector(".workbench").getBoundingClientRect();
    return (
      Math.abs(framework.left - workbench.left) < 1 &&
      Math.abs(framework.width - workbench.width) < 1
    );
  });
  assert.deepEqual(
    await page.evaluate(() => {
      const framework = document.querySelector(".framework").getBoundingClientRect();
      const workbench = document.querySelector(".workbench").getBoundingClientRect();
      return {
        left: Math.round(workbench.left - framework.left),
        right: Math.round(framework.right - workbench.right),
      };
    }),
    { left: 0, right: 0 },
  );
  await page.locator(".workbench").getByRole("button", { name: "Restore panel width" }).click();
  await page.waitForFunction(
    () => document.querySelector(".chat").getBoundingClientRect().width >= 360,
  );
  await page.setViewportSize({ width: 1000, height: 920 });
  await page.waitForFunction(
    () =>
      document.querySelector(".chat").getBoundingClientRect().width < 567 &&
      document.querySelectorAll(".chat .sidebar").length === 0,
  );
  await request("layout.toggleSidebar", {});
  await page.locator(".ui-drawer-content .sidebar").waitFor();
  assert.equal(
    await page
      .locator(".ui-drawer-content")
      .evaluate((drawer) => getComputedStyle(drawer).position),
    "absolute",
  );
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.locator(".chat > [data-slot=resizable-panel-group] .sidebar").waitFor();
  const restoredWorkbenchState = await page.locator(".workbench").evaluate((workbench) => ({
    visible: Boolean(
      workbench.getBoundingClientRect().width && workbench.getBoundingClientRect().height,
    ),
    display: getComputedStyle(workbench).display,
    labels: Array.from(workbench.querySelectorAll("button")).map((button) => button.ariaLabel),
  }));
  assert.equal(restoredWorkbenchState.visible, true, JSON.stringify(restoredWorkbenchState));
  assert.ok(
    restoredWorkbenchState.labels.includes("Restore panel width") ||
      restoredWorkbenchState.labels.includes("Expand panel"),
    JSON.stringify(restoredWorkbenchState),
  );
  await page.locator(".titlebar").getByRole("button", { name: "Hide workbench" }).click();
  assert.equal(await page.locator(".workbench").isVisible(), false);
  await page.reload();
  await page.locator(".sidebar").waitFor();
  assert.equal(await page.locator(".workbench").isVisible(), false);
  assert.equal(await page.locator(".artifact-row").count(), 4);
  await page.locator(".artifact-row .artifact-select").first().click();
  await mkdir(".tmp", { recursive: true });
  await page.screenshot({ path: ".tmp/spa-workbench.png" });
  await page.evaluate(() => {
    history.pushState(null, "", "/pane?kind=terminal&thread=thread-0001&tab=smoke-terminal");
    window.dispatchEvent(new Event("ovule:route"));
  });
  await page.locator(".terminal-panel").waitFor();
  assert.equal(await page.locator(".browser-address").count(), 0);
  await page.goBack();
  await page.locator(".sidebar").waitFor();
  await page.goto(`${base}/thread?thread=thread-0001&language=en&theme=light`);
  await page.locator(".conversation .composer").waitFor();
  const threadHost = page.getByRole("combobox", {
    name: "Conversation Thread Host",
    exact: true,
  });
  const threadAgent = page.getByRole("button", {
    name: "Conversation Thread Agent",
    exact: true,
  });
  await threadHost.waitFor();
  await threadAgent.waitFor();
  const composerAgentLayout = await page.evaluate(() => ({
    messageTop: document.querySelector('[aria-label="Message"]').getBoundingClientRect().top,
    agentTop: document
      .querySelector('[aria-label="Conversation Thread Agent"]')
      .getBoundingClientRect().top,
  }));
  assert.ok(composerAgentLayout.agentTop > composerAgentLayout.messageTop);
  assert.equal(await page.getByText(/Enter to send|Shift\+Enter for newline/).count(), 0);
  assert.equal(await page.locator(".workspace-path,.workspace-line").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Copy workspace path" }).count(), 0);
  const messageBorders = await page
    .locator(".message-card")
    .evaluateAll((cards) => cards.map((card) => getComputedStyle(card).borderTopWidth));
  assert.ok(messageBorders.every((width) => width === "0px"));
  const goalBorders = await page
    .locator(".goal-card")
    .evaluateAll((cards) => cards.map((card) => getComputedStyle(card).borderTopWidth));
  assert.ok(goalBorders.every((width) => width === "1px"));
  assert.ok(
    await page.locator(".attempt-output").evaluateAll((outputs) =>
      outputs.every((output) => {
        const style = getComputedStyle(output);
        return style.maxHeight === "none" && style.overflowWrap === "anywhere";
      }),
    ),
  );
  assert.equal(
    await page.locator(".timeline").evaluate((timeline) => getComputedStyle(timeline).overflowX),
    "hidden",
  );
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  assert.equal(
    await page
      .evaluate(() => ({
        root: getComputedStyle(document.documentElement).backgroundColor,
        conversation: getComputedStyle(document.querySelector(".conversation")).backgroundColor,
      }))
      .then(({ root, conversation }) => root === conversation),
    true,
  );
  assert.equal(await page.locator(".sidebar").count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.goto(`${base}/pane?kind=files&thread=thread-0001`);
  const localPath = page.locator(".local-file-empty input");
  await localPath.waitFor();
  await localPath.focus();
  assert.equal(await localPath.evaluate((input) => getComputedStyle(input).outlineStyle), "none");
  await page.goto(`${base}/pane?kind=browser&thread=thread-0001&tab=browser-empty`);
  await page.locator(".browser-panel").waitFor();
  assert.equal(await page.locator("text=No provider registered for PanesService").count(), 0);
  assert.ok((await page.locator(".browser-surface").boundingBox()).height > 100);
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Address or search",
  );
  assert.equal(
    await page
      .getByRole("combobox", { name: "Address or search" })
      .evaluate((input) => getComputedStyle(input).outlineStyle),
    "none",
  );
  await page.goto(`${base}/pane?kind=workflow&thread=thread-0001`);
  await page.locator("[data-workflow-panel]").waitFor();
  assert.equal(await page.locator(".browser-address").count(), 0);
  // HTML snapshot isolation is covered by explorer-resources-smoke.mjs.
  assert.deepEqual(errors, []);
  console.log("spa-workbench-smoke=ok (stock Edge; native Explorer not exercised)");
} finally {
  await browser.close();
}

import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const executablePath = process.env.OVULE_BROWSER;
const baseUrl = process.env.OVULE_UI_URL ?? "http://127.0.0.1:4173/main";
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 920 },
  locale: "en-US",
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
page.on("requestfailed", (request) =>
  errors.push(`request: ${request.url()} · ${request.failure()?.errorText ?? "failed"}`),
);
page.on("response", (response) => {
  if (response.status() >= 400) errors.push(`response: ${response.status()} ${response.url()}`);
});

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const titlebar = page.locator(".titlebar");
  await titlebar.getByRole("button", { name: "Settings", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Settings", exact: true }).count(),
    1,
    "Settings must have exactly one global entry",
  );
  const manageButton = titlebar.getByRole("button", { name: "Settings", exact: true });
  const setupButton = titlebar.getByRole("button", { name: "Open setup", exact: true });
  const workbenchButton = titlebar.getByRole("button", { name: "Show workbench", exact: true });
  assert.equal(
    await titlebar.getByRole("button", { name: "Hosts", exact: true }).count(),
    0,
    "Hosts must live inside Settings instead of the titlebar",
  );
  assert.equal(
    await titlebar.getByRole("button", { name: "New Conversation", exact: true }).count(),
    0,
    "New Conversation must live in the Chat Sidebar instead of the titlebar",
  );
  await page
    .locator("[data-chat-sidebar]")
    .getByRole("button", { name: "New Conversation", exact: true })
    .waitFor();
  assert.equal(
    await page.locator("[data-chat-sidebar] .thread-row small").count(),
    0,
    "Chat Sidebar Thread rows must not expose threadAgent",
  );
  const titlebarTools = [setupButton, manageButton, workbenchButton];
  const toolBoxes = await Promise.all(titlebarTools.map((button) => button.boundingBox()));
  assert.ok(
    toolBoxes.every((box) => box?.width === 28 && box?.height === 28),
    "global titlebar tools must be 28x28",
  );
  assert.ok(
    toolBoxes.slice(1).every((box, index) => box.x - (toolBoxes[index].x + 28) === 4),
    "global titlebar tools must use a 4px gap",
  );
  assert.ok(
    await Promise.all(
      titlebarTools.map((button) =>
        button.locator("svg").evaluate((icon) => {
          const box = icon.getBoundingClientRect();
          return box.width === 16 && box.height === 16;
        }),
      ),
    ).then((sizes) => sizes.every(Boolean)),
    "global titlebar tool icons must be 16x16",
  );
  const minimize = titlebar.getByRole("button", { name: "Minimize window" });
  if (process.platform === "darwin") {
    assert.equal(await minimize.count(), 0, "macOS uses native window controls");
  } else {
    assert.equal(
      (await minimize.boundingBox()).width,
      44,
      "window controls must keep their native 44px hit target",
    );
  }
  await setupButton.click();
  await page.getByRole("heading", { name: "Configure your Agents" }).waitFor();
  await manageButton.click();
  const manageSurface = page.locator('[data-framework-content="settings"]');
  await manageSurface.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "Configure your Agents" }).isVisible(),
    false,
    "opening Settings must close Setup",
  );
  assert.equal(
    await page
      .locator("[data-chat-sidebar] .language-toggle, [data-chat-sidebar] .theme-toggle")
      .count(),
    0,
  );
  await manageSurface.getByRole("heading", { name: "Preferences", exact: true }).waitFor();
  assert.equal(
    await manageSurface.getByRole("combobox", { name: "Language", exact: true }).textContent(),
    "Follow system",
  );
  assert.equal(
    await manageSurface
      .getByRole("radio", { name: "Follow system", exact: true })
      .getAttribute("aria-checked"),
    "true",
  );
  await manageSurface.getByRole("button", { name: "Agents", exact: true }).click();
  const connectedHeader = manageSurface.locator("[data-catalog-section-header]");
  await connectedHeader.getByRole("heading", { name: "Agent profiles", exact: true }).waitFor();
  const connectedHeaderBox = await connectedHeader.boundingBox();
  assert.equal(
    await manageSurface
      .locator('aside[data-slot="sidebar"]')
      .getByText(/Configure agents/)
      .count(),
    0,
    "Settings sidebar must not repeat the catalog description",
  );
  assert.equal(
    await manageSurface.getByRole("button", { name: "Close", exact: true }).count(),
    0,
    "Settings sidebar must not render a Close button",
  );
  assert.equal(
    await manageSurface.getByRole("button", { name: "Connected apps", exact: true }).count(),
    0,
    "Settings must not expose the retired Connected apps entry",
  );
  await workbenchButton.click();
  await page.waitForFunction(
    () => document.querySelector("[data-settings-panel]")?.dataset.sidebarCompact === "true",
  );
  const manageSidebar = manageSurface.locator('aside[data-slot="sidebar"]');
  assert.ok((await manageSidebar.boundingBox()).width <= 60);
  assert.ok(
    await manageSidebar.locator('[data-slot="sidebar-menu-button"]').evaluateAll((buttons) =>
      buttons.every((button) => {
        const icon = button.querySelector("svg");
        if (!icon) return false;
        const buttonBox = button.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        return (
          Math.round(buttonBox.width) === 34 &&
          Math.abs(buttonBox.left + buttonBox.width / 2 - (iconBox.left + iconBox.width / 2)) <= 1
        );
      }),
    ),
    "compact Settings navigation icons must be horizontally centered in 34px active surfaces",
  );
  const compactToolsButton = manageSidebar.getByRole("button", { name: "Tools", exact: true });
  await compactToolsButton.hover();
  await page.getByRole("tooltip").getByText("Tools", { exact: true }).waitFor();
  assert.ok(
    (await manageSurface.locator('[data-settings-section="agents"]').boundingBox()).width > 240,
  );
  await compactToolsButton.click();
  for (const tab of ["Built-in", "Extensions", "External MCP", "Add external MCP server"])
    await manageSurface.getByRole("tab", { name: tab, exact: true }).waitFor();
  assert.equal(
    await manageSurface.getByRole("tab", { name: "Connected apps", exact: true }).count(),
    0,
    "Tools must not expose a Connected apps tab",
  );
  assert.deepEqual(
    await manageSurface.locator('[data-slot="tabs-list"]').evaluate((tabList) => {
      const style = getComputedStyle(tabList);
      const tabs = [...tabList.querySelectorAll('[role="tab"]')];
      return {
        bordered: parseFloat(style.borderTopWidth) >= 1,
        noWrap: tabs.every((tab) => getComputedStyle(tab).whiteSpace === "nowrap"),
        aligned: tabs.every((tab) => Math.round(tab.getBoundingClientRect().height) === 28),
      };
    }),
    { bordered: true, noWrap: true, aligned: true },
    "Tools must use one bordered shadcn tab list with stable single-line triggers",
  );
  await titlebar.getByRole("button", { name: "Hide workbench", exact: true }).click();
  await manageSurface.getByRole("button", { name: "Hosts", exact: true }).click();
  const hostsSurface = page.locator('[data-framework-content="settings"]');
  await hostsSurface.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  const hostsHeader = hostsSurface.locator("[data-catalog-section-header]");
  await hostsHeader.getByRole("heading", { name: "Hosts", exact: true }).waitFor();
  const hostsHeaderBox = await hostsHeader.boundingBox();
  assert.ok(
    connectedHeaderBox &&
      hostsHeaderBox &&
      connectedHeaderBox.x === hostsHeaderBox.x &&
      connectedHeaderBox.width === hostsHeaderBox.width,
    "Agents and Hosts must share the Catalog section header geometry",
  );
  assert.equal(
    await manageButton.getAttribute("data-active"),
    "true",
    "Settings must stay active while its Hosts section is visible",
  );
  assert.equal(await page.locator("[data-chat-root]").getAttribute("aria-hidden"), "true");
  const leftSurfaceBox = await page.locator("[data-framework-left-surface]").boundingBox();
  const frameworkBox = await page.locator(".framework").boundingBox();
  assert.equal(leftSurfaceBox.x, frameworkBox.x);
  assert.equal(leftSurfaceBox.y, frameworkBox.y);
  assert.equal(leftSurfaceBox.height, frameworkBox.height);
  assert.ok(
    await hostsSurface
      .getByRole("button", { name: "Hosts", exact: true })
      .getAttribute("data-active"),
    "Hosts must be an active Settings sidebar section",
  );
  const pairedDevicesTab = hostsSurface.getByRole("tab", { name: /Paired Devices/ });
  const remoteHostsTab = hostsSurface.getByRole("tab", { name: /Remote Hosts/ });
  assert.equal(await pairedDevicesTab.getAttribute("aria-selected"), "true");
  assert.equal(await remoteHostsTab.getAttribute("aria-selected"), "false");
  assert.equal(await hostsSurface.getByLabel("Ovule Link").isVisible(), false);
  await hostsSurface.getByRole("heading", { name: "Paired Devices", exact: true }).waitFor();
  const designDevice = hostsSurface.locator("article").filter({ hasText: "Design Laptop" });
  await designDevice.getByText("Online", { exact: true }).waitFor();
  const hostPairLink = hostsSurface.getByRole("textbox", {
    name: "This Host pair link",
    exact: true,
  });
  assert.equal(await hostPairLink.getAttribute("type"), "password");
  await hostsSurface.getByRole("button", { name: "Show pair link" }).click();
  assert.equal(await hostPairLink.getAttribute("type"), "text");
  const initialPairLink = await hostPairLink.inputValue();
  const copyPairLink = hostsSurface.getByRole("button", { name: "Copy this Host pair link" });
  await copyPairLink.click();
  await copyPairLink.locator(".lucide-check").waitFor();
  assert.match(
    await page.evaluate(() => navigator.clipboard.readText()),
    /^ovule:\/\/app\/hosts\/link/,
  );
  await page.waitForTimeout(5_100);
  await copyPairLink.locator(".lucide-copy").waitFor();
  await hostsSurface.getByRole("button", { name: "Regenerate this Host pair link" }).click();
  assert.notEqual(await hostPairLink.inputValue(), initialPairLink);
  assert.equal(await hostPairLink.getAttribute("type"), "password");
  const resetHostIdentity = hostsSurface.getByRole("button", {
    name: "Reset this Host Link identity",
    exact: true,
  });
  await resetHostIdentity.click();
  const resetHostDialog = page.getByRole("alertdialog");
  await resetHostDialog
    .getByRole("heading", { name: "Reset this Host Link identity?", exact: true })
    .waitFor();
  await resetHostDialog.getByText(/Workspace files and SSH Hosts are preserved/).waitFor();
  await resetHostDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await resetHostDialog.waitFor({ state: "hidden" });
  await remoteHostsTab.click();
  assert.equal(await pairedDevicesTab.getAttribute("aria-selected"), "false");
  assert.equal(await remoteHostsTab.getAttribute("aria-selected"), "true");
  await hostsSurface
    .getByLabel("Ovule Link")
    .fill(
      "ovule://app/hosts/link?endpoint=mock-link-host&share=host&address=eyJpZCI6Im1vY2stbGluay1ob3N0IiwiYWRkcnMiOltdfQ&name=Studio%20PC&alias=This%20Host",
    );
  await hostsSurface.getByRole("button", { name: "Continue", exact: true }).click();
  await hostsSurface.getByText("Studio PC", { exact: true }).waitFor();
  await hostsSurface.getByText(/End-to-end encrypted · Host/).waitFor();
  assert.equal(await hostsSurface.getByLabel("Pairing code").count(), 0);
  assert.equal(await hostsSurface.getByLabel("SSH authentication method").count(), 0);
  await hostsSurface.getByRole("button", { name: "Connect", exact: true }).click();
  const connecting = hostsSurface.getByRole("button", { name: "Connecting…", exact: true });
  await connecting.waitFor();
  assert.equal(
    await connecting.isDisabled(),
    true,
    "Connect must expose an immediate pending state",
  );
  const remoteHosts = hostsSurface
    .getByRole("heading", { name: "Remote Hosts", exact: true })
    .locator("xpath=ancestor::section[1]");
  const studioHost = remoteHosts.locator("article").filter({ hasText: "Studio PC" });
  await studioHost.getByText("Online", { exact: true }).waitFor();
  const refreshStudio = studioHost.getByRole("button", { name: "Refresh Studio PC", exact: true });
  await refreshStudio.click();
  await refreshStudio.locator("svg.spin").waitFor();
  await hostsSurface.getByText("Studio PC refreshed.", { exact: true }).waitFor();
  await refreshStudio.locator("svg.spin").waitFor({ state: "detached" });
  await studioHost.getByText("project", { exact: true }).waitFor();
  await studioHost.getByText(/ovule, codex, sample/).waitFor();
  assert.equal(await studioHost.getByText("Advanced: manual SPICE bridge").count(), 0);
  assert.equal(await hostsSurface.getByText("Advanced: SSH", { exact: true }).count(), 0);
  assert.equal(
    await studioHost.getByRole("textbox", { name: /SPICE WebSocket URL/ }).count(),
    0,
    "Remote Hosts must not expose the retired manual SPICE bridge",
  );
  await studioHost
    .getByText("This Host supports desktop control; connectivity is not yet verified", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await studioHost.getByRole("button", { name: "Open desktop", exact: true }).isEnabled(),
    true,
    "Ovule Link Remote Control capability must enable the desktop without a bridge URL",
  );
  const openDesktop = studioHost.getByRole("button", { name: "Open desktop", exact: true });
  assert.deepEqual(
    await openDesktop.evaluate((button) => {
      const box = button.getBoundingClientRect();
      return {
        width: Math.round(box.width),
        height: Math.round(box.height),
        text: button.textContent.trim(),
      };
    }),
    { width: 28, height: 28, text: "" },
    "Open desktop must be an icon-only 28px action",
  );
  await openDesktop.hover();
  await page.getByRole("tooltip").getByText("Open desktop", { exact: true }).waitFor();
  await studioHost.getByRole("button", { name: "Bind", exact: true }).click();
  await studioHost.locator("header").getByRole("button", { name: "Unbind", exact: true }).click();
  await studioHost.getByRole("button", { name: "Bind", exact: true }).waitFor();
  await studioHost.getByRole("button", { name: "Bind", exact: true }).click();
  await pairedDevicesTab.click();
  const pairedDevices = hostsSurface
    .getByRole("heading", { name: "Paired Devices", exact: true })
    .locator("xpath=ancestor::section[1]");
  await pairedDevices.getByText("Workspaces", { exact: true }).waitFor();
  await pairedDevices.getByText("Agents", { exact: true }).waitFor();
  await hostsSurface.getByText("project", { exact: true }).first().waitFor();
  const codexGrant = hostsSurface.getByRole("checkbox", { name: "codex", exact: true });
  assert.equal(await codexGrant.isChecked(), true);
  await codexGrant.uncheck();
  await hostsSurface.getByText(/Device access updated/).waitFor();
  assert.equal(await codexGrant.isChecked(), false, "Agent grant can be removed independently");
  await remoteHostsTab.click();
  await studioHost.getByRole("button", { name: "Remove Studio PC" }).click();
  await studioHost.getByRole("button", { name: "Confirm remove Studio PC" }).click();
  await studioHost.waitFor({ state: "hidden" });
  await hostsSurface
    .getByLabel("Ovule Link")
    .fill(
      "ovule://app/hosts/link?endpoint=mock-link-host&share=host&address=eyJpZCI6Im1vY2stbGluay1ob3N0IiwiYWRkcnMiOltdfQ&name=Studio%20PC&alias=This%20Host",
    );
  await hostsSurface.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal(
    await remoteHosts.locator("article").filter({ hasText: "Studio PC" }).count(),
    0,
    "pasting a Pair link must not resurrect a locally removed Host before Connect",
  );
  const clearOldData = hostsSurface.getByRole("button", {
    name: "Reset Link connections",
    exact: true,
  });
  await clearOldData.waitFor();
  assert.equal(
    await clearOldData.evaluate((button) => getComputedStyle(button).whiteSpace),
    "nowrap",
  );
  await clearOldData.click();
  await pairedDevicesTab.click();
  await hostsSurface.getByText("Design Laptop", { exact: true }).waitFor({ state: "hidden" });
  await hostsSurface.getByText("No paired devices yet.", { exact: true }).waitFor();
  await clearOldData.waitFor({ state: "hidden" });
  await manageSurface.waitFor();
  await manageSurface.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(
    await manageSurface.locator('aside[data-slot="sidebar"]').count(),
    1,
    "Settings navigation must use the shared shadcn Sidebar primitive",
  );
  await manageSurface.getByRole("button", { name: "Models", exact: true }).click();
  await manageSurface.getByRole("heading", { name: "Model catalog", exact: true }).waitFor();
  await manageSurface.getByText("DeepSeek Flash", { exact: true }).waitFor();
  assert.ok(
    await manageSurface.locator(".catalog-check .ui-checkbox").evaluateAll((checks) =>
      checks.every((check) => {
        const box = check.getBoundingClientRect();
        return box.width === 16 && box.height === 16;
      }),
    ),
    "Model compatibility checkboxes must retain the compact shadcn size",
  );
  const modelForm = manageSurface.locator(".catalog-form").first();
  await modelForm.getByPlaceholder("coding-fast").fill("shared-custom");
  await modelForm.getByPlaceholder("Fast coding").fill("Shared custom model");
  await modelForm.getByPlaceholder("openai").fill("openai-compatible");
  await modelForm.getByPlaceholder("provider/model-name").fill("custom-model-v1");
  await modelForm.getByLabel("Codex").check();
  await modelForm.getByLabel("Sample ACP").check();
  await modelForm.getByRole("button", { name: "Save", exact: true }).click();
  await manageSurface
    .locator(".catalog-card")
    .filter({ hasText: "Shared custom model" })
    .getByText(/codex, sample/)
    .waitFor();
  await manageSurface.getByRole("button", { name: "Tools", exact: true }).click();
  await manageSurface.getByRole("heading", { name: "Capabilities & tools", exact: true }).waitFor();
  await manageSurface.getByRole("tab", { name: "Add external MCP server", exact: true }).click();
  assert.ok(
    await manageSurface
      .getByLabel("Required for Agent startup", { exact: true })
      .evaluate((check) => {
        const box = check.getBoundingClientRect();
        const label = check.closest("label").getBoundingClientRect();
        return (
          box.width === 16 &&
          box.height === 16 &&
          Math.abs(box.top + box.height / 2 - (label.top + label.height / 2)) <= 1
        );
      }),
    "Tool required checkbox must be compact and vertically aligned",
  );
  await manageSurface.getByRole("button", { name: "Agents", exact: true }).click();
  await manageSurface.getByRole("heading", { name: "Agent profiles", exact: true }).waitFor();
  const sampleCard = manageSurface
    .locator(".catalog-card")
    .filter({ hasText: "Sample ACP" })
    .first();
  await sampleCard.getByRole("button", { name: "Edit", exact: true }).click();
  await manageSurface.getByRole("combobox", { name: "Model", exact: true }).click();
  await page.getByRole("option", { name: "GPT-6 Astra", exact: true }).first().click();
  await manageSurface.getByRole("button", { name: "Save", exact: true }).click();
  await sampleCard.getByText(/discovered-sample-gpt-6-astra/i).waitFor();
  await manageButton.click();
  await manageSurface.waitFor({ state: "hidden" });
  await titlebar.getByRole("button", { name: "Settings", exact: true }).click();
  await manageSurface.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await manageSurface.getByRole("button", { name: "Agents", exact: true }).click();
  await manageSurface
    .locator(".catalog-card")
    .filter({ hasText: "Sample ACP" })
    .first()
    .getByText(/discovered-sample-gpt-6-astra/i)
    .waitFor();
  assert.equal(
    await page.getByRole("tab", { name: "Settings", exact: true }).count(),
    0,
    "Settings must not create a workbench tab",
  );
  assert.equal(
    await manageSurface.evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
    "Settings surface must not expose a horizontal scrollbar",
  );
  await manageSurface.getByRole("button", { name: "Hosts", exact: true }).click();
  const finalHostsSurface = page.locator('[data-framework-content="settings"]');
  await finalHostsSurface
    .getByRole("button", { name: "Reset this Host Link identity", exact: true })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Reset Host identity", exact: true })
    .click();
  await finalHostsSurface
    .getByText(
      "This Host Link identity was reset. Close any old Ovule builds and share the new pair link.",
      { exact: true },
    )
    .waitFor();
  await finalHostsSurface
    .getByRole("button", { name: "Reset this Host Link identity", exact: true })
    .waitFor({ state: "hidden" });
  await manageSurface.getByRole("button", { name: "Agents", exact: true }).click();
  await manageSurface.getByRole("heading", { name: "Agent profiles", exact: true }).waitFor();
  await manageButton.click();
  await manageSurface.waitFor({ state: "hidden" });

  // Thread controls live in a native <explorer> WebContents. Their layout is
  // covered by the native Thread smoke rather than this stock-Edge UI check.
  assert.deepEqual(errors, []);
  console.log("settings_surface_smoke=ok");
} catch (error) {
  if (errors.length > 0) console.error(errors.join("\n"));
  console.error(`url=${page.url()}`);
  console.error(`body=${(await page.locator("body").innerText()).slice(0, 2_000)}`);
  console.error(`html=${(await page.locator("body").innerHTML()).slice(0, 2_000)}`);
  throw error;
} finally {
  await browser.close();
}

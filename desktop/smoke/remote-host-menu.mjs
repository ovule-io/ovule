import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { main, availablePort, port, waitHttp, waitFor } from "./runner.mjs";
await main("remote-host-menu", async (c) => {
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9287));
  const child = c.launch(number, {
    singleProcess: process.platform === "win32",
    extra:
      process.platform === "win32" ? [] : ["--headless", "--no-sandbox", "--window-size=1200,900"],
  });
  await waitHttp(`http://127.0.0.1:${number}/json/version`, child);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${number}`);
  try {
    const pages = () => browser.contexts().flatMap((context) => context.pages());
    const app = await waitFor(async () => {
      for (const page of pages())
        if (
          await page
            .evaluate(
              async () =>
                typeof (await import("/shell_api.js")).workspace.registerEndpoint === "function",
            )
            .catch(() => false)
        )
          return page;
    }, "workspace API");
    const name = "Ovule Device at Home with a long display name for menu layout";
    await app.evaluate(async (displayName) => {
      localStorage.setItem("ovule.onboarding.dismissed", "true");
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
      await api.createThread({});
      const host = await api.shareHostLink();
      // Inventory fixture only: no pairing, TURN or screen-capture authorization.
      await api.registerEndpoint({ displayName, transport: "tunnel", host: host.endpointAddrJson });
    }, name);
    await app.reload();
    const thread = await waitFor(async () => {
      for (const page of pages())
        if (
          await page
            .locator("[data-conversation-root]")
            .count()
            .catch(() => 0)
        )
          return page;
    }, "conversation");
    const menu = thread.getByRole("menu", { name: "Add tab", exact: true });
    await thread.getByRole("button", { name: "Add tab", exact: true }).click();
    const remote = menu.getByRole("menuitem", { name: `Remote Host · ${name}`, exact: true });
    await remote.waitFor();
    assert.equal(
      await menu.getByRole("menuitem", { name: "Manage Remote Hosts", exact: true }).count(),
      0,
    );
    const dimensions = () =>
      remote.evaluate(async (button) => {
        const menu = button.closest('[role="menu"]'),
          toolbar = menu.closest("[data-workspace-titlebar]");
        const icon = button.querySelector("svg").getBoundingClientRect(),
          label = button.querySelector("span");
        return {
          width: menu.getBoundingClientRect().width,
          right: menu.getBoundingClientRect().right,
          boundary: toolbar.getBoundingClientRect().right,
          iconWidth: icon.width,
          iconHeight: icon.height,
          labelHeight: label.getBoundingClientRect().height,
          rowHeight: button.getBoundingClientRect().height,
          clipped: label.scrollWidth > label.clientWidth,
        };
      });
    const wide = await dimensions();
    assert.ok(wide.width > 200, "menu grows to its longest label");
    assert.equal(wide.clipped, false);
    await thread.screenshot({ path: join(c.artifacts, "remote-host-menu-wide.png") });
    await thread.locator("[data-conversation-root]").evaluate(async (element) => {
      element.style.maxWidth = "280px";
    });
    await waitFor(async () => (await dimensions()).width < wide.width, "container resize");
    const narrow = await dimensions();
    assert.ok(narrow.right <= narrow.boundary + 1);
    assert.equal(narrow.iconWidth, 16);
    assert.equal(narrow.iconHeight, 16);
    assert.ok(narrow.rowHeight >= narrow.labelHeight);
    assert.equal(narrow.clipped, true);
    await thread.screenshot({ path: join(c.artifacts, "remote-host-menu-narrow.png") });
    await remote.click();
    const desktop = await waitFor(
      () =>
        pages().find((page) => {
          try {
            return new URL(page.url()).searchParams.get("kind") === "spice";
          } catch {
            return false;
          }
        }),
      "Remote Host opens the desktop pane",
    );
    assert.ok(
      new URL(desktop.url()).searchParams.get("target").startsWith("remote-control-session:"),
    );
    assert.equal(
      pages().some((page) => /bing\.com\/search/.test(page.url())),
      false,
    );
    console.log(
      "remote_host_menu=ok intrinsic_width=true container_resize=true fixed_icons=true manage_removed=true desktop_route=true",
    );
  } finally {
    await browser.close();
  }
});

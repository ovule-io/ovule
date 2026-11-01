import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { main, availablePort, port, waitFor, waitHttp } from "./runner.mjs";

await main("workbench-window", async (c) => {
  await c.claimPackage();
  const number = await availablePort(port(c.opts.port, 9289));
  const app = c.launch(number, { singleProcess: process.platform === "win32" });
  await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${number}`);
  try {
    const page = await waitFor(
      async () => {
        for (const page of browser.contexts().flatMap((context) => context.pages())) {
          if (
            /\/(?:main|index\.html)$/.test(new URL(page.url()).pathname) &&
            (await page.locator('.titlebar button[aria-label="Show workbench"]').count())
          )
            return page;
        }
      },
      "main titlebar",
      90000,
    );
    const closeSetup = page
      .locator(".titlebar")
      .getByRole("button", { name: "Close setup", exact: true });
    if (await closeSetup.count()) await closeSetup.click();
    const initial = await page.evaluate(async () => {
      await import("/tuffite.js");
      const api = (await import("/tuffite.js")).window;
      const current = await api.current();
      if (current.maximized) await api.restore();
      const width = Math.min(1100, screen.availWidth - 364);
      if (!Number.isFinite(width)) throw new Error("No screen work area");
      return api.setBounds({
        ...(await api.current()).bounds,
        width: Math.max(576, width),
        height: 700,
      });
    });
    if (process.platform === "darwin") {
      const reserved = page.locator('.titlebar [data-native-traffic-lights="reserved"]');
      const slogan = page.locator('.titlebar [aria-label="Ovule"]');
      await reserved.waitFor();
      assert.equal(await slogan.count(), 0);
      await page.evaluate(async () => (await import("/tuffite.js")).window.setFullscreen(true));
      await slogan.waitFor();
      await waitFor(
        () =>
          page.evaluate(async () => {
            const info = await (await import("/tuffite.js")).window.current();
            return (
              info.fullscreen &&
              Math.abs(info.bounds.width - screen.width) <= 1 &&
              Math.abs(innerWidth - info.bounds.width) <= 1
            );
          }),
        "completed native fullscreen entry",
      );
      assert.equal(
        await reserved.count(),
        0,
        "Fullscreen must show slogan instead of traffic light space",
      );
      // Bounds can reach their target before AppKit's transition completes.
      await page.waitForTimeout(1200);
      await page.evaluate(async () => (await import("/tuffite.js")).window.setFullscreen(false));
      await waitFor(
        () =>
          page.evaluate(
            async () => !(await (await import("/tuffite.js")).window.current()).fullscreen,
          ),
        "completed native fullscreen exit",
      );
      await reserved.waitFor();
      assert.equal(await slogan.count(), 0, "Leaving fullscreen restores traffic light space");
      await page.evaluate(
        async (bounds) => (await import("/tuffite.js")).window.setBounds(bounds),
        initial.bounds,
      );
    }
    const conversation = page.locator(".framework [data-chat-root]");
    await conversation.waitFor();
    const before = await conversation.evaluate(
      async (element) => element.getBoundingClientRect().width,
    );
    const windowInfo = () =>
      page.evaluate(async () => (await import("/tuffite.js")).window.current());
    const beginSampling = () =>
      conversation.evaluate((element) => {
        const samples = [];
        const sample = () => {
          const bounds = element.getBoundingClientRect();
          samples.push({ x: bounds.x, width: bounds.width });
          window.__workbenchFrames = requestAnimationFrame(sample);
        };
        window.__workbenchSamples = samples;
        sample();
      });
    const checkSamples = async (width) => {
      const samples = await page.evaluate(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        cancelAnimationFrame(window.__workbenchFrames);
        return window.__workbenchSamples;
      });
      assert.ok(samples.length > 1, "Must observe intermediate frames");
      for (const sample of samples) {
        assert.ok(
          Math.abs(sample.width - width) <= 1,
          `Chat changed width during toggle: ${sample.width}, expected ${width}`,
        );
        assert.ok(Math.abs(sample.x - samples[0].x) <= 1, "Chat moved during toggle");
      }
    };
    await beginSampling();
    await page.getByRole("button", { name: "Show workbench", exact: true }).click();
    const opened = await waitFor(async () => {
      const info = await windowInfo();
      return info.bounds.width > initial.bounds.width ? info : undefined;
    }, "expanded native window");
    assert.equal(
      opened.bounds.x,
      initial.bounds.x,
      "Showing must retain the native window x coordinate",
    );
    assert.equal(
      opened.bounds.y,
      initial.bounds.y,
      "Showing must retain the native window y coordinate",
    );
    assert.equal(opened.bounds.width, initial.bounds.width + 364);
    if (opened.bounds.width === initial.bounds.width + 364) {
      await waitFor(
        async () =>
          (await conversation.evaluate(async (element) => element.getBoundingClientRect().width)) >=
          before - 1,
        "preserved conversation width",
      );
    }
    await waitFor(
      () => page.getByRole("button", { name: "Hide workbench", exact: true }).isEnabled(),
      "completed workbench toggle",
    );
    if (opened.bounds.width === initial.bounds.width + 364) await checkSamples(before);
    const divider = await page.locator("[data-titlebar-separator]").boundingBox();
    assert.equal(divider.height, 10, "Titlebar divider height");
    const panel = page.locator(".framework [data-workbench-root]");
    const resizeWindow = (width) =>
      page.evaluate(async (width) => {
        const api = (await import("/tuffite.js")).window;
        return api.setBounds({ ...(await api.current()).bounds, width });
      }, width);
    await resizeWindow(opened.bounds.width + 120);
    await waitFor(
      async () => Math.abs((await panel.boundingBox()).width - 480) <= 1,
      "workbench absorbs window growth",
    );
    assert.ok(
      Math.abs((await conversation.boundingBox()).width - before) <= 1,
      "Window growth must retain chat width",
    );
    await resizeWindow(opened.bounds.width);
    await waitFor(
      async () => Math.abs((await panel.boundingBox()).width - 360) <= 1,
      "workbench absorbs window shrink",
    );
    await page.getByRole("button", { name: "Expand workbench", exact: true }).click();
    await waitFor(
      async () =>
        Math.abs(
          (await panel.boundingBox()).width -
            (await page.locator(".framework").boundingBox()).width,
        ) <= 1,
      "expanded workbench fills framework",
    );
    assert.equal(
      await page.locator("[data-workbench-chat]").evaluate((e) => e.getBoundingClientRect().width),
      0,
    );
    await page.getByRole("button", { name: "Restore panel width", exact: true }).click();
    await waitFor(
      async () => Math.abs((await conversation.boundingBox()).width - before) <= 1,
      "restored chat width",
    );
    const separator = page.getByRole("separator", { name: "Resize workbench panel", exact: true });
    await separator.focus();
    for (let index = 0; index < 60; index++) {
      const width = await conversation.evaluate((element) => element.getBoundingClientRect().width);
      if (width <= 569) break;
      await separator.press("ArrowLeft");
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await waitFor(
      async () =>
        (await conversation.evaluate((element) => element.getBoundingClientRect().width)) <
        before - 1,
      "resized workbench panel",
    );
    const resizedChat = await conversation.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    const panelWidth = await page
      .locator(".framework [data-workbench-root]")
      .evaluate((element) => element.getBoundingClientRect().width);
    assert.ok(
      resizedChat < before - 1,
      `Separator must resize the conversation: before=${before}, after=${resizedChat}, workbench=${panelWidth}`,
    );
    console.log(JSON.stringify({ resizedChat, panelWidth, opened: opened.bounds }));
    await beginSampling();
    await page.getByRole("button", { name: "Hide workbench", exact: true }).click();
    await waitFor(
      async () =>
        Math.abs((await windowInfo()).bounds.width - (opened.bounds.width - panelWidth - 4)) <= 1,
      "restored native width",
    );
    await waitFor(
      () => page.getByRole("button", { name: "Show workbench", exact: true }).isEnabled(),
      "completed workbench hide",
    );
    const hidden = await windowInfo();
    assert.equal(
      hidden.bounds.x,
      initial.bounds.x,
      "Hiding must retain the native window x coordinate",
    );
    assert.equal(
      hidden.bounds.y,
      initial.bounds.y,
      "Hiding must retain the native window y coordinate",
    );
    assert.ok(
      resizedChat <= 569,
      `Chat must resize down to the 576px window minimum: ${resizedChat}`,
    );
    await checkSamples(resizedChat);
    // Reopening after closed-window and open-window resizing must preserve every frame.
    for (const width of [760, 1180, 640]) {
      await resizeWindow(width);
      await waitFor(
        async () => Math.abs((await conversation.boundingBox()).width - (width - 8)) <= 1,
        "closed chat resize",
      );
      const leftWidth = (await conversation.boundingBox()).width;
      await beginSampling();
      await page.getByRole("button", { name: "Show workbench", exact: true }).click();
      await waitFor(
        () => page.getByRole("button", { name: "Hide workbench", exact: true }).isEnabled(),
        "reopened workbench",
      );
      assert.equal((await windowInfo()).bounds.width, width + 364);
      assert.ok(
        Math.abs((await panel.boundingBox()).width - 360) <= 1,
        "Every show starts at 360px",
      );
      await checkSamples(leftWidth);
      await resizeWindow(width + 484);
      await waitFor(
        async () => Math.abs((await panel.boundingBox()).width - 480) <= 1,
        "resized reopened workbench",
      );
      await beginSampling();
      await page.getByRole("button", { name: "Hide workbench", exact: true }).click();
      await waitFor(
        () => page.getByRole("button", { name: "Show workbench", exact: true }).isEnabled(),
        "hidden resized workbench",
      );
      await checkSamples(leftWidth);
      assert.equal((await windowInfo()).bounds.width, width);
    }
    // Programmatic link openings use the same native resize path as the titlebar.
    await resizeWindow(initial.bounds.width);
    await page.reload();
    await page.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
    const opening = page.getByRole("combobox", { name: "Open links in", exact: true });
    await opening.click();
    await page.getByRole("option", { name: "Workbench", exact: true }).click();
    const leftSurface = page.locator("[data-framework-left-surface]");
    const settingsWidth = (await leftSurface.boundingBox()).width;
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ovule:browser-use", { detail: { target: "https://example.com/" } }),
      ),
    );
    await waitFor(
      async () => (await windowInfo()).bounds.width === initial.bounds.width + 364,
      "link opens workbench by expanding native window",
    );
    assert.ok(
      Math.abs((await leftSurface.boundingBox()).width - settingsWidth) <= 1,
      "Settings width must not be compressed",
    );
    await waitFor(
      () => page.getByRole("button", { name: "Back to chat", exact: true }).isVisible(),
      "settings plus workbench back action",
    );
    // The workbench reaches its minimum first, then the left surface can shrink.
    await resizeWindow(initial.bounds.width + 324);
    await waitFor(
      async () => Math.abs((await panel.boundingBox()).width - 320) <= 1,
      "workbench minimum",
    );
    assert.ok(Math.abs((await leftSurface.boundingBox()).width - settingsWidth) <= 1);
    await resizeWindow(initial.bounds.width + 274);
    await waitFor(
      async () => Math.abs((await leftSurface.boundingBox()).width - (settingsWidth - 50)) <= 1,
      "left surface shrinks after workbench minimum",
    );
    await resizeWindow(900);
    await waitFor(
      async () => Math.abs((await leftSurface.boundingBox()).width - 568) <= 1,
      "combined window minimum",
    );
    const belowMinimum = await page.evaluate(async () => {
      const api = (await import("/tuffite.js")).window;
      try {
        await api.setBounds({ ...(await api.current()).bounds, width: 899 });
        return false;
      } catch {
        return true;
      }
    });
    assert.equal(belowMinimum, true, "Native bounds must reject widths below the combined minimum");
    await page.getByRole("button", { name: "Back to chat", exact: true }).click();
    await waitFor(
      async () => (await windowInfo()).bounds.width === 576,
      "back to chat removes workbench width",
    );
    assert.equal(await page.locator("[data-framework-left-surface]").count(), 0);
    assert.equal(await page.locator("[data-workbench-root]").count(), 0);
    await resizeWindow(700);
    await page
      .locator(".titlebar")
      .getByRole("button", { name: "Open setup", exact: true })
      .click();
    await page.getByRole("button", { name: "Show workbench", exact: true }).click();
    await waitFor(
      () => page.getByRole("button", { name: "Back to chat", exact: true }).isVisible(),
      "setup plus workbench back action",
    );
    await page.getByRole("button", { name: "Back to chat", exact: true }).click();
    await waitFor(
      async () => (await windowInfo()).bounds.width === 700,
      "setup back returns to original window width",
    );
    assert.equal(await page.locator(".onboarding-page-surface").count(), 0);
    assert.equal(await page.locator("[data-workbench-root]").count(), 0);
    await page.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
    await opening.click();
    await page.getByRole("option", { name: "Overlay", exact: true }).click();
    await page.reload();
    await page
      .locator(".titlebar")
      .getByRole("button", { name: "Settings", exact: true })
      .waitFor();
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("ovule:browser-use", { detail: { target: "https://example.com/" } }),
      ),
    );
    await page.locator("[data-explorer-preview]").waitFor();
    assert.equal((await windowInfo()).bounds.width, 700, "Overlay must not resize the window");
    assert.equal(await page.locator("[data-workbench-root]").count(), 0);
    console.log(
      "workbench_window=ok fixed_open_width_360=true native_expand=true resized_panel_hide=true stable_chat_frames=true native_resize_priority=true full_expand=true combined_minimum=true back_to_chat=true titlebar_divider=true overlay_preference_persisted=true",
    );
  } finally {
    await browser.close();
  }
});

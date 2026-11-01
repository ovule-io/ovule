import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright-core";
import { main, availablePort, port, waitFor, waitHttp } from "./runner.mjs";

await main("draft-tabs", async (c) => {
  await c.claimPackage();
  const server = http.createServer((_req, res) => {
    if (_req.url === "/overlay") {
      res.writeHead(302, { Location: `http://localhost:${server.address().port}/overlay-final` });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    const html =
      '<!doctype html><style>html,body{margin:0;background:#f8f9fa}aside{position:fixed;inset:0 auto 0 0;width:32%;background:#f8f9fa}main{margin-left:32%;background:white;min-height:300vh}header{position:sticky;top:0;background:#3478ef;height:80px}</style><title>Draft browser</title><aside>Fixed sidebar</aside><main><header>Sticky banner</header><input id="draft"></main><script>window.marker=crypto.randomUUID();setTimeout(()=>{const modal=document.createElement("div");modal.id="delayed-modal";modal.style="position:fixed;inset:0;background:rgb(0 0 0 / .35);backdrop-filter:blur(5px);display:grid;place-items:center";modal.innerHTML=\'<section style="background:white;border-radius:24px;padding:60px">Delayed modal</section>\';document.body.append(modal);setTimeout(()=>modal.remove(),800)},400)</script>';
    if (_req.url === "/overlay-final") {
      res.write(html.slice(0, html.indexOf("<script>")));
      setTimeout(() => res.end(html.slice(html.indexOf("<script>"))), 250);
    } else res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${server.address().port}/`;
  const number = await availablePort(port(c.opts.port, 9289));
  const app = c.launch(number);
  let browser;
  try {
    await waitHttp(`http://127.0.0.1:${number}/json/version`, app);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${number}`);
    const pages = () => browser.contexts().flatMap((context) => context.pages());
    const page = await waitFor(
      async () => {
        for (const candidate of pages())
          if (await candidate.locator(".titlebar").count()) return candidate;
      },
      "main titlebar",
      90000,
    );
    const closeSetup = page.getByRole("button", { name: "Close setup", exact: true });
    await closeSetup.waitFor();
    await closeSetup.click();
    await page.getByRole("button", { name: "New Conversation", exact: true }).click();
    const thread = await waitFor(
      () => pages().find((p) => new URL(p.url()).pathname === "/thread"),
      "thread surface",
    );
    const request = async (channel, payload) =>
      thread.evaluate(
        ({ channel, payload }) =>
          new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            const timer = setTimeout(() => {
              tuffite.removeEventListener("message", receive);
              reject(new Error(`Timeout: ${channel}`));
            }, 10000);
            const receive = (event) => {
              const data = event.data;
              if (data?.type !== "app-response" || data.requestId !== requestId) return;
              clearTimeout(timer);
              tuffite.removeEventListener("message", receive);
              if (data.error) reject(new Error(data.error));
              else resolve(data.result);
            };
            tuffite.addEventListener("message", receive);
            tuffite.postMessage(
              { type: "app-request", requestId, channel, payload },
              { targetOrigin: location.origin },
            );
          }),
        { channel, payload },
      );
    const add = thread.getByRole("button", { name: "Add tab", exact: true });
    assert.equal(await add.isEnabled(), true, "New Conversation permits Add tab");
    await add.click();
    await thread.getByRole("menuitem", { name: "Browser", exact: true }).click();
    await page.locator("[data-draft-id][data-tab-id]").first().waitFor();
    await page.getByRole("button", { name: "New Conversation", exact: true }).click();
    // Open a local page as well to verify native page identity.
    const { tabId } = await request("workbench.open", {
      kind: "browser",
      newInstance: true,
      target,
    });
    const row = page.locator(`[data-draft-id][data-tab-id="${tabId}"]`);
    await row.waitFor();
    const draftId = await row.getAttribute("data-draft-id");
    assert.equal(await page.locator("[data-workbench-root]").count(), 0);
    const guest = await waitFor(() => pages().find((p) => p.url() === target), "draft browser");
    await guest.waitForLoadState("load");
    await guest.waitForFunction(() => typeof window.marker === "string");
    await guest.evaluate(() => {
      document.querySelector("#draft").value = "preserve draft input";
    });
    assert.equal(await guest.locator("#draft").inputValue(), "preserve draft input");
    const marker = await guest.evaluate(() => window.marker);
    await page.getByRole("button", { name: "New Conversation", exact: true }).click();
    await add.waitFor();
    // Selecting a draft tab through the child toolbar must validate draft ownership.
    await request("tab.select", { tabId });
    await row.locator(".artifact-select").click();
    assert.equal(await guest.locator("#draft").inputValue(), "preserve draft input");
    await page.screenshot({ path: path.join(c.artifacts, "draft-tabs.png") });
    const overlayTarget = `${target}overlay`;
    const overlayPageUrl = `${target.replace("127.0.0.1", "localhost")}overlay-final`;
    const contrast = await page.addStyleTag({
      content: "[data-explorer-backdrop]{background:rgb(52,0,68)!important}",
    });
    const paintFrames = [];
    let captureStage = "opening";
    const paintSession = await page.context().newCDPSession(page);
    paintSession.on("Page.screencastFrame", (event) => {
      paintFrames.push({ stage: captureStage, data: event.data });
      void paintSession
        .send("Page.screencastFrameAck", { sessionId: event.sessionId })
        .catch(() => {});
    });
    await paintSession.send("Page.startScreencast", {
      format: "png",
      maxWidth: 992,
      maxHeight: 768,
      everyNthFrame: 1,
    });
    await page.evaluate(
      (target) =>
        window.dispatchEvent(new CustomEvent("ovule:browser-use", { detail: { target } })),
      overlayTarget,
    );
    const preview = page.locator("[data-explorer-preview]:not([data-explorer-tab])");
    await preview.waitFor();
    const overlayGuest = await waitFor(
      () => pages().find((p) => p.url() === overlayPageUrl),
      "overlay browser",
    );
    await overlayGuest.waitForFunction(() => typeof window.marker === "string");
    await page.waitForTimeout(150);
    captureStage = "delayed-modal";
    await overlayGuest.locator("#delayed-modal").waitFor();
    await page.waitForTimeout(300);
    await overlayGuest.locator("#delayed-modal").waitFor({ state: "detached" });
    const initialOverlayMarker = await overlayGuest.evaluate(() => window.marker);
    captureStage = "reload";
    await preview.locator("explorer").evaluate((element) => element.reload());
    await overlayGuest.waitForFunction(
      (previous) => typeof window.marker === "string" && window.marker !== previous,
      initialOverlayMarker,
    );
    await overlayGuest.locator("#delayed-modal").waitFor();
    await page.waitForTimeout(300);
    await overlayGuest.locator("#delayed-modal").waitFor({ state: "detached" });
    await paintSession.send("Page.stopScreencast");
    await paintSession.detach();
    // Verify that the alpha mask itself clips embedded content, independently
    // of border-radius and geometric clipping.
    const unclip = await page.addStyleTag({
      content:
        "[data-explorer-panel]{clip-path:none!important;overflow:visible!important;border-radius:0!important}",
    });
    const solidMask = await page.addStyleTag({
      content: "[data-explorer-panel]{mask-image:linear-gradient(white,white)!important}",
    });
    await page.waitForTimeout(250);
    paintFrames.push({
      stage: "solid-mask-control",
      data: (
        await page.screenshot({ path: path.join(c.artifacts, "solid-mask-control.png") })
      ).toString("base64"),
    });
    await solidMask.evaluate((element) => element.remove());
    await page.waitForTimeout(250);
    paintFrames.push({
      stage: "alpha-mask",
      data: (
        await page.screenshot({ path: path.join(c.artifacts, "alpha-mask-only.png") })
      ).toString("base64"),
    });
    const overlayMarker = await overlayGuest.evaluate(() => window.marker);
    const frame = await preview.boundingBox();
    await page.screenshot({ path: path.join(c.artifacts, "overlay-round-corners.png") });
    const paintedCorners = await page.evaluate(
      async ({ frames, frame }) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        const samples = [];
        for (const { stage, data: base64 } of frames) {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          canvas.width = image.width;
          canvas.height = image.height;
          context.drawImage(image, 0, 0);
          const scale = image.width / innerWidth;
          const pixel = (x, y) =>
            Array.from(
              context.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data,
            );
          const outside = pixel(frame.x - 4, frame.y + frame.height - 1);
          // Ignore frames recorded before the overlay's backdrop appeared.
          if (outside[0] - outside[1] < 15 || outside[2] - outside[0] < 10) continue;
          samples.push({
            stage,
            outside,
            corners: [
              pixel(frame.x + 1, frame.y + frame.height - 1),
              pixel(frame.x + frame.width - 1, frame.y + frame.height - 1),
            ],
          });
        }
        return samples;
      },
      { frames: paintFrames, frame },
    );
    assert.ok(
      paintedCorners.length >= 3,
      "Observe multiple frames during redirect, first paint and reload",
    );
    for (const stage of ["opening", "delayed-modal", "reload", "alpha-mask"])
      assert.ok(
        paintedCorners.some((sample) => sample.stage === stage),
        `Observe ${stage} paint frames`,
      );
    assert.ok(
      paintedCorners.some(
        ({ stage, outside, corners }) =>
          stage === "solid-mask-control" &&
          corners.some((pixel) =>
            pixel.slice(0, 3).some((channel, index) => Math.abs(channel - outside[index]) > 10),
          ),
      ),
      "Negative control: a solid rectangular mask exposes the unclipped corner",
    );
    for (const { outside, corners } of paintedCorners.filter(
      ({ stage }) => stage !== "solid-mask-control",
    ))
      for (const pixel of corners) {
        assert.ok(
          pixel.slice(0, 3).every((channel, index) => Math.abs(channel - outside[index]) <= 6) &&
            pixel[3] === 255,
          `Overlay corner must expose the backdrop in every frame, received ${pixel}`,
        );
      }
    console.log(`round_corner_painted_frames=${paintedCorners.length}`);
    await unclip.evaluate((element) => element.remove());
    await contrast.evaluate((element) => element.remove());
    const promote = preview.getByRole("button", { name: "Open in sidebar", exact: true });
    assert.equal(await promote.isEnabled(), true, "Visible draft chat accepts sidebar transfers");
    await promote.click();
    await preview.waitFor({ state: "detached" });
    assert.equal(
      await overlayGuest.evaluate(() => window.marker),
      overlayMarker,
      "Promotion preserves the native page",
    );
    assert.equal(await page.locator(`[data-draft-id="${draftId}"][data-tab-id]`).count(), 3);
    // Create a real thread without invoking an external model, then use the same commit bridge as first send.
    const createdId = await page.evaluate(async () => {
      const api = (await import("/shell_api.js")).workspace;
      const before = new Set((await api.snapshot()).threads.map((t) => t.id));
      const after = await api.createThread({});
      return after.threads.find((t) => !before.has(t.id))?.id;
    });
    assert.ok(createdId);
    await request("workspace.refresh", {});
    await request("thread.bindDraft", { draftId, threadId: createdId });
    await request("thread.select", { threadId: createdId });
    const migrated = page.locator(`[data-thread-id="${createdId}"][data-tab-id="${tabId}"]`);
    await migrated.waitFor();
    assert.equal(await row.count(), 0, "Draft row moves under its committed thread");
    await migrated.locator(".artifact-select").click();
    assert.equal(await guest.evaluate(() => window.marker), marker);
    assert.equal(await guest.locator("#draft").inputValue(), "preserve draft input");
    await page.screenshot({ path: path.join(c.artifacts, "committed-tabs.png") });
    for (const name of ["Settings", "Open setup"]) {
      await page.locator(".titlebar").getByRole("button", { name, exact: true }).click();
      await page.evaluate(
        (target) =>
          window.dispatchEvent(new CustomEvent("ovule:browser-use", { detail: { target } })),
        target,
      );
      const overlay = page.locator("[data-explorer-preview]:not([data-explorer-tab])");
      await overlay.waitFor();
      assert.equal(
        await overlay.getByRole("button", { name: "Open in sidebar", exact: true }).isDisabled(),
        true,
        `${name} has no sidebar target`,
      );
      await page.screenshot({
        path: path.join(c.artifacts, `${name === "Settings" ? "settings" : "setup"}-overlay.png`),
      });
      await overlay.getByRole("button", { name: "Close", exact: true }).click();
      await page
        .locator(".titlebar")
        .getByRole("button", {
          name: name === "Settings" ? "Settings" : "Close setup",
          exact: true,
        })
        .click();
    }
    console.log(
      "draft_tabs=ok add_enabled=true sidebar_draft=true stable_page_on_commit=true settings_setup_sidebar_disabled=true round_corner_pixels=true",
    );
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

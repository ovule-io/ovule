import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(tmpdir(), "ovule-control-feedback-"));
let browser;
let server;
try {
  execFileSync(
    "bun",
    ["build", "./packages/ovule-ui/src/control-feedback.ts", "--outdir", temporary],
    { cwd: desktop },
  );
  server = createServer(async (request, response) => {
    const filename =
      request.url === "/control-feedback.js"
        ? "control-feedback.js"
        : request.url === "/control-feedback.css"
          ? "control-feedback.css"
          : undefined;
    if (filename) {
      response.setHeader(
        "Content-Type",
        filename.endsWith("css") ? "text/css" : "application/javascript",
      );
      response.end(await readFile(path.join(temporary, filename)));
    } else
      response.end(`<!doctype html><link rel="stylesheet" href="/control-feedback.css"><style>
      body{margin:0;background:#17171d}.test-surface{position:relative}#surface{width:600px;height:360px;margin:30px;background:#fafafa}button{position:absolute;left:180px;top:100px;width:100px;height:40px}
      </style><div id="surface" class="test-surface"><button>Input target</button></div><script type="module">
      import {installControlFeedback} from '/control-feedback.js';
      window.feedback=installControlFeedback(document.querySelector('#surface'));
      window.clicks=0;document.querySelector('button').onclick=()=>window.clicks++;
      </script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 660, height: 420 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.feedback);
  await page.evaluate(() => window.feedback.pulse({ x: 230, y: 120, pressed: true }));
  assert.equal(await page.locator(".ovule-control-pointer").getAttribute("data-pressed"), "true");
  await page.mouse.click(260, 150);
  assert.equal(
    await page.evaluate(() => window.clicks),
    1,
    "feedback must not intercept real input",
  );
  await page.evaluate(() => window.feedback.pulse({ x: 250, y: 130 }));
  assert.equal(
    await page.locator(".ovule-control-pointer").getAttribute("data-pressed"),
    "true",
    "movement preserves drag feedback",
  );
  await page.evaluate(() => window.feedback.pulse({ x: -5, y: 800, pressed: false }));
  assert.deepEqual(
    await page
      .locator(".ovule-control-pointer")
      .evaluate((node) => [node.style.left, node.style.top]),
    ["0px", "360px"],
  );
  await page.waitForFunction(
    () => !document.querySelector(".ovule-control-feedback").hasAttribute("data-active"),
  );
  await page.evaluate(() => window.feedback.pulse({ x: 230, y: 120, pressed: false }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".ovule-control-feedback")
      .evaluate((node) => getComputedStyle(node).transitionDuration),
    "0s",
  );
  // Read actual composited pixels: computed border-radius alone cannot catch
  // square gradient corners or a halo escaping a rounded viewport.
  const pixels = async () => {
    const png = (await page.screenshot()).toString("base64");
    return page.evaluate(async (encoded) => {
      const bitmap = await createImageBitmap(
        await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      context.drawImage(bitmap, 0, 0);
      return [
        [31, 31],
        [628, 31],
        [31, 388],
        [628, 388],
        [330, 30],
      ].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
    }, png);
  };
  for (const [radius, masked] of [
    ["12px", false],
    ["0px 0px 12px 12px", false],
    ["0px 0px 12px 12px", true],
    ["0px 0px 20px 20px", true],
  ]) {
    await page.evaluate(
      ({ value, masked }) => {
        window.feedback.clear();
        const surface = document.querySelector("#surface");
        surface.classList.toggle("ovule-control-viewport", masked);
        // Simulate a React className update dropping an imperative anchor.
        surface.classList.toggle("test-surface", !masked);
        surface.style.borderRadius = masked ? "" : value;
        surface.style.setProperty(
          "--ovule-control-surface-radius",
          value.includes("20px") ? "20px" : "12px",
        );
      },
      { value: radius, masked },
    );
    assert.equal(
      await page
        .locator(".ovule-control-feedback")
        .evaluate((el) => getComputedStyle(el).borderBottomLeftRadius),
      radius.includes("20px") ? "20px" : "12px",
    );
    if (masked)
      assert.notEqual(
        await page.locator("#surface").evaluate((el) => getComputedStyle(el).maskImage),
        "none",
      );
    assert.deepEqual(
      await page.locator(".ovule-control-feedback").boundingBox(),
      await page.locator("#surface").boundingBox(),
      "Feedback must remain anchored after host class replacement",
    );
    const baseline = await pixels();
    for (const [index, x, y] of [
      [0, 0, 0],
      [1, 600, 0],
      [2, 0, 360],
      [3, 600, 360],
    ]) {
      await page.evaluate(({ x, y }) => window.feedback.pulse({ x, y }), { x, y });
      const active = await pixels();
      if (radius === "12px" || index >= 2)
        assert.deepEqual(
          active[index],
          baseline[index],
          `halo must respect ${radius} corner ${index}`,
        );
      assert.notDeepEqual(active[4], baseline[4], "edge feedback must remain visible");
    }
  }
  if (process.env.OVULE_FEEDBACK_SCREENSHOT)
    await page.screenshot({ path: process.env.OVULE_FEEDBACK_SCREENSHOT });
  await page.evaluate(() => {
    window.feedback.dispose();
    window.feedback.pulse({ x: 20, y: 20 });
  });
  assert.equal(
    await page.locator(".ovule-control-feedback").count(),
    0,
    "dispose releases timers and DOM",
  );
  console.log(
    "control_feedback_smoke=ok input_passthrough drag clamp expiry reduced_motion rounded_pixels asymmetric_corners dispose",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(temporary, { recursive: true, force: true });
}

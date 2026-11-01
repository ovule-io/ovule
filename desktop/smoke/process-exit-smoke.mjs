import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_EXIT_CDP_PORT);
if (!Number.isInteger(port) || port <= 0) throw new Error("OVULE_EXIT_CDP_PORT is required");

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  let app;
  const deadline = Date.now() + 30_000;
  while (!app && Date.now() < deadline) {
    for (const page of browser.contexts().flatMap((context) => context.pages())) {
      if (
        await page
          .evaluate(async () => typeof (await import("/tuffite.js")).window.close === "function")
          .catch(() => false)
      ) {
        app = page;
        break;
      }
    }
    if (!app) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!app) throw new Error("Ovule application page was not found");
  await app
    .evaluate(async () => (await import("/tuffite.js")).window.close())
    .catch((error) => {
      if (!/closed|destroyed|Target/i.test(String(error))) throw error;
    });
  process.stdout.write("process_exit_close_requested=ok\n");
} finally {
  await browser.close().catch(() => undefined);
}

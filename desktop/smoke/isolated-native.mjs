import { chromium } from "playwright-core";
import { main, availablePort, waitHttp, waitFor } from "./runner.mjs";
import { smokeIsolatedUi } from "./isolated-ui.mjs";

await main("isolated-native", async (context) => {
  await context.claimPackage();
  const port = await availablePort(0);
  const application = context.launch(port);
  await waitHttp(`http://127.0.0.1:${port}/json/version`, application, undefined, 120000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  try {
    const page = await waitFor(
      () =>
        browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page.url().startsWith("ovule://-/main")),
      "Ovule application page",
    );
    await page.waitForFunction(
      () => typeof globalThis.tuffite?.isolated?.createWorld === "function",
    );
    await smokeIsolatedUi(page);
  } finally {
    await browser.close();
  }
});

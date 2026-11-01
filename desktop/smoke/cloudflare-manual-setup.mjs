import { chromium } from "playwright-core";
import { waitFor } from "./runner.mjs";

const browser = await chromium.connectOverCDP(
  `http://127.0.0.1:${process.env.OVULE_E2E_HOST_PORT}`,
);
try {
  const page = await waitFor(async () => {
    for (const candidate of browser.contexts().flatMap((context) => context.pages())) {
      if (
        await candidate
          .evaluate(
            async () =>
              typeof (await import("/shell_api.js")).workspace.createThread === "function",
          )
          .catch(() => false)
      )
        return candidate;
    }
  }, "isolated Host ShellAPI");
  const id = await page.evaluate(async () => {
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
    const catalog = await api.extensionCatalog();
    if (
      !catalog.slashCommands.some((command) => command.id === "cloudflare") ||
      !catalog.messageBlocks.some((block) => block.kind === "cloudflare-connectivity")
    )
      throw new Error(
        "This package does not include Cloudflare setup. Build a current native package before requesting authorization.",
      );
    const snapshot = await api.createThread({});
    const id = snapshot.selectedThreadId ?? snapshot.threads.at(-1).id;
    await api.sendMessage(id, "/cloudflare");
    return id;
  });
  const url = new URL("/thread", page.url());
  url.searchParams.set("thread", id);
  await page.goto(url.href);
  await page.bringToFront();
  await page
    .locator('[data-message-block-kind="cloudflare-connectivity"]:not([data-extension-id])')
    .waitFor();
  console.log("cloudflare_manual_setup_ready=true");
  await waitFor(
    async () => {
      const configured = await page.evaluate(async () => {
        const outcome = await (
          await import("/shell_api.js")
        ).extensions.runExtensionAction({
          extensionId: "io.ovule.connectivity.cloudflare",
          actionId: "status",
        });
        if (!outcome?.dataJson) throw new Error("Host returned no Cloudflare setup status");
        return JSON.parse(outcome.dataJson).phase === "configured";
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Inspect only the public setup state; credentials stay in SecretStore.
      return configured;
    },
    "manual Cloudflare login and secure configuration",
    Number(process.env.OVULE_E2E_SETUP_TIMEOUT_MS ?? 600000),
  );
  console.log("cloudflare_manual_setup=ok secure_configuration=true");
} finally {
  await browser.close();
}

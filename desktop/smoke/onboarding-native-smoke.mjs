import { clickClosed, closedNodes } from "./isolated-dom.mjs";
import assert from "node:assert/strict";

/** Exercises real views in an isolated native profile with a fake CLI and provider credentials. */
export async function smokeOnboarding(app, artifacts) {
  app.setDefaultTimeout(15_000);
  const close = app.locator(".titlebar").getByRole("button", { name: "Close setup", exact: true });
  if (await close.count()) {
    await close.click();
    await app.locator(".onboarding-page-surface").waitFor({ state: "detached" });
  }
  const open = () =>
    app.locator(".titlebar").getByRole("button", { name: "Open setup", exact: true }).click();
  const surface = app.locator(".onboarding-page-surface");
  const continueButton = surface.getByRole("button", { name: "Continue", exact: true });
  const waitEnabled = async (button) => {
    for (let i = 0; i < 100; i++) {
      if (await button.isEnabled()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail("Continue did not become enabled");
  };
  await open();
  const codexToggle = surface.getByRole("checkbox", { name: "Configure Codex", exact: true });
  if (!(await codexToggle.isChecked())) await codexToggle.click();
  for (const toggle of await surface.getByRole("checkbox").all()) {
    if (
      (await toggle.getAttribute("aria-label")) !== "Configure Codex" &&
      (await toggle.isChecked())
    )
      await toggle.click();
  }
  assert.equal(
    await surface.getByRole("combobox").count(),
    0,
    "Codex has no provider/model controls",
  );
  assert.equal(await continueButton.isEnabled(), false);
  await clickClosed(app, { extensionId: "io.ovule.agent.codex" }, "Sign in with ChatGPT");
  // Ordinary links open in the Explorer preview; exercise promotion before
  // asserting that the authorization redirect stays in the Workbench surface.
  await app.locator("[data-explorer-preview]").waitFor();
  await app.getByRole("button", { name: "Open in workbench", exact: true }).click();
  await app.locator("[data-explorer-preview]").waitFor({ state: "detached" });
  try {
    await app.locator(".workbench").waitFor();
  } catch (error) {
    const messages = [];
    await closedNodes(app, { extensionId: "io.ovule.agent.codex" }, (node) => {
      if (node.tag === "p" || node.attributes.role === "alert") messages.push(node.text.trim());
      return false;
    });
    console.log("onboarding_auth_diagnostics=" + JSON.stringify(messages));
    throw error;
  }
  await app.waitForFunction(async () =>
    [...document.querySelectorAll('[data-placement="workbench"] explorer')].some((element) =>
      element.src.includes("/authoriz"),
    ),
  );
  await waitEnabled(continueButton);
  assert.equal(
    await app.locator("[data-explorer-preview]").count(),
    0,
    "OAuth redirects remain in Workbench",
  );
  await continueButton.click();
  await surface.waitFor({ state: "detached" });
  assert.equal(
    await app.evaluate(
      async () => (await (await import("/shell_api.js")).setup.onboardingStatus()).defaultAgentId,
    ),
    "codex",
  );
  await open();
  await surface.getByRole("checkbox", { name: "Configure Ovule", exact: true }).click();
  const configure = async (name) => {
    const card = surface.getByRole("article", { name, exact: true });
    await card.getByRole("combobox", { name: "Model provider", exact: true }).click();
    await app.getByRole("option", { name: "DeepSeek", exact: true }).click();
    await card.getByRole("combobox", { name: "Model", exact: true }).click();
    await app.getByRole("option", { name: /DeepSeek Flash/ }).click();
  };
  await configure("Ovule");
  const firstProfile = surface.getByRole("article", { name: "Ovule", exact: true });
  await firstProfile.evaluate((element) => {
    element.id = "onboarding-first-profile-smoke";
  });
  const profileScope = { id: "onboarding-first-profile-smoke" };
  const keyInputs = () =>
    closedNodes(
      app,
      profileScope,
      (node) => node.tag === "input" && node.attributes["aria-label"] === "DeepSeek API key",
    );
  assert.equal((await keyInputs()).length, 0);
  await clickClosed(app, profileScope, "Update API key");
  assert.equal((await keyInputs()).length, 1);
  await clickClosed(app, profileScope, "Hide API key");
  assert.equal((await keyInputs()).length, 0);
  await waitEnabled(continueButton);
  await surface.getByRole("button", { name: "Add Ovule profile", exact: true }).click();
  assert.equal(await continueButton.isEnabled(), false, "new profile needs its own model");
  await configure("Ovule 2");
  await surface.getByRole("button", { name: "Refresh discovery", exact: true }).click();
  await waitEnabled(continueButton);
  const card = surface.getByRole("article", { name: "Ovule 2", exact: true });
  await card.getByRole("button", { name: "Make default", exact: true }).click();
  const alignment = await surface.locator("footer").evaluate(async (footer) => {
    const last = footer.lastElementChild.getBoundingClientRect();
    return Math.abs(footer.getBoundingClientRect().right - last.right);
  });
  assert.ok(alignment < 2, `footer right alignment: ${alignment}`);
  await app.screenshot({ path: `${artifacts}/onboarding-agents.png` });
  await continueButton.click();
  await surface.waitFor({ state: "detached" });
  const input = await app.evaluate(async () =>
    (await import("/shell_api.js")).setup.onboardingStatus(),
  );
  assert.equal(input.defaultAgentId, "ovule-2");
  assert.equal(input.agents.filter((agent) => agent.driver === "ovule").length, 2);
  assert.ok(
    input.agents
      .filter((agent) => agent.driver === "ovule")
      .every((agent) => agent.modelId === "onboarding-deepseek-deepseek-flash"),
  );
}

import { setThemeMode } from "./settings-preferences.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const workspace = process.env.OVULE_CDP_WORKSPACE;
const port = Number(process.env.OVULE_CDP_PORT ?? "9227");
if (!workspace) throw new Error("OVULE_CDP_WORKSPACE is required");
const outsideOfficePdf = process.env.OVULE_CDP_OUTSIDE_PDF;
if (!outsideOfficePdf) throw new Error("OVULE_CDP_OUTSIDE_PDF is required");

const createMinimalPdf = () => {
  const content = "BT /F1 18 Tf 40 100 Td (OVULE PDF CDP OK) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
};

const skillDir = path.join(workspace, ".agents", "skills", "cdp-check");
await fs.mkdir(skillDir, { recursive: true });
await fs.writeFile(
  path.join(skillDir, "SKILL.md"),
  "---\nname: cdp-check\ndescription: Verify the Ovule CDP production flow.\n---\nReturn concise, deterministic results.\n",
);
await fs.writeFile(
  path.join(workspace, "preview.html"),
  "<!doctype html><html><head><link rel='stylesheet' href='https://example.com/unsafe.css'></head><body><h1 onclick=\"document.body.dataset.eventExecuted='yes'\">CDP Explorer Preview</h1><iframe src='https://example.com/'></iframe><object data='https://example.com/'></object><embed src='https://example.com/'><script>document.body.dataset.scriptExecuted='yes'<\/script></body></html>",
);
await fs.writeFile(path.join(workspace, "report.md"), "# CDP report\n\nInitial content.\n");
await fs.writeFile(path.join(workspace, "report.csv"), "Item,Value\nOvule,1\nOffice extension,2\n");
await fs.writeFile(outsideOfficePdf, createMinimalPdf());
const canonicalOutsideOfficePdf = await fs.realpath(outsideOfficePdf);
const outsideBrowserFile = path.join(path.dirname(workspace), "outside-browser.html");
await fs.writeFile(
  outsideBrowserFile,
  "<!doctype html><meta charset='utf-8'><title>Outside browser file</title><h1>FILE_BROWSER_CDP_OK</h1>",
);
const outsideBrowserUrl = pathToFileURL(outsideBrowserFile).href;
const canonicalWorkspace = await fs.realpath(workspace);

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const log = (value) => process.stdout.write(`cdp_step=${value}\n`);
const snapshot = async (page) =>
  page.evaluate(async () => (await import("/shell_api.js")).workspace.snapshot());
const browserDiagnostics = [];
const diagnosedPages = new WeakSet();
const attachPageDiagnostics = (page, label) => {
  if (diagnosedPages.has(page)) return;
  diagnosedPages.add(page);
  page.on("console", (message) => {
    browserDiagnostics.push(`${label}:console:${message.type()}:${message.text()}`);
  });
  page.on("pageerror", (error) => {
    browserDiagnostics.push(`${label}:pageerror:${error.stack ?? error.message}`);
  });
};
const waitFor = async (probe, description, timeout = 180_000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`);
};
const cdpTargets = async () => {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  assert.equal(response.ok, true, `CDP target list failed with HTTP ${response.status}`);
  return response.json();
};
const verifyBundledDevTools = async () => {
  const origin = `http://127.0.0.1:${port}`;
  const discovery = await fetch(`${origin}/`);
  assert.equal(discovery.ok, true, `DevTools discovery failed with HTTP ${discovery.status}`);
  assert.match(await discovery.text(), /Tuffite DevTools/);
  const targets = await cdpTargets();
  const target = targets.find((candidate) => candidate.url?.startsWith("ovule:"));
  assert.ok(target, "Ovule DevTools target was not listed");
  assert.ok(target.devtoolsFrontendUrl, "DevTools target did not expose a frontend URL");
  assert.match(target.devtoolsFrontendUrl, /^\/devtools\/inspector\.html\?/);
  const inspector = await fetch(new URL(target.devtoolsFrontendUrl, origin));
  assert.equal(inspector.ok, true, `DevTools inspector failed with HTTP ${inspector.status}`);
  const html = await inspector.text();
  const resources = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  assert.ok(resources.length > 0, "DevTools inspector HTML did not reference bundled resources");
  for (const resource of resources) {
    const response = await fetch(new URL(resource, new URL(target.devtoolsFrontendUrl, origin)));
    assert.equal(
      response.ok,
      true,
      `DevTools resource ${resource} failed with HTTP ${response.status}`,
    );
  }
  log(`devtools discovery=true inspector=true resources=${resources.length}`);
};
const evaluateTarget = async (webSocketDebuggerUrl, expression) => {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  try {
    const id = 1;
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out evaluating Explorer target")),
        10_000,
      );
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        clearTimeout(timeout);
        resolve(message);
      });
    });
    if (response.error) throw new Error(`Explorer CDP error: ${JSON.stringify(response.error)}`);
    if (response.result?.exceptionDetails)
      throw new Error(
        `Explorer evaluation failed: ${JSON.stringify(response.result.exceptionDetails)}`,
      );
    return response.result?.result?.value;
  } finally {
    socket.close();
  }
};
const selectRadix = async (page, label, option) => {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const normalizeWindowsPath = (value) => value.replace(/^\\\\\?\\/, "").toLowerCase();
const threadPageFor = async (browser, threadId) => {
  const threadPage = await waitFor(
    async () => {
      const candidates = browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((candidate) => {
          if (candidate.isClosed() || !isOvuleResource(candidate.url(), "thread.html"))
            return false;
          if (threadId === undefined) return true;
          return new URL(candidate.url()).searchParams.get("thread") === threadId;
        })
        .reverse();
      for (const candidate of candidates) {
        if (
          await candidate
            .getByRole("textbox", { name: "Message" })
            .isVisible({ timeout: 250 })
            .catch(() => false)
        )
          return candidate;
      }
      return undefined;
    },
    `Thread Explorer target${threadId === undefined ? "" : ` for ${threadId || "new Thread"}`}`,
    30_000,
  );
  threadPage.setDefaultTimeout(30_000);
  attachPageDiagnostics(threadPage, `thread:${threadId ?? "any"}`);
  return threadPage;
};
const panePageFor = async (browser, kind, threadId, target) => {
  const panePage = await waitFor(
    async () => {
      const candidates = browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((candidate) => {
          if (candidate.isClosed() || !isOvuleResource(candidate.url(), "pane.html")) return false;
          const query = new URL(candidate.url()).searchParams;
          return (
            query.get("kind") === kind &&
            (!threadId || query.get("thread") === threadId) &&
            (!target ||
              normalizeWindowsPath(query.get("target") ?? "") === normalizeWindowsPath(target))
          );
        })
        .reverse();
      for (const candidate of candidates) {
        if (
          await candidate
            .locator("body")
            .isVisible({ timeout: 250 })
            .catch(() => false)
        )
          return candidate;
      }
      return undefined;
    },
    `${kind} Pane target`,
    30_000,
  );
  panePage.setDefaultTimeout(30_000);
  attachPageDiagnostics(panePage, `pane:${kind}`);
  return panePage;
};
const installStreamingObserver = async (threadPage, reset = false) => {
  await threadPage.evaluate(async (shouldReset) => {
    const storageKey = "ovule.cdp.streamingFrames";
    if (shouldReset) localStorage.setItem(storageKey, "[]");
    if (window.__ovuleCdpStreamingObserver) return;
    window.__ovuleCdpStreamingObserver = new MutationObserver(() => {
      const card = document.querySelector(
        '[data-message-role="assistant"][data-message-status="streaming"]',
      );
      const text = card?.querySelector(".message-markdown")?.textContent ?? "";
      if (!text) return;
      const frames = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (frames.at(-1) !== text) {
        frames.push(text);
        localStorage.setItem(storageKey, JSON.stringify(frames.slice(-100)));
      }
    });
    window.__ovuleCdpStreamingObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, reset);
};
try {
  await verifyBundledDevTools();
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => isOvuleResource(candidate.url(), "index.html"));
  assert.ok(page, "Ovule app target was not exposed over CDP");
  attachPageDiagnostics(page, "root");
  page.setDefaultTimeout(30_000);
  await page.waitForFunction(
    async () => typeof (await import("/shell_api.js")).extensions.extensionCatalog === "function",
    undefined,
    { timeout: 30_000 },
  );
  const thirdPartyExtensions = [
    process.env.OVULE_CDP_SAMPLE_EXTENSION,
    process.env.OVULE_CDP_CHANNEL_EXTENSION,
  ];
  assert.ok(
    thirdPartyExtensions.every(Boolean),
    "Sample ACP and Channel third-party package paths must be provided",
  );
  for (const source of thirdPartyExtensions) {
    await page.evaluate(
      async (extensionPath) =>
        (await import("/shell_api.js")).setup.installExtension(extensionPath),
      source,
    );
  }
  await page.evaluate(
    async (extensionPath) => (await import("/shell_api.js")).setup.installExtension(extensionPath),
    process.env.OVULE_CDP_CHANNEL_SOURCE ?? process.env.OVULE_CDP_CHANNEL_EXTENSION,
  );
  const extensionCatalog = await page.evaluate(async () =>
    (await import("/shell_api.js")).extensions.extensionCatalog(),
  );
  assert.deepEqual(
    extensionCatalog.extensions
      .filter((item) => ["io.ovule.agent.sample", "io.ovule.channel.sample"].includes(item.id))
      .map((item) => ({ id: item.id, source: item.source, removable: item.removable }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    [
      { id: "io.ovule.agent.sample", source: "installed", removable: true },
      { id: "io.ovule.channel.sample", source: "installed", removable: true },
    ],
  );
  assert.ok(
    extensionCatalog.capabilities.some((item) => item.id === "visualization.echarts"),
    "ECharts capability must be present in the Rust extension catalog",
  );
  assert.ok(
    extensionCatalog.capabilities.some((item) => item.id === "drawing.excalidraw"),
    "Excalidraw capability must be present in the Rust extension catalog",
  );
  assert.deepEqual(extensionCatalog.messageBlocks.map((item) => item.kind).sort(), [
    "echarts",
    "excalidraw",
    "human-handoff",
    "channel-setup",
  ]);
  assert.deepEqual(extensionCatalog.agents.map((item) => item.id).sort(), ["codex", "sample"]);
  assert.deepEqual(extensionCatalog.models.map((item) => item.id).sort(), [
    "deepseek-flash",
    "deepseek-v4-pro",
  ]);
  assert.deepEqual(extensionCatalog.computerUse, [
    {
      extensionId: "io.ovule.host",
      id: "computer-use",
      label: "CRD Computer Use",
      provider: "crd",
      toolchainId: undefined,
      capabilities: ["desktop.snapshot", "desktop.input", "clipboard.write"],
    },
  ]);
  assert.deepEqual(
    extensionCatalog.fileEditors.flatMap((editor) => editor.extensions),
    ["docx", "dotx", "xlsx", "csv", "xlsm", "pptx", "pptm", "ppsx", "pdf"],
  );
  assert.ok(
    extensionCatalog.fileEditors.every((editor) => editor.threadPresentation === "card"),
    "Office File Editors must contribute their Thread presentation",
  );
  assert.deepEqual(
    extensionCatalog.fileEditors
      .filter((editor) => editor.mode === "editable")
      .flatMap((editor) => editor.extensions),
    ["xlsx", "csv"],
  );
  const extensionFixture = process.env.OVULE_CDP_EXTENSION_FIXTURE;
  assert.ok(extensionFixture, "Extension install fixture path must be provided");
  await page.evaluate(
    async (source) => (await import("/shell_api.js")).setup.installExtension(source),
    extensionFixture,
  );
  const installedExtensionCatalog = await page.evaluate(async () =>
    (await import("/shell_api.js")).extensions.extensionCatalog(),
  );
  assert.ok(
    installedExtensionCatalog.capabilities.some((item) => item.id === "smoke.installed"),
    "Settings installation must activate a validated third-party Extension package",
  );
  await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.setExtensionEnabled("io.ovule.smoke.installed", false),
  );
  let lifecycleCatalog = await page.evaluate(async () =>
    (await import("/shell_api.js")).extensions.extensionCatalog(),
  );
  assert.equal(
    lifecycleCatalog.extensions.find((item) => item.id === "io.ovule.smoke.installed")?.enabled,
    false,
  );
  assert.ok(!lifecycleCatalog.capabilities.some((item) => item.id === "smoke.installed"));
  await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.setExtensionEnabled("io.ovule.smoke.installed", true),
  );
  lifecycleCatalog = await page.evaluate(async () =>
    (await import("/shell_api.js")).extensions.extensionCatalog(),
  );
  assert.ok(lifecycleCatalog.capabilities.some((item) => item.id === "smoke.installed"));
  await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.removeExtension("io.ovule.smoke.installed"),
  );
  lifecycleCatalog = await page.evaluate(async () =>
    (await import("/shell_api.js")).extensions.extensionCatalog(),
  );
  assert.ok(!lifecycleCatalog.extensions.some((item) => item.id === "io.ovule.smoke.installed"));
  const extensionToolchains = await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.toolchainStatus(),
  );
  for (const id of ["codex", "codex-acp", "sample", "channel-cli"]) {
    assert.ok(
      extensionToolchains.some((item) => item.id === id),
      `installed Extension Toolchain contribution is missing: ${id}`,
    );
  }
  assert.ok(
    !extensionToolchains.some((item) => item.kind === "computer-use"),
    "CRD Computer Use must not install an external Toolchain",
  );
  assert.ok(
    extensionCatalog.models
      .filter((item) => item.provider === "deepseek")
      .every(
        (item) =>
          item.extensionId === "io.ovule.provider.deepseek" && item.agentIds.includes("ovule"),
      ),
    "DeepSeek must contribute Ovule provider models, not an AgentDriver",
  );
  log("onboarding");
  await page.getByRole("heading", { name: "Configure your Agents" }).waitFor();
  log("onboarding_dismiss");
  const surfaces = await page.evaluate(async () => {
    const color = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`missing surface: ${selector}`);
      return getComputedStyle(element).backgroundColor;
    };
    return {
      shell: color(".app-shell"),
      titlebar: color(".titlebar"),
      contents: color(".framework"),
    };
  });
  assert.ok(
    surfaces.titlebar === "rgba(0, 0, 0, 0)" || surfaces.titlebar === surfaces.shell,
    JSON.stringify(surfaces),
  );
  assert.ok(
    surfaces.contents === "rgba(0, 0, 0, 0)" || isNearWhite(surfaces.contents),
    JSON.stringify(surfaces),
  );
  assert.notEqual(surfaces.shell, "rgba(0, 0, 0, 0)", JSON.stringify(surfaces));
  const onboardingPlacement = await page.evaluate(async () => {
    const setup = document.querySelector(".onboarding-page-surface")?.parentElement;
    const chat = document.querySelector(".chat");
    if (!setup || !chat) throw new Error("missing setup or retained Chat surface");
    return {
      setupLeft: Math.round(setup.getBoundingClientRect().left),
      chatLeft: Math.round(chat.getBoundingClientRect().left),
      setupColumn: getComputedStyle(setup).gridColumnStart,
    };
  });
  assert.equal(onboardingPlacement.setupLeft, onboardingPlacement.chatLeft);
  assert.ok(
    onboardingPlacement.setupColumn === "1" || onboardingPlacement.setupColumn === "auto",
    JSON.stringify(onboardingPlacement),
  );
  await page.locator(".titlebar").getByRole("button", { name: "Close setup" }).click();
  await page.getByRole("heading", { name: "Configure your Agents" }).waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(async () => localStorage.getItem("ovule.onboarding.dismissed")),
    "true",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  assert.equal(
    await page.getByRole("heading", { name: "Configure your Agents" }).count(),
    0,
    "dismissed onboarding must stay closed across reload",
  );
  const setupButton = page.locator(".titlebar").getByRole("button", { name: "Open setup" });
  await setupButton.click();
  const setupHeading = page.getByRole("heading", { name: "Configure your Agents" });
  await setupHeading.waitFor();
  if (process.env.OVULE_CDP_SCOPE === "onboarding") {
    const onboarding = page.locator(".onboarding-page");
    assert.equal(await onboarding.getByRole("tab").count(), 0);
    await onboarding.getByRole("heading", { name: "Agents", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: /Channel|Channel/ }).count(),
      0,
      "global onboarding must not expose extension-specific Channel controls",
    );
    const extensionCatalog = await page.evaluate(async () =>
      (await import("/shell_api.js")).extensions.extensionCatalog(),
    );
    assert.ok(extensionCatalog.slashCommands.some((command) => command.id === "channel"));
    const artifactRoot = process.env.OVULE_CDP_ARTIFACTS ?? path.join(workspace, "cdp-artifacts");
    await fs.mkdir(artifactRoot, { recursive: true });
    await page.screenshot({ path: path.join(artifactRoot, "onboarding-reload.png") });
    process.stdout.write(
      `native_cdp_onboarding=ok renderer_alive=true channel_global_controls=false channel_extension_command=true screenshot=${path.join(artifactRoot, "onboarding-reload.png")}\n`,
    );
    await browser.close();
    process.exit(0);
  }
  log("onboarding_configure");
  assert.equal(
    await page.getByRole("textbox", { name: "Workspace", exact: true }).count(),
    0,
    "onboarding must not require a workspace",
  );
  assert.equal(
    await page.getByRole("textbox", { name: "OpenAI API key" }).count(),
    0,
    "model setup must stay hidden until Ovule is selected",
  );
  const configureSample = page.getByRole("checkbox", { name: "Configure Sample ACP" });
  if (!(await configureSample.isChecked())) await configureSample.click();
  const sampleCard = configureSample.locator("..");
  const makeSampleDefault = sampleCard.getByRole("button", { name: "Make default" });
  if (await makeSampleDefault.isVisible()) await makeSampleDefault.click();
  const configureOvule = page.getByRole("checkbox", { name: "Configure Ovule" });
  if (!(await configureOvule.isChecked())) await configureOvule.click();
  let onboardingProvider = page
    .getByRole("article", { name: "Ovule", exact: true })
    .getByRole("combobox", {
      name: "Model provider",
      exact: true,
    });
  await onboardingProvider.waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "OpenAI API key" }).count(),
    0,
    "provider-specific controls must wait for a provider choice",
  );
  assert.equal(
    await page
      .getByRole("article", { name: "Ovule", exact: true })
      .getByRole("combobox", { name: "Model", exact: true })
      .isEnabled(),
    false,
    "model selection requires a provider",
  );
  const onboardingStatus = await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.onboardingStatus(),
  );
  assert.ok(onboardingStatus.toolchains.some((item) => item.id === "nodejs"));
  assert.ok(onboardingStatus.toolchains.some((item) => item.id === "python"));
  assert.ok(!onboardingStatus.toolchains.some((item) => item.id === "channel-cli"));
  assert.ok(
    onboardingStatus.toolchains.some((item) => item.id === "ollama" && item.available),
    "Ollama must be detected outside PATH through the Toolchain resolver",
  );
  assert.ok(
    onboardingStatus.models.some(
      (item) => item.provider === "ollama" && item.remoteId === "ollama:smollm2:135m",
    ),
    "Ollama models must be discovered through the local API",
  );
  const codexSetup = onboardingStatus.setups.find((setup) => setup.id === "codex");
  assert.equal(codexSetup?.status.available, true);
  assert.equal(codexSetup?.status.authenticated, true);
  assert.equal(codexSetup?.extensionId, "io.ovule.agent.codex");
  assert.equal(
    onboardingStatus.setups.find((setup) => setup.id === "deepseek")?.extensionId,
    "io.ovule.provider.deepseek",
  );
  assert.equal(
    onboardingStatus.setups.find((setup) => setup.id === "ollama")?.extensionId,
    "io.ovule.host",
  );
  await onboardingProvider.click();
  await page.getByRole("option", { name: /OpenAI \/ Codex/ }).click();
  await page.getByRole("button", { name: "Sign in with ChatGPT" }).waitFor();
  let onboardingModel = page
    .getByRole("article", { name: "Ovule", exact: true })
    .getByRole("combobox", { name: "Model", exact: true });
  await onboardingModel.waitFor();
  await onboardingModel.click();
  await page.getByRole("option", { name: /GPT-6 Astra/ }).click();
  await page.getByRole("button", { name: "Add Ovule profile" }).click();
  onboardingProvider = page
    .getByRole("article", { name: "Ovule 2", exact: true })
    .getByRole("combobox", { name: "Model provider", exact: true });
  onboardingModel = page
    .getByRole("article", { name: "Ovule 2", exact: true })
    .getByRole("combobox", { name: "Model", exact: true });
  await onboardingProvider.click();
  await page.getByRole("option", { name: /Ollama/ }).click();
  await page.getByRole("textbox", { name: "Ollama model" }).waitFor();
  await onboardingModel.click();
  await page.getByRole("option", { name: /smollm2:135m/ }).click();
  await page.getByRole("button", { name: "Add Ovule profile" }).click();
  onboardingProvider = page
    .getByRole("article", { name: "Ovule 3", exact: true })
    .getByRole("combobox", { name: "Model provider", exact: true });
  onboardingModel = page
    .getByRole("article", { name: "Ovule 3", exact: true })
    .getByRole("combobox", { name: "Model", exact: true });
  await onboardingProvider.click();
  await page.getByRole("option", { name: /DeepSeek/ }).click();
  await page.getByLabel("DeepSeek API key").fill("sk-deepseek-native-smoke-1234567890");
  await page.getByRole("button", { name: "Save API key" }).click();
  await onboardingModel.waitFor();
  await onboardingModel.click();
  await page.getByRole("option", { name: "deepseek-v4-special", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: /Channel|Channel/ }).count(), 0);
  const continueButton = page.getByRole("button", { name: "Continue", exact: true });
  await waitFor(
    async () => await continueButton.isEnabled().catch(() => false),
    "onboarding discovery",
    90_000,
  );
  log("onboarding_submit");
  await continueButton.click();
  await page
    .getByRole("heading", { name: "Configure your Agents" })
    .waitFor({ state: "detached", timeout: 30_000 });
  assert.equal((await snapshot(page)).threads.length, 0, "onboarding must not create a Thread");
  const configuredOnboarding = await snapshot(page);
  assert.equal(
    configuredOnboarding.agents.filter((agent) => agent.driver === "ovule" && agent.enabled).length,
    3,
    "onboarding must persist multiple Ovule profiles",
  );
  assert.ok(
    configuredOnboarding.agents
      .filter((agent) => agent.driver === "ovule" && agent.enabled)
      .every((agent) => agent.toolIds.includes("computer-use")),
    "every Ovule profile must inherit the built-in CRD Computer Use Tool",
  );
  assert.ok(
    configuredOnboarding.agents.some(
      (agent) =>
        agent.driver === "ovule" &&
        agent.enabled &&
        agent.modelId === "onboarding-deepseek-deepseek-v4-special",
    ),
    "onboarding must configure DeepSeek as a Ovule model provider",
  );
  const configuredDeepSeekStatus = await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.onboardingStatus(),
  );
  const deepSeekSetup = configuredDeepSeekStatus.setups.find((setup) => setup.id === "deepseek");
  assert.equal(deepSeekSetup?.status.available, true);
  assert.equal(deepSeekSetup?.status.authenticated, true);
  assert.match(deepSeekSetup?.status.detail ?? "", /securely configured/i);
  assert.equal(
    await page.locator(".harness-panel").count(),
    0,
    "tools panel must be hidden initially",
  );
  if (process.platform === "darwin") {
    assert.equal(await page.locator(".window-controls").count(), 0);
    await page.locator('[data-native-traffic-lights="reserved"]').waitFor();
    assert.equal(await page.locator(".titlebar").getByLabel("Ovule").count(), 0);
  } else {
    assert.equal(await page.locator(".window-controls").getAttribute("data-platform"), "windows");
    await page.locator(".titlebar").getByLabel("Ovule").waitFor();
  }
  let threadPage = await threadPageFor(browser);
  const sidebarSeparator = page.getByRole("separator", { name: "Resize navigation sidebar" });
  await sidebarSeparator.waitFor({ state: "attached" });
  const sidebarWidthBefore = Number(await sidebarSeparator.getAttribute("aria-valuenow"));
  if (await sidebarSeparator.isVisible()) {
    await sidebarSeparator.press("ArrowRight");
  } else {
    await sidebarSeparator.dispatchEvent("keydown", { key: "ArrowRight", code: "ArrowRight" });
  }
  const sidebarWidthAfter = Number(await sidebarSeparator.getAttribute("aria-valuenow"));
  assert.ok(
    sidebarWidthAfter > sidebarWidthBefore,
    `${sidebarWidthBefore} -> ${sidebarWidthAfter}`,
  );
  assert.ok(
    Number(await page.evaluate(async () => localStorage.getItem("ovule.workbench.sidebarWidth"))) >
      0,
    "keyboard resize must persist a positive sidebar width",
  );
  const layout = await page.evaluate(async () => {
    const surface = document
      .querySelector('explorer[aria-label="Conversation Thread"]')
      ?.getBoundingClientRect();
    await (await import("/tuffite.js")).window.restore();
    const nativeBounds = await (await import("/tuffite.js")).window.getBounds();
    return {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      surfaceRight: surface?.right,
      viewportWidth: window.innerWidth,
      windowWidth: nativeBounds.width,
      windowHeight: nativeBounds.height,
    };
  });
  const threadLayout = await threadPage.evaluate(async () => {
    const conversation = document.querySelector(".conversation")?.getBoundingClientRect();
    const timeline = document.querySelector(".timeline")?.getBoundingClientRect();
    return {
      documentHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      conversationRight: conversation?.right,
      timelineRight: timeline?.right,
      viewportWidth: window.innerWidth,
    };
  });
  assert.equal(
    layout.documentHeight,
    layout.viewportHeight,
    `workspace must not scroll at document level: ${JSON.stringify(layout)}`,
  );
  assert.ok(
    (layout.surfaceRight ?? Infinity) <= layout.viewportWidth + 0.5,
    `Thread Explorer escapes viewport: ${JSON.stringify(layout)}`,
  );
  assert.equal(
    layout.windowWidth,
    992,
    `unexpected default window width: ${JSON.stringify(layout)}`,
  );
  assert.equal(
    layout.windowHeight,
    800,
    `unexpected default window height: ${JSON.stringify(layout)}`,
  );
  assert.equal(
    threadLayout.documentHeight,
    threadLayout.viewportHeight,
    `Thread document must not scroll at document level: ${JSON.stringify(threadLayout)}`,
  );
  assert.ok(
    (threadLayout.timelineRight ?? Infinity) <= threadLayout.viewportWidth + 0.5,
    `timeline escapes Thread viewport: ${JSON.stringify(threadLayout)}`,
  );
  assert.ok(
    (threadLayout.conversationRight ?? Infinity) <= threadLayout.viewportWidth + 0.5,
    `Conversation escapes Thread viewport: ${JSON.stringify(threadLayout)}`,
  );
  assert.equal(await page.locator("html").getAttribute("data-theme-mode"), "system");
  const hideSidebar = threadPage.getByRole("button", { name: "Hide sidebar" });
  const showSidebar = threadPage.getByRole("button", { name: "Show sidebar" });
  if (await hideSidebar.isVisible().catch(() => false)) {
    await hideSidebar.click();
    await showSidebar.waitFor();
    await showSidebar.click();
    await hideSidebar.waitFor();
  } else {
    await showSidebar.click();
  }
  assert.equal(
    await page.getByRole("dialog", { name: "Search Conversation Threads" }).count(),
    0,
    "the titlebar Show sidebar button must not open thread search",
  );
  await page.getByRole("button", { name: "Search Conversation Threads", exact: true }).click();
  const threadSwitcher = page.getByRole("dialog", { name: "Search Conversation Threads" });
  await threadSwitcher.waitFor();
  await threadSwitcher
    .getByRole("textbox", { name: "Search Conversation Thread history" })
    .fill("no match");
  await threadSwitcher.getByText("No matching Conversation Threads").waitFor();
  const restoreSidebar = threadSwitcher.getByRole("button", { name: "Restore sidebar" });
  if (await restoreSidebar.isVisible().catch(() => false)) {
    await restoreSidebar.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await threadSwitcher.waitFor({ state: "hidden" });
  await page.locator(".framework:not(.sidebar-collapsed)").waitFor();
  await setThemeMode(page, "light");
  assert.equal(await page.locator("html").getAttribute("data-theme-mode"), "light");
  await setThemeMode(page, "dark");
  assert.equal(await page.locator("html").getAttribute("data-theme-mode"), "dark");
  await setThemeMode(page, "system");
  log("thread_create");
  await page.getByRole("button", { name: "New Conversation", exact: true }).click();
  assert.equal(await page.getByPlaceholder("Thread title").count(), 0);
  threadPage = await threadPageFor(browser, "");
  await threadPage.getByRole("button", { name: "Choose workspace" }).waitFor();
  const composerLayout = await threadPage.evaluate(async () => {
    const timeline = document.querySelector('[data-testid="thread-timeline"]');
    const composer = document.querySelector(".composer");
    if (!timeline || !composer) return undefined;
    const timelineBounds = timeline.getBoundingClientRect();
    const composerBounds = composer.getBoundingClientRect();
    return { timelineBottom: timelineBounds.bottom, composerTop: composerBounds.top };
  });
  assert.ok(composerLayout, "timeline and composer must be rendered");
  assert.ok(
    composerLayout.timelineBottom <= composerLayout.composerTop - 10,
    `composer must reserve layout space below the timeline: ${JSON.stringify(composerLayout)}`,
  );
  assert.equal(
    await page.evaluate(async () => typeof (await import("/tuffite.js")).dialog.openDirectory),
    "function",
    "composer workspace picker must use the native directory dialog API",
  );
  await page.evaluate(async () => {
    window.__ovuleAgentChunks = [];
    window.tuffite.addEventListener("channel", (event) => {
      if (event.detail.channel === "ovule:agent-output") {
        window.__ovuleAgentChunks.push(new TextDecoder().decode(event.detail.data));
      }
    });
  });
  await installStreamingObserver(threadPage, true);
  const firstMessage =
    "Start with exactly '# CDP production thread', then explain streaming Markdown in two bullets and include THREAD_CDP_OK. Do not modify files or use tools.";
  const composerInput = threadPage.getByRole("textbox", { name: "Message" });
  if (process.platform === "darwin") {
    await composerInput.fill("copy and paste on macOS");
    await composerInput.press("Meta+A");
    await composerInput.press("Meta+C");
    await composerInput.fill("");
    await composerInput.press("Meta+V");
    assert.equal(await composerInput.inputValue(), "copy and paste on macOS");
    await composerInput.press("Meta+A");
    await composerInput.type("select all works");
    assert.equal(await composerInput.inputValue(), "select all works");
    await composerInput.fill("");
  }
  const pastedPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAwSURBVFhH7c4hAQAACAMwIlONMtQ5MTAT86veyScBAQEBAQEBAQEBAQEBAYHnwOQAGKDYpog/bPoAAAAASUVORK5CYII=",
    "base64",
  );
  const pasteImage = async () =>
    composerInput.evaluate(
      async (element, bytes) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([Uint8Array.from(bytes)], "clipboard.png", { type: "image/png" }),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      },
      [...pastedPng],
    );
  log("clipboard_image");
  await pasteImage();
  await threadPage.locator(".composer img[alt='clipboard.png']").waitFor();
  await threadPage.getByRole("button", { name: "Remove clipboard.png" }).click();
  assert.equal(await threadPage.locator(".composer img[alt='clipboard.png']").count(), 0);
  await pasteImage();
  await threadPage.locator(".composer img[alt='clipboard.png']").waitFor();
  await composerInput.fill(firstMessage);
  await threadPage.getByRole("button", { name: "Send message" }).click();
  const thread = await waitFor(async () => {
    const value = await snapshot(page);
    const source = value.messages.find(
      (item) => item.role === "user" && item.content === firstMessage,
    );
    return source && value.threads.find((item) => item.id === source.threadId);
  }, "first-message Thread creation");
  threadPage = await threadPageFor(browser, thread.id);
  await installStreamingObserver(threadPage, true);
  await threadPage.locator('[data-message-role="assistant"]').waitFor();
  const spinnerAnimation = await waitFor(
    async () => {
      const spinner = threadPage.locator(".ui-message-avatar .animate-spin").last();
      if (!(await spinner.count())) return undefined;
      return spinner.evaluate(async (element) => {
        const style = getComputedStyle(element);
        return style.animationName !== "none" && style.animationDuration !== "0s"
          ? { name: style.animationName, duration: style.animationDuration }
          : undefined;
      });
    },
    "rotating Agent avatar spinner",
    10_000,
  );
  assert.ok(spinnerAnimation.name);
  const imagePart = await waitFor(async () => {
    const value = await snapshot(page);
    return value.messages
      .find((item) => item.role === "user" && item.content === firstMessage)
      ?.parts.find((part) => part.kind === "image");
  }, "persisted clipboard image");
  assert.equal(imagePart.name, "clipboard.png");
  assert.equal(imagePart.mediaType, "image/png");
  assert.equal(Number(imagePart.sizeBytes), pastedPng.length);
  const attachmentId = imagePart.url?.replace("ovule-attachment:///", "");
  assert.match(attachmentId ?? "", /^[a-f0-9]{64}\.png$/);
  const persistedImage = await page.evaluate(
    async (id) => (await import("/shell_api.js")).message.readMessageAttachment(id),
    attachmentId,
  );
  assert.deepEqual(Buffer.from(persistedImage), pastedPng);
  const renderedImage = threadPage.locator("img[alt='clipboard.png']");
  await renderedImage.waitFor();
  await waitFor(
    () => renderedImage.evaluate(async (image) => image.complete && image.naturalWidth > 0),
    "rendered persisted clipboard image",
  );
  const initialThreadAttempt = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (item) =>
        item.threadId === thread.id &&
        !item.taskId &&
        ["succeeded", "failed", "cancelled"].includes(item.status),
    );
  }, "initial Thread Attempt");
  assert.equal(initialThreadAttempt.status, "succeeded", initialThreadAttempt.summary);
  await waitFor(
    async () =>
      (await snapshot(page)).threads.find((item) => item.id === thread.id)?.title ===
      "CDP production thread",
    "generated Conversation Thread title",
  );
  await page.locator(".thread-row", { hasText: "CDP production thread" }).waitFor();
  if (process.env.OVULE_CDP_SCOPE === "image") {
    process.stdout.write(
      `native_cdp_image=ok preview=true remove=true persisted=true bytes=${pastedPng.length} rendered=true agent=true\n`,
    );
    await browser.close();
    process.exit(0);
  }
  if (process.env.OVULE_CDP_SCOPE === "workflow") {
    await verifyGoalWorkflow({ browser, page, threadPage, thread });
    process.stdout.write(
      "native_cdp_workflow=ok goal_command=true dynamic=true node_thread=true\n",
    );
    await browser.close();
    process.exit(0);
  }
  if (process.env.OVULE_CDP_SCOPE === "remote-control") {
    log("remote_control_pairing");
    const host = await page.evaluate(async () =>
      (await import("/shell_api.js")).workspace.shareHostLink(),
    );
    const initialProbe = await page.evaluate(
      async ({ endpointAddrJson, shareId }) =>
        (await import("/shell_api.js")).workspace.testWorkspaceLink(endpointAddrJson, shareId),
      host,
    );
    assert.equal(initialProbe.connected, false);
    assert.match(initialProbe.detail, /waiting for Host approval/i);
    const pending = await waitFor(async () => {
      const status = await page.evaluate(async () =>
        (await import("/shell_api.js")).workspace.shareHostLink(),
      );
      const request = status.pending.find((item) => item.clientId === initialProbe.clientId);
      return request ? { status, request } : undefined;
    }, "loopback Host pairing request");
    assert.match(pending.request.code, /^\d{6}$/);
    await page.evaluate(
      async ({ endpointAddrJson, shareId, code }) =>
        (await import("/shell_api.js")).workspace.submitWorkspaceLinkPairing(
          endpointAddrJson,
          shareId,
          code,
        ),
      {
        endpointAddrJson: pending.status.endpointAddrJson,
        shareId: pending.status.shareId,
        code: pending.request.code,
      },
    );
    const tested = await waitFor(async () => {
      const result = await page.evaluate(
        async ({ endpointAddrJson, shareId }) =>
          (await import("/shell_api.js")).workspace.testWorkspaceLink(endpointAddrJson, shareId),
        pending.status,
      );
      return result.connected ? result : undefined;
    }, "paired loopback Host");
    assert.ok(tested.capabilities.includes("desktop.control"));
    const registered = await page.evaluate(
      async ({ endpointAddrJson, agentIds, workspaces }) =>
        (await import("/shell_api.js")).workspace.registerEndpoint({
          displayName: "Loopback CRD Host",
          transport: "tunnel",
          host: endpointAddrJson,
          agentIds,
          workspaces,
        }),
      {
        endpointAddrJson: pending.status.endpointAddrJson,
        agentIds: tested.agentIds,
        workspaces: tested.workspaces,
      },
    );

    log("remote_control_start");
    await page.evaluate(async ({ endpointId }) => {
      const id = await (
        await import("/shell_api.js")
      ).remoting.start(endpointId, {
        authKey: "ovule-native-remote-control-smoke",
        maxBitrateKbps: 30_000,
        targetFramerate: 60,
      });
      window.__ovuleRemoteControlSmoke = { endpointId, session: { id, state: "connecting" } };
    }, registered);
    const session = JSON.parse(
      await page.evaluate(async () =>
        JSON.stringify({
          exists: window.__ovuleRemoteControlSmoke?.session !== undefined,
          id: window.__ovuleRemoteControlSmoke?.session?.id?.toString(),
          idType: typeof window.__ovuleRemoteControlSmoke?.session?.id,
          state: window.__ovuleRemoteControlSmoke?.session?.state,
        }),
      ),
    );
    assert.equal(session.exists, true, "startRemoteControl returned undefined in the page");
    assert.equal(session.idType, "bigint");
    assert.ok(BigInt(session.id) > 0n);
    assert.equal(session.state, "connecting");
    const initialSignals = JSON.parse(
      await page.evaluate(async () => {
        const { endpointId, session } = window.__ovuleRemoteControlSmoke;
        return (await import("/shell_api.js")).remoting
          .snapshot(session.id, 0n)
          .then(({ signals }) =>
            JSON.stringify({ isArray: Array.isArray(signals), length: signals.length }),
          );
      }),
    );
    assert.equal(initialSignals.isArray, true);
    const stats = await page.evaluate(async () => {
      const { endpointId, session } = window.__ovuleRemoteControlSmoke;
      return (await import("/shell_api.js")).remoting.snapshot(session.id, 0n);
    });
    assert.equal(typeof stats.state, "string");
    assert.ok(Array.isArray(stats.signals));
    assert.equal(
      await page.evaluate(async () => {
        const { endpointId, session } = window.__ovuleRemoteControlSmoke;
        return (await import("/shell_api.js")).remoting.stop(session.id);
      }),
      true,
    );
    process.stdout.write(
      "native_cdp_remote_control=ok link_pairing=true capability=true start=true initial_signal_cursor=true stats=true stop=true omitted_screen_id=true\n",
    );
    await browser.close();
    process.exit(0);
  }
  if (process.env.OVULE_CDP_SCOPE === "computer-use") {
    const capabilitySnapshot = await snapshot(page);
    const computerUseCapability = capabilitySnapshot.capabilities.find(
      (capability) => capability.id === "computer-use",
    );
    assert.equal(computerUseCapability?.backend, "crd");
    assert.equal(computerUseCapability?.health, "ready");
    assert.ok(computerUseCapability?.projections.includes("rig_direct"));
    assert.ok(computerUseCapability?.projections.includes("loopback_http_mcp"));
    assert.ok(
      computerUseCapability?.agentExposures.some(
        (exposure) => exposure.agentId === "sample" && exposure.projection === "loopback_http_mcp",
      ),
      "Sample ACP must receive CRD Computer Use through authenticated loopback HTTP MCP",
    );
    assert.equal(
      capabilitySnapshot.legacyDataIssues.length,
      0,
      "isolated candidate profile must not contain legacy TryCua data",
    );
    const computerUseThread = capabilitySnapshot.threads.find((item) => item.id === thread.id);
    assert.ok(computerUseThread, "Computer Use Thread must remain in the snapshot");

    const openAiProfile = configuredOnboarding.agents.find(
      (agent) =>
        agent.driver === "ovule" &&
        agent.enabled &&
        configuredOnboarding.models.some(
          (model) => model.id === agent.modelId && model.provider === "openai",
        ),
    );
    assert.ok(openAiProfile, "OpenAI Ovule profile must be configured");
    await page.evaluate(
      async ({ threadId, agentId }) =>
        (await import("/shell_api.js")).message.selectAgent(threadId, agentId),
      { threadId: thread.id, agentId: openAiProfile.id },
    );

    log("computer_use_external_mcp");
    const externalAttemptIds = new Set(capabilitySnapshot.attempts.map((attempt) => attempt.id));
    await page.evaluate(
      async ({ threadId }) =>
        (await import("/shell_api.js")).message.sendMessage(threadId, "CRD_EXTERNAL_MCP_CDP"),
      { threadId: thread.id },
    );
    const externalAttempt = await waitFor(async () => {
      const value = await snapshot(page);
      return value.attempts.find(
        (attempt) =>
          attempt.threadId === thread.id &&
          !externalAttemptIds.has(attempt.id) &&
          ["succeeded", "failed", "cancelled"].includes(attempt.status),
      );
    }, "Ovule OpenAI authenticated loopback MCP screenshot");
    assert.equal(externalAttempt.status, "succeeded", externalAttempt.summary);
    assert.match(externalAttempt.output, /ACP_CRD_MCP_CDP_OK/);

    log("computer_use_remote_host_mcp");
    const shared = await page.evaluate(
      async ({ threadId }) =>
        (await import("/shell_api.js")).workspace.shareCurrentWorkspaceLink(threadId),
      { threadId: thread.id },
    );
    const initialProbe = await page.evaluate(
      async ({ endpointAddrJson, shareId }) =>
        (await import("/shell_api.js")).workspace.testWorkspaceLink(endpointAddrJson, shareId),
      shared,
    );
    assert.equal(initialProbe.connected, false);
    const pending = await waitFor(async () => {
      const status = await page.evaluate(async () =>
        (await import("/shell_api.js")).workspace.shareHostLink(),
      );
      const request = status.pending.find((item) => item.clientId === initialProbe.clientId);
      return request ? { status, request } : undefined;
    }, "Computer Use loopback Host pairing request");
    await page.evaluate(
      async ({ endpointAddrJson, shareId, code }) =>
        (await import("/shell_api.js")).workspace.submitWorkspaceLinkPairing(
          endpointAddrJson,
          shareId,
          code,
        ),
      {
        endpointAddrJson: pending.status.endpointAddrJson,
        shareId: pending.status.shareId,
        code: pending.request.code,
      },
    );
    const sharedWorkspace = shared.workspaces.find(
      (workspace) =>
        normalizeWindowsPath(workspace.root) ===
        normalizeWindowsPath(computerUseThread.workspacePath),
    );
    assert.ok(sharedWorkspace, "shared local Workspace must be present in Host inventory");
    await page.evaluate(
      async ({ clientId, workspaceId }) =>
        (await import("/shell_api.js")).workspace.setWorkspaceLinkAccess({
          clientId,
          workspaceIds: [workspaceId],
          agentIds: ["ovule", "codex", "sample"],
        }),
      { clientId: pending.request.clientId, workspaceId: sharedWorkspace.shareId },
    );
    const tested = await waitFor(async () => {
      const result = await page.evaluate(
        async ({ endpointAddrJson, shareId }) =>
          (await import("/shell_api.js")).workspace.testWorkspaceLink(endpointAddrJson, shareId),
        pending.status,
      );
      return result.connected ? result : undefined;
    }, "Computer Use paired loopback Host");
    assert.ok(tested.capabilities.includes("computer-use.mcp"));
    const registered = await page.evaluate(
      async ({ endpointAddrJson, agentIds, workspaces }) =>
        (await import("/shell_api.js")).workspace.registerEndpoint({
          displayName: "Loopback Computer Use Host",
          transport: "tunnel",
          host: endpointAddrJson,
          agentIds,
          workspaces,
        }),
      {
        endpointAddrJson: pending.status.endpointAddrJson,
        agentIds: tested.agentIds,
        workspaces: tested.workspaces,
      },
    );
    let remoteSnapshot = await page.evaluate(
      async ({ threadId, endpointId, workspace }) =>
        (await import("/shell_api.js")).workspace.bindWorkspace({
          threadId,
          kind: "tunnel",
          endpointId,
          resourceId: workspace.shareId,
          root: workspace.root,
          alias: workspace.alias,
        }),
      { threadId: thread.id, endpointId: registered.endpointId, workspace: sharedWorkspace },
    );
    remoteSnapshot = await page.evaluate(
      async ({ threadId, endpointId }) =>
        (await import("/shell_api.js")).message.selectHost(threadId, endpointId),
      { threadId: thread.id, endpointId: registered.endpointId },
    );
    remoteSnapshot = await page.evaluate(
      async ({ threadId, agentId }) =>
        (await import("/shell_api.js")).message.selectAgent(threadId, agentId),
      { threadId: thread.id, agentId: openAiProfile.id },
    );
    const remoteAttemptIds = new Set(remoteSnapshot.attempts.map((attempt) => attempt.id));
    await page.evaluate(
      async ({ threadId }) =>
        (await import("/shell_api.js")).message.sendMessage(threadId, "CRD_EXTERNAL_MCP_CDP"),
      { threadId: thread.id },
    );
    const remoteAttempt = await waitFor(async () => {
      const value = await snapshot(page);
      return value.attempts.find(
        (attempt) =>
          attempt.threadId === thread.id &&
          !remoteAttemptIds.has(attempt.id) &&
          ["succeeded", "failed", "cancelled"].includes(attempt.status),
      );
    }, "Remote Host authenticated loopback MCP screenshot");
    assert.equal(remoteAttempt.status, "succeeded", remoteAttempt.summary);
    assert.match(remoteAttempt.output, /ACP_CRD_MCP_CDP_OK/);

    log("computer_use_rig_direct");
    const deepSeekProfile = configuredOnboarding.agents.find(
      (agent) =>
        agent.driver === "ovule" &&
        agent.enabled &&
        agent.modelId === "onboarding-deepseek-deepseek-v4-special",
    );
    assert.ok(deepSeekProfile, "DeepSeek Ovule profile must be configured");
    let deepSeekSnapshot = await page.evaluate(
      async ({ workspacePath }) =>
        (await import("/shell_api.js")).workspace.createThread({ workspacePath }),
      { workspacePath: canonicalWorkspace },
    );
    const deepSeekThread = deepSeekSnapshot.threads.at(-1);
    assert.ok(deepSeekThread, "DeepSeek Thread must be created");
    deepSeekSnapshot = await page.evaluate(
      async ({ threadId, agentId }) =>
        (await import("/shell_api.js")).message.selectAgent(threadId, agentId),
      { threadId: deepSeekThread.id, agentId: deepSeekProfile.id },
    );
    const directAttemptIds = new Set(deepSeekSnapshot.attempts.map((attempt) => attempt.id));
    await page.evaluate(
      async ({ threadId }) =>
        (await import("/shell_api.js")).message.sendMessage(threadId, "DEEPSEEK_NATIVE_CDP"),
      { threadId: deepSeekThread.id },
    );
    const directAttempt = await waitFor(async () => {
      const value = await snapshot(page);
      return value.attempts.find(
        (attempt) =>
          attempt.threadId === deepSeekThread.id &&
          !directAttemptIds.has(attempt.id) &&
          ["succeeded", "failed", "cancelled"].includes(attempt.status),
      );
    }, "Host-native CRD screenshot");
    assert.equal(directAttempt.status, "succeeded", directAttempt.summary);
    assert.match(directAttempt.output, /DEEPSEEK_NATIVE_CDP_OK/);
    assert.match(directAttempt.output, /CRD_COMPUTER_USE_CDP_OK/);
    process.stdout.write(
      "native_cdp_computer_use=ok external_acp=true local_workspace=true remote_workspace=true host_loopback_http_mcp=true authenticated=true tools_list=true screenshot=true rig_direct=true\n",
    );
    await browser.close();
    process.exit(0);
  }
  await page.evaluate(
    async ({ threadId, workspacePath }) =>
      (await import("/shell_api.js")).workspace.setThreadWorkspace(threadId, workspacePath),
    { threadId: thread.id, workspacePath: canonicalWorkspace },
  );
  await waitFor(
    async () =>
      normalizeWindowsPath(
        (await snapshot(page)).threads.find((item) => item.id === thread.id)?.workspacePath ?? "",
      ) === normalizeWindowsPath(canonicalWorkspace),
    "Thread workspace binding",
  );

  log("office_extension");
  const initialOfficeFile = await page.evaluate(
    async ({ threadId }) =>
      (await import("/shell_api.js")).content.readWorkspaceFile(threadId, "report.csv"),
    { threadId: thread.id },
  );
  assert.equal(initialOfficeFile.name, "report.csv");
  assert.equal(initialOfficeFile.extension, "csv");
  assert.match(new TextDecoder().decode(initialOfficeFile.bytes), /Ovule,1/);
  await threadPage.evaluate(async () => {
    window.dispatchEvent(new CustomEvent("ovule:office-use", { detail: { target: "report.csv" } }));
  });
  const officePanel = await panePageFor(browser, "office", thread.id, "report.csv");
  await officePanel.locator('[data-testid="office-editor"] .office-grid').waitFor();
  const firstOfficeCell = officePanel.locator(".office-grid input").first();
  assert.equal(await firstOfficeCell.inputValue(), "Item");
  await firstOfficeCell.evaluate(async (input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "Category");
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  });
  await officePanel.getByText(/Unsaved changes/).waitFor();
  const officeTab = page.locator(".pane-active-tab").filter({ hasText: "report.csv" });
  await officeTab.hover();
  await officeTab.getByRole("button", { name: "Save Office file", exact: true }).click();
  await officePanel.getByText(/Saved .*report\.csv/).waitFor();
  const savedOfficeFile = await page.evaluate(
    async ({ threadId }) =>
      (await import("/shell_api.js")).content.readWorkspaceFile(threadId, "report.csv"),
    { threadId: thread.id },
  );
  assert.match(new TextDecoder().decode(savedOfficeFile.bytes), /Category,Value/);
  const outsidePdf = await page.evaluate(
    async ({ threadId, target }) =>
      (await import("/shell_api.js")).content.readWorkspaceFile(threadId, target),
    { threadId: thread.id, target: outsideOfficePdf },
  );
  assert.equal(outsidePdf.extension, "pdf");
  assert.equal(
    normalizeWindowsPath(outsidePdf.path),
    normalizeWindowsPath(canonicalOutsideOfficePdf),
  );
  log("office_extension_ok");

  log("catalog_skill");
  await page.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Extensions", exact: true }).click();
  await page.getByRole("button", { name: "Install third-party extension", exact: true }).waitFor();
  const sampleExtensionCard = page
    .locator(".catalog-card")
    .filter({ hasText: "io.ovule.agent.sample" })
    .first();
  await sampleExtensionCard.getByRole("button", { name: "Disable", exact: true }).waitFor();
  await sampleExtensionCard.getByRole("button", { name: /Remove/ }).waitFor();
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await page
    .getByText("SKILL.md or skill directory")
    .locator("..")
    .getByRole("textbox")
    .fill(skillDir);
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator(".catalog-card").filter({ hasText: "cdp-check" }).waitFor();

  log("catalog_model");
  await page.getByRole("button", { name: "Models", exact: true }).click();
  const modelSection = page.getByRole("heading", { name: "Model catalog" }).locator("../../..");
  await modelSection.getByLabel("ID", { exact: true }).fill("cdp-model");
  await modelSection.getByLabel("Label", { exact: true }).fill("CDP Model");
  await modelSection.getByLabel("Provider", { exact: true }).fill("sample");
  await modelSection.getByLabel("Remote model ID", { exact: true }).fill("driver-default");
  await modelSection.getByLabel("Sample ACP").check();
  await modelSection.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("CDP Model", { exact: true }).waitFor();
  await modelSection.getByText("Discovered Ollama models").waitFor();
  await modelSection.locator('[data-testid="ollama-setup"]').waitFor();
  await modelSection.getByRole("button", { name: "smollm2:135m · local", exact: true }).click();
  assert.equal(await modelSection.getByLabel("Provider", { exact: true }).inputValue(), "ollama");
  assert.equal(
    await modelSection.getByLabel("Remote model ID", { exact: true }).inputValue(),
    "ollama:smollm2:135m",
  );
  await modelSection.getByRole("button", { name: "Save", exact: true }).click();
  await modelSection.locator("article.catalog-card", { hasText: "smollm2:135m" }).waitFor();

  log("catalog_tool");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  const toolSection = page
    .getByRole("heading", { name: "Capabilities & tools" })
    .locator("../../..");
  const capabilitySnapshot = await snapshot(page);
  for (const id of [
    "browser-use",
    "workspace-operations",
    "terminal-session",
    "host-management",
    "app-actions",
    "computer-use",
  ]) {
    assert.ok(
      capabilitySnapshot.capabilities.some((capability) => capability.id === id),
      `unified Capability Registry is missing ${id}`,
    );
  }
  const computerUseCapability = capabilitySnapshot.capabilities.find(
    (capability) => capability.id === "computer-use",
  );
  assert.equal(computerUseCapability?.backend, "crd");
  assert.equal(computerUseCapability?.health, "ready");
  assert.ok(computerUseCapability?.projections.includes("rig_direct"));
  assert.ok(computerUseCapability?.projections.includes("loopback_http_mcp"));
  assert.ok(
    computerUseCapability?.agentExposures.some(
      (exposure) => exposure.agentId === "sample" && exposure.projection === "loopback_http_mcp",
    ),
    "Sample ACP must receive CRD Computer Use through authenticated loopback HTTP MCP",
  );
  assert.equal(
    capabilitySnapshot.legacyDataIssues.length,
    0,
    "isolated candidate profile must not contain legacy TryCua data",
  );
  await toolSection.locator('[data-capability-group="built_in"]').waitFor();
  await toolSection.getByText("CRD Computer Use", { exact: true }).waitFor();
  await toolSection.getByLabel("ID", { exact: true }).fill("cdp-shell");
  await toolSection.getByLabel("Label", { exact: true }).fill("CDP Shell");
  await selectRadix(page, "Transport", "stdio");
  await toolSection.getByLabel("Executable", { exact: true }).fill("powershell.exe");
  await toolSection.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("CDP Shell", { exact: true }).waitFor();

  log("catalog_agent");
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  const agentSection = page.getByRole("heading", { name: "Agent profiles" }).locator("../../..");
  await agentSection.getByRole("button", { name: "New", exact: true }).click();
  await agentSection.getByPlaceholder("release-reviewer").fill("cdp-sample");
  await agentSection.getByPlaceholder("Release reviewer").fill("CDP Sample ACP");
  await agentSection.getByRole("combobox", { name: "Driver" }).click();
  await page.getByRole("option", { name: "Sample ACP", exact: true }).click();
  await agentSection.getByLabel("cdp-check").check();
  await agentSection.getByLabel("CDP Shell").check();
  await agentSection
    .getByPlaceholder("Role-specific instructions")
    .fill("Respond with the exact requested marker and do not modify files.");
  await agentSection.getByRole("button", { name: "Save", exact: true }).click();
  await agentSection.locator(".catalog-card").filter({ hasText: "CDP Sample ACP" }).waitFor();
  let state = await snapshot(page);
  assert.ok(state.skills.some((item) => item.id === "cdp-check" && item.enabled));
  assert.ok(state.models.some((item) => item.id === "cdp-model" && item.enabled));
  assert.ok(state.tools.some((item) => item.id === "cdp-shell" && item.available));
  assert.ok(state.agents.some((item) => item.id === "cdp-sample" && item.available));
  await page.getByRole("button", { name: "Toolchains", exact: true }).click();
  await page.getByRole("heading", { name: "Local Toolchains" }).waitFor();
  await page.getByText("Node.js", { exact: true }).waitFor();
  await page.getByText("Python", { exact: true }).waitFor();
  const toolchainSection = page
    .getByRole("heading", { name: "Local Toolchains" })
    .locator("../../..");
  const manageSurface = page.locator('[data-framework-content="settings"]');
  await page.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).click();
  await manageSurface.waitFor({ state: "hidden" });
  threadPage = await threadPageFor(browser, thread.id);
  const composer = threadPage.getByRole("textbox", { name: "Message" });
  const threadSurface = page.locator('explorer[aria-label="Conversation Thread"]');
  const slashValue = await threadSurface.evaluate(async (element) => {
    const state = await element.getNavigationState();
    return element.executeJavaScript(
      `(() => {
        const textarea = document.querySelector('textarea[aria-label="Message"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(textarea, '/');
        textarea.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: '/',
        }));
        return textarea.value;
      })()`,
      { expectedDocumentId: state.documentId },
    );
  });
  assert.equal(slashValue, "/", "Explorer executeJavaScript must update the Composer");
  assert.equal(await composer.inputValue(), "/", "Composer must preserve the slash query");
  await threadPage.getByRole("listbox", { name: "Skills and commands" }).waitFor();
  await threadPage.getByRole("option", { name: /cdp-check/i }).waitFor();
  await threadPage.getByRole("option", { name: /Channel \/ Channel/i }).waitFor();
  await threadSurface.evaluate(async (element) => {
    const state = await element.getNavigationState();
    await element.executeJavaScript(
      `document.querySelector('#composer-suggestion-cdp-check').click(); true`,
      { expectedDocumentId: state.documentId },
    );
  });
  assert.equal(await composer.inputValue(), "/cdp-check ");
  await threadPage.getByRole("button", { name: "Onboarding", exact: true }).click();
  assert.equal(await composer.inputValue(), "/onboarding ");

  log("sample_thread");
  await selectRadix(threadPage, "Thread agent", "Sample ACP");
  const threadAttempt = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (item) =>
        item.threadId === thread.id &&
        !item.taskId &&
        ["succeeded", "failed", "cancelled"].includes(item.status),
    );
  }, "Sample ACP Thread Attempt");
  assert.equal(threadAttempt.status, "succeeded", threadAttempt.summary);
  assert.equal(threadAttempt.id, initialThreadAttempt.id);
  log("extension_agent_v8_ok");
  await waitFor(
    async () =>
      (await snapshot(page)).messages.some(
        (item) =>
          item.threadId === thread.id &&
          item.role === "assistant" &&
          item.content.includes("THREAD_CDP_OK"),
      ),
    "Sample ACP Thread response",
  );
  assert.ok(
    await page.evaluate(async () => window.__ovuleAgentChunks.length > 2),
    "Thread Agent response must emit multiple incremental output events",
  );
  assert.ok(
    threadAttempt.outputSequence > 1n,
    "Thread Attempt must persist multiple ordered ACP deltas",
  );
  await threadPage
    .locator('[data-message-role="assistant"]', { hasText: "THREAD_CDP_OK" })
    .last()
    .waitFor();
  const threadMessageCards = threadPage.locator(".message-card");
  assert.equal(
    await threadPage.getByRole("button", { name: "Open message telemetry" }).count(),
    await threadMessageCards.count(),
    "every Thread message must expose a telemetry button",
  );
  const responseCard = threadPage
    .locator('[data-message-role="assistant"]', { hasText: "THREAD_CDP_OK" })
    .last();
  await responseCard.getByRole("button", { name: "Open message telemetry" }).click();
  const telemetryDialog = page.getByRole("dialog", { name: "Message telemetry" });
  await telemetryDialog.waitFor();
  assert.equal(
    await threadPage.getByRole("dialog", { name: "Message telemetry" }).count(),
    0,
    "message telemetry must be hosted by the root page, not the Thread Explorer",
  );
  const telemetryText = await telemetryDialog.textContent();
  assert.match(telemetryText ?? "", new RegExp(threadAttempt.id));
  assert.match(telemetryText ?? "", /attempt\.purpose[\s\S]*conversation/);
  assert.match(telemetryText ?? "", /driver[\s\S]*sample/);
  assert.match(telemetryText ?? "", /attempt\/created/);
  assert.match(telemetryText ?? "", /attempt\/succeeded/);
  const telemetryJson = await telemetryDialog.locator("pre").textContent();
  assert.match(telemetryJson ?? "", /"secretStoreAccessed": false/);
  assert.match(telemetryJson ?? "", /"environmentIncluded": false/);
  assert.match(telemetryJson ?? "", /"surface": "thread-explorer"/);
  assert.match(telemetryJson ?? "", /ovule:\/\/-\/thread\?thread=/);
  assert.doesNotMatch(telemetryJson ?? "", /DEEPSEEK_API_KEY|OPENAI_API_KEY/);
  await telemetryDialog.getByRole("button", { name: "Close dialog" }).first().click();
  await telemetryDialog.waitFor({ state: "hidden" });

  log("thread_file_editor_card");
  const fileCardAttemptIds = new Set((await snapshot(page)).attempts.map((attempt) => attempt.id));
  await page.evaluate(
    async ({ threadId }) =>
      (await import("/shell_api.js")).message.sendMessage(threadId, "OFFICE_FILE_PATH_CDP"),
    { threadId: thread.id },
  );
  const fileCardAttempt = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (attempt) =>
        attempt.threadId === thread.id &&
        !fileCardAttemptIds.has(attempt.id) &&
        ["succeeded", "failed", "cancelled"].includes(attempt.status),
    );
  }, "Agent local PDF response");
  assert.equal(fileCardAttempt.status, "succeeded", fileCardAttempt.summary);
  assert.match(fileCardAttempt.output, new RegExp(path.basename(outsideOfficePdf), "i"));
  const localPdfCard = threadPage
    .locator(
      '[data-message-role="assistant"] [data-message-local-file-card="true"], [data-message-role="assistant"] [class*="messageLocalFileCard"]',
    )
    .filter({ hasText: path.basename(outsideOfficePdf) })
    .last();
  await localPdfCard.waitFor();
  assert.match(await localPdfCard.textContent(), new RegExp(escapeRegExp(outsideOfficePdf), "i"));
  await localPdfCard.click();
  const pdfPanel = await panePageFor(browser, "office", thread.id, outsideOfficePdf);
  let pdfRender;
  try {
    pdfRender = await waitFor(
      () =>
        pdfPanel.evaluate(async () => {
          const host = document.querySelector('[data-testid="office-editor"]');
          const canvas = host?.shadowRoot?.querySelector(".office-pdf-page");
          const error = host?.shadowRoot?.querySelector(".office-error")?.textContent;
          if (canvas) return { rendered: true, width: canvas.width, height: canvas.height };
          return error ? { rendered: false, error } : undefined;
        }),
      "PDF File Editor render",
      15_000,
    );
  } catch (error) {
    const diagnostics = await pdfPanel.evaluate(async () => {
      const host = document.querySelector('[data-testid="office-editor"]');
      const editor = host?.shadowRoot?.querySelector("ovule-office-editor");
      return {
        url: location.href,
        body: document.body.innerText.slice(0, 500),
        hostHtml: host?.shadowRoot?.innerHTML.slice(0, 1_000),
        editorHtml: editor?.innerHTML.slice(0, 1_000),
        file: editor?.file
          ? {
              name: editor.file.name,
              extension: editor.file.extension,
              bytes: editor.file.bytes.length,
            }
          : null,
        worker: typeof Worker,
        resources: performance.getEntriesByType("resource").map((entry) => entry.name),
      };
    });
    throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}`);
  }
  assert.equal(pdfRender.rendered, true, pdfRender.error);
  assert.ok(pdfRender.width > 0 && pdfRender.height > 0, "PDF page canvas must be non-empty");
  assert.equal(
    await pdfPanel.locator('button[aria-label="Save Office file"]').isDisabled(),
    true,
    "PDF File Editor must remain read-only",
  );
  assert.equal(
    await pdfPanel.getByText(/must be inside the Thread workspace/i).count(),
    0,
    "absolute Office/PDF paths must not be constrained to the Thread workspace",
  );
  log("thread_file_editor_card_ok");
  if (process.env.OVULE_CDP_SCOPE === "office") {
    process.stdout.write("native_cdp_office=ok csv=true pdf=true agent_file_card=true\n");
    await browser.close();
    process.exit(0);
  }

  log("sample_echarts_block");
  const chartMessage =
    "随便生成一个 ECharts 柱状图，直接使用 Ovule 原生 Message Block，不要创建 HTML 文件。标题写 ECHARTS_CDP_OK。";
  const submittedChartMessage = await threadSurface.evaluate(async (element, message) => {
    const state = await element.getNavigationState();
    const value = await element.executeJavaScript(
      `(() => {
        const textarea = document.querySelector('textarea[aria-label="Message"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(textarea, ${JSON.stringify(message)});
        textarea.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: ${JSON.stringify(message)},
        }));
        return textarea.value;
      })()`,
      { expectedDocumentId: state.documentId },
    );
    await element.executeJavaScript(
      `document.querySelector('button[aria-label="Send message"]')?.click(); true`,
      { expectedDocumentId: state.documentId },
    );
    return value;
  }, chartMessage);
  assert.equal(
    submittedChartMessage,
    chartMessage,
    "the root Explorer API must submit through the attached Thread Composer",
  );
  await waitFor(
    async () =>
      (await snapshot(page)).messages.some(
        (message) =>
          message.threadId === thread.id &&
          message.role === "user" &&
          message.content === chartMessage,
      ),
    "persisted ECharts request",
    30_000,
  );
  const chartPart = await waitFor(async () => {
    const value = await snapshot(page);
    return value.messages
      .filter((message) => message.threadId === thread.id && message.role === "assistant")
      .flatMap((message) => message.parts)
      .find((part) => part.kind === "echarts");
  }, "Sample ACP ECharts Message Block");
  assert.match(chartPart.dataJson ?? "", /ECHARTS_CDP_OK/);
  await page.locator(".thread-row", { hasText: "CDP production thread" }).click();
  await new Promise((resolve) => setTimeout(resolve, 750));
  threadPage = await threadPageFor(browser, thread.id);
  await threadPage.locator("[data-conversation-root]").waitFor();
  await threadPage
    .locator('[data-message-role="assistant"]', { hasText: "Chart rendered." })
    .last()
    .waitFor();
  log(
    `echarts_dom=${JSON.stringify(
      await threadPage.evaluate(async () => ({
        blocks: [...document.querySelectorAll("[data-message-block-kind]")].map((element) => ({
          kind: element.getAttribute("data-message-block-kind"),
          registry: element.getAttribute("data-registry"),
          upgraded: element.getAttribute("data-custom-element"),
          shadow: element.shadowRoot?.innerHTML.slice(0, 300),
        })),
        assistantText: [...document.querySelectorAll('[data-message-role="assistant"]')].map(
          (element) => element.textContent?.slice(0, 200),
        ),
      })),
    )}`,
  );
  const nativeChartState = await waitFor(async () => {
    const activeThreadPage = await threadPageFor(browser, thread.id);
    return activeThreadPage.evaluate(async () => {
      const hosts = document.querySelectorAll('[data-message-block-kind="echarts"]');
      const host = hosts.item(hosts.length - 1);
      if (!(host instanceof HTMLElement)) return undefined;
      const block = host.shadowRoot?.querySelector("[role='img']");
      const canvas = block?.querySelector("canvas");
      return canvas
        ? {
            label: block?.getAttribute("aria-label"),
            width: canvas.clientWidth,
            constructorName: block?.constructor.name,
            registry: host.getAttribute("data-registry"),
            upgraded: host.getAttribute("data-custom-element"),
          }
        : undefined;
    });
  }, "scoped ECharts canvas");
  assert.equal(nativeChartState.label, "ECHARTS_CDP_OK");
  assert.ok(nativeChartState.width > 0, JSON.stringify(nativeChartState));
  assert.equal(nativeChartState.upgraded, "upgraded");
  assert.notEqual(nativeChartState.constructorName, "HTMLElement");
  assert.ok(["scoped", "isolated-tag-fallback"].includes(nativeChartState.registry));
  assert.equal(
    await threadPage.locator('[data-message-role="assistant"]', { hasText: "ovule-block" }).count(),
    0,
    "Message Block control fences must not leak into the Thread",
  );

  log("sample_goal_workflow");
  await threadPage.locator(".topbar").getByRole("button", { name: "Goal", exact: true }).click();
  await setGoalPrompt(threadPage);
  await threadPage.getByRole("button", { name: "Ask Agent to create", exact: true }).click();
  assert.equal(
    await threadPage.getByRole("button", { name: "Workflow", exact: true }).count(),
    0,
    "Conversation Thread must not expose the Workflow titlebar action",
  );
  const cdpWorkflowCard = threadPage.locator(".goal-card").filter({ hasText: "CDP Goal" });
  await cdpWorkflowCard.getByRole("button", { name: "Open Workflow", exact: true }).click();
  const workflowPanel = await panePageFor(browser, "workflow", thread.id);
  assert.equal(
    await workflowPanel.getByRole("textbox", { name: "New node title" }).count(),
    0,
    "Workflow Nodes must be Agent-generated",
  );
  await workflowPanel.evaluate(async () => {
    window.__ovuleWorkflowFrames = [];
    new MutationObserver(() => {
      const element = document.querySelector('[data-testid="workflow-live-attempt"]');
      const sequence = Number(element?.getAttribute("data-output-sequence") ?? 0);
      const text = element?.textContent ?? "";
      if (sequence > 0 && text) window.__ovuleWorkflowFrames.push({ sequence, text });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const workflowTask = await waitFor(async () => {
    const value = await snapshot(page);
    const goal = value.goals.find((item) => item.title === "CDP Goal");
    return goal && value.nodes.find((item) => item.goalId === goal.id && item.kind === "task");
  }, "created Workflow Task");
  const workflowAttempt = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (item) =>
        item.taskId === workflowTask.id &&
        ["succeeded", "failed", "cancelled"].includes(item.status),
    );
  }, "Sample ACP Workflow Attempt");
  assert.equal(workflowAttempt.status, "succeeded", workflowAttempt.summary);
  assert.equal(workflowAttempt.threadId, workflowTask.threadId);
  assert.match(workflowAttempt.summary, /WORKFLOW_CDP_OK/);
  assert.match(workflowAttempt.output, /WORKFLOW_CDP_OK/);
  assert.ok(workflowAttempt.outputSequence > 1n, "Workflow Task must persist multiple deltas");
  const dynamicReplan = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (item) =>
        item.purpose.startsWith("workflow_replan:") &&
        ["succeeded", "failed", "cancelled"].includes(item.status),
    );
  }, "dynamic Workflow replan");
  assert.equal(dynamicReplan.status, "succeeded", dynamicReplan.summary);
  const replannedSnapshot = await snapshot(page);
  assert.equal(
    replannedSnapshot.nodes.find(
      (item) => item.goalId === workflowTask.goalId && item.kind === "gate",
    )?.status,
    "superseded",
  );
  await cdpWorkflowCard.getByText("WORKFLOW_CDP_OK", { exact: true }).waitFor();
  await workflowPanel.getByText(workflowTask.title, { exact: true }).click();
  const workflowNodeThread = await threadPageFor(browser, workflowTask.threadId);
  await workflowNodeThread
    .getByText("WORKFLOW_CDP_OK", { exact: false })
    .last()
    .waitFor({ timeout: 30_000 });
  assert.equal(
    await workflowNodeThread
      .locator(".topbar")
      .getByRole("button", { name: "Goal", exact: true })
      .count(),
    0,
    "Workflow Node Thread must not expose Add Goal",
  );
  await workflowNodeThread.getByRole("button", { name: "Workflow", exact: true }).waitFor();
  await workflowPanel.getByRole("button", { name: "Conversation Thread", exact: true }).click();
  threadPage = await threadPageFor(browser, thread.id);
  if (process.env.OVULE_CDP_SCOPE === "workflow") {
    process.stdout.write("native_cdp_workflow=ok echarts=true workflow=true acp=true\n");
    await browser.close();
    process.exit(0);
  }

  if (process.env.OVULE_CDP_LEGACY_PANES === "1") {
    log("explorer_preview");
    assert.equal(
      await page.locator(".harness-panel").count(),
      1,
      "Workflow should have created the tools panel",
    );
    await page.getByRole("button", { name: "Browser use", exact: true }).click();
    const omnibox = page.getByRole("textbox", { name: "Address or search" });
    assert.equal(await omnibox.inputValue(), "");
    await page.getByText("No page is open", { exact: true }).waitFor();
    assert.equal(await page.locator("explorer[title='Browser']").count(), 0);
    const emptySurface = await page.locator(".browser-surface").evaluate(async (element) => ({
      background: getComputedStyle(element).backgroundColor,
      width: element.clientWidth,
      height: element.clientHeight,
      status: element.querySelector("[role='status']")?.textContent?.trim(),
    }));
    assert.match(emptySurface.status ?? "", /No page is open/);
    assert.ok(emptySurface.width > 300 && emptySurface.height > 300, JSON.stringify(emptySurface));
    const artifactRoot = process.env.OVULE_CDP_ARTIFACTS ?? path.join(workspace, "cdp-artifacts");
    await fs.mkdir(artifactRoot, { recursive: true });
    await page.screenshot({ path: path.join(artifactRoot, "browser-empty.png") });
    await omnibox.fill("preview");
    await page.getByRole("option", { name: /preview.html/ }).waitFor();
    await omnibox.press("ArrowDown");
    assert.match(await omnibox.getAttribute("aria-activedescendant"), /workspace-preview.html/);
    await omnibox.press("Enter");
    await page.getByText(/Loaded .*preview.html/).waitFor();
    const explorer = page.locator("explorer[title='Browser']");
    await explorer.waitFor();
    assert.ok((await explorer.getAttribute("src"))?.startsWith("ovule://-/preview"));
    assert.equal(await page.locator("iframe[title='Local HTML preview']").count(), 0);
    const previewTarget = await waitFor(
      async () =>
        (await cdpTargets()).find(
          (candidate) =>
            candidate.type === "webview" && candidate.url.startsWith("ovule://-/preview"),
        ),
      "Explorer CDP target",
      10_000,
    );
    const previewState = await waitFor(
      async () => {
        const state = await evaluateTarget(
          previewTarget.webSocketDebuggerUrl,
          `({ heading: document.querySelector("#preview h1")?.textContent ?? "", scriptExecuted: document.body.dataset.scriptExecuted ?? null, eventExecuted: document.body.dataset.eventExecuted ?? null, dangerousElements: document.querySelectorAll("#preview script,#preview iframe,#preview object,#preview embed,#preview link[rel~=stylesheet]").length, eventAttribute: document.querySelector("#preview h1")?.getAttribute("onclick") ?? null, shellApi: typeof window.ovule })`,
        );
        return state.heading === "CDP Explorer Preview" ? state : undefined;
      },
      "Explorer preview content",
      10_000,
    );
    assert.notEqual(previewState.scriptExecuted, "yes");
    assert.notEqual(previewState.eventExecuted, "yes");
    assert.equal(previewState.dangerousElements, 0);
    assert.equal(previewState.eventAttribute, null);
    assert.equal(previewState.shellApi, "undefined");
    log("explorer_file_url");
    await omnibox.fill(outsideBrowserUrl);
    await omnibox.press("Enter");
    await page.getByText("Preview WebContents ready", { exact: true }).waitFor();
    await waitFor(
      async () => ((await omnibox.inputValue()) === outsideBrowserUrl ? true : undefined),
      "file URL omnibox",
    );
    assert.equal(
      await page.getByText(/must be inside the Thread workspace/i).count(),
      0,
      "Browser file navigation must not be constrained to the Thread workspace",
    );
    const fileTarget = await waitFor(
      async () =>
        (await cdpTargets()).find(
          (candidate) => candidate.type === "webview" && candidate.url === outsideBrowserUrl,
        ),
      "file URL Explorer target",
      10_000,
    );
    const fileState = await evaluateTarget(
      fileTarget.webSocketDebuggerUrl,
      `({ heading: document.querySelector('h1')?.textContent ?? '', shellApi: typeof window.ovule })`,
    );
    assert.equal(fileState.heading, "FILE_BROWSER_CDP_OK");
    assert.equal(fileState.shellApi, "undefined");
    const channelLauncherUrl = `http://127.0.0.1:${port + 2}/channel-launcher`;
    await omnibox.fill(channelLauncherUrl);
    await omnibox.press("Enter");
    const launcherExplorer = page.locator("explorer[title='Browser']");
    assert.equal(
      await launcherExplorer.getAttribute("navigation"),
      "allow",
      "Workbench Browser Explorers must allow same-tab authorization redirects",
    );
    const authorizedTarget = await waitFor(
      async () =>
        (await cdpTargets()).find(
          (candidate) =>
            candidate.type === "webview" &&
            candidate.url === `http://127.0.0.1:${port + 2}/channel-authorized`,
        ),
      "Channel-style launcher same-tab redirect",
      10_000,
    );
    assert.equal(
      await evaluateTarget(
        authorizedTarget.webSocketDebuggerUrl,
        "document.querySelector('h1')?.textContent",
      ),
      "CHANNEL_LAUNCHER_CDP_OK",
    );
    await waitFor(
      async () => (await omnibox.inputValue()).endsWith("/channel-authorized"),
      "Browser omnibox synchronization after authorization redirect",
      10_000,
    );
    await page.getByText("Preview WebContents ready", { exact: true }).waitFor();
    assert.equal(
      await page.getByText("Preview WebContents failed to load", { exact: true }).count(),
      0,
      "a committed HTTP page must not retain a stale Explorer load failure",
    );
    await omnibox.fill(`http://127.0.0.1:${port + 2}/browser-fail`);
    await omnibox.press("Enter");
    await page.getByText(/Page failed to load: (?:net::)?ERR_[A-Z_]+ \(-?\d+\)/).waitFor();
    await omnibox.fill(`http://127.0.0.1:${port + 2}/channel-authorized`);
    await omnibox.press("Enter");
    await page.getByText("Preview WebContents ready", { exact: true }).waitFor();
    assert.equal(
      await page.getByText(/Page failed to load: (?:net::)?ERR_[A-Z_]+ \(-?\d+\)/).count(),
      0,
      "a successful navigation must clear the previous Explorer failure",
    );
    await omnibox.fill("example.com");
    await omnibox.press("Enter");
    assert.equal(await omnibox.inputValue(), "https://example.com/");
    const onlineTarget = await waitFor(
      async () =>
        (await cdpTargets()).find(
          (candidate) => candidate.type === "webview" && candidate.url === "https://example.com/",
        ),
      "online Explorer target",
      30_000,
    );
    const onlineState = await waitFor(
      async () => {
        const value = await evaluateTarget(
          onlineTarget.webSocketDebuggerUrl,
          `({ title: document.title, heading: document.querySelector("h1")?.textContent ?? "", shellApi: typeof window.ovule })`,
        );
        return value.heading === "Example Domain" ? value : undefined;
      },
      "online Explorer content",
      30_000,
    );
    assert.equal(onlineState.shellApi, "undefined");
    const activeBrowserPanel = page.locator(".harness-tab-content.active");
    const activeBrowserTabId = await page
      .locator('[role="tab"][aria-selected="true"]')
      .getAttribute("id");
    assert.ok(activeBrowserTabId, "the active Browser tab must expose an id");
    const onlineTargetId = onlineTarget.id;
    await page.locator(".harness-panel").getByRole("button", { name: "Hide tools panel" }).click();
    await page.locator(".harness-panel.collapsed").waitFor({ state: "attached" });
    assert.equal(
      await page.locator("explorer[title='Browser']").count(),
      0,
      "hidden Browser panels must release their native Explorer surfaces",
    );
    await page.getByRole("button", { name: "Browser use", exact: true }).click();
    await page.locator(`#${activeBrowserTabId}`).click();
    await page.locator(".harness-panel:not(.collapsed)").waitFor();
    const reopenedExplorer = activeBrowserPanel.locator("explorer[title='Browser']");
    await reopenedExplorer.waitFor();
    const reopenedTarget = await waitFor(
      async () =>
        (await cdpTargets()).find(
          (candidate) =>
            candidate.type === "webview" &&
            candidate.url === "https://example.com/" &&
            candidate.id !== onlineTargetId,
        ),
      "reopened online Explorer target",
      30_000,
    );
    assert.equal(
      await evaluateTarget(
        reopenedTarget.webSocketDebuggerUrl,
        "document.querySelector('h1')?.textContent",
      ),
      "Example Domain",
      "reopened Browser tab must render its original URL",
    );
    await activeBrowserPanel.getByRole("button", { name: "Reload page" }).click();
    await activeBrowserPanel.getByRole("textbox", { name: "Address or search" }).press("Enter");
    await waitFor(
      async () =>
        (await evaluateTarget(reopenedTarget.webSocketDebuggerUrl, "document.readyState")) ===
        "complete",
      "reloaded reopened Explorer",
      30_000,
    );
    await omnibox.fill("ovule omnibox smoke");
    await omnibox.press("Enter");
    assert.equal(
      await omnibox.inputValue(),
      "https://www.bing.com/search?q=ovule%20omnibox%20smoke",
    );
    const browserTabsBeforeRequest = await page.getByRole("tab", { name: /Browser/ }).count();
    await page.locator(".harness-panel").getByRole("button", { name: "Hide tools panel" }).click();
    await page.evaluate(async () =>
      window.dispatchEvent(
        new CustomEvent("ovule:browser-use", { detail: { target: "preview.html" } }),
      ),
    );
    await page.locator(".harness-panel:not(.collapsed)").waitFor();
    assert.equal(
      await page.getByRole("tab", { name: /Browser/ }).count(),
      browserTabsBeforeRequest + 1,
      "Browser-use requests must open independent Browser tabs",
    );
    await page
      .locator(".harness-tab-content.active")
      .getByText(/Loaded .*preview.html/)
      .waitFor();
    assert.equal(
      await page.locator(".harness-tab-content explorer[title='Browser']").count(),
      1,
      "only the active Browser tab should retain an Explorer WebContents surface",
    );
    const requestedBrowserTarget = await waitFor(
      async () =>
        (await cdpTargets()).find(
          (candidate) =>
            candidate.type === "webview" &&
            candidate.url.startsWith("ovule://-/preview") &&
            candidate.id !== reopenedTarget.id,
        ),
      "active Browser tab Explorer target",
      30_000,
    );
    assert.ok(
      !(await cdpTargets()).some((candidate) => candidate.id === reopenedTarget.id),
      "inactive Browser tabs must release their Explorer WebContents targets",
    );
    assert.ok(requestedBrowserTarget.id, "the active Browser tab must expose a CDP target");

    log("terminal");
    const terminalTabsBefore = await page.getByRole("tab", { name: /Terminal/ }).count();
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    const terminalTabs = page.getByRole("tab", { name: /Terminal/ });
    assert.equal(
      await terminalTabs.count(),
      terminalTabsBefore + 2,
      "each New terminal action must add one Terminal tab",
    );
    const firstCreatedTerminal = terminalTabs.nth(terminalTabsBefore);
    const secondCreatedTerminal = terminalTabs.nth(terminalTabsBefore + 1);
    const secondTerminalTitle = await secondCreatedTerminal.textContent();
    const firstTerminalId = (await firstCreatedTerminal.getAttribute("id"))?.replace(
      "workbench-tab-",
      "",
    );
    const secondTerminalId = (await secondCreatedTerminal.getAttribute("id"))?.replace(
      "workbench-tab-",
      "",
    );
    assert.ok(firstTerminalId, "Terminal tab must expose its stable owner id");
    assert.ok(secondTerminalId, "Second Terminal tab must expose its stable owner id");
    assert.equal(await secondCreatedTerminal.getAttribute("aria-selected"), "true");
    const panelSeparator = page.getByRole("separator", { name: "Resize workbench panel" });
    await panelSeparator.waitFor();
    const panelWidthBefore = Number(await panelSeparator.getAttribute("aria-valuenow"));
    const workbenchLayoutBefore = await page.evaluate(async () => {
      const threadSurface = document
        .querySelector('explorer[aria-label="Conversation Thread"]')
        ?.getBoundingClientRect();
      const workbench = document.querySelector(".harness-panel")?.getBoundingClientRect();
      return {
        threadWidth: threadSurface?.width,
        threadRight: threadSurface?.right,
        workbenchLeft: workbench?.left,
      };
    });
    // Exercise the real failure boundary: continuously expand the Workbench
    // well past its allowed width and verify both the DOM track and the native
    // Explorer viewport stop before covering the Thread.
    for (let step = 0; step < 80; step += 1) await panelSeparator.press("ArrowLeft");
    const constrainedPanelWidth = Number(await panelSeparator.getAttribute("aria-valuenow"));
    assert.ok(constrainedPanelWidth > panelWidthBefore);
    assert.ok(constrainedPanelWidth < 720, "panel must stop at the live Thread-width boundary");
    assert.equal(
      await page.evaluate(async () => localStorage.getItem("ovule.workbench.panelWidth")),
      String(constrainedPanelWidth),
    );
    const workbenchLayoutAfter = await waitFor(async () => {
      const layout = await page.evaluate(async () => {
        const threadSurface = document
          .querySelector('explorer[aria-label="Conversation Thread"]')
          ?.getBoundingClientRect();
        const workbench = document.querySelector(".harness-panel")?.getBoundingClientRect();
        return {
          threadWidth: threadSurface?.width,
          threadRight: threadSurface?.right,
          workbenchLeft: workbench?.left,
        };
      });
      return (layout.threadWidth ?? Infinity) < (workbenchLayoutBefore.threadWidth ?? -Infinity)
        ? layout
        : undefined;
    }, "Thread surface resize after Workbench transition");
    assert.ok(
      (workbenchLayoutAfter.threadRight ?? Infinity) <=
        (workbenchLayoutAfter.workbenchLeft ?? -Infinity) + 0.5,
      `Thread surface must not be covered by the Workbench: ${JSON.stringify(workbenchLayoutAfter)}`,
    );
    assert.ok(
      (workbenchLayoutAfter.threadWidth ?? 0) >= 500,
      `Thread must keep its desktop working width: ${JSON.stringify(workbenchLayoutAfter)}`,
    );
    const threadViewportWidth = await waitFor(async () => {
      const width = await threadPage.evaluate(async () => window.innerWidth);
      return Math.abs(width - (workbenchLayoutAfter.threadWidth ?? 0)) <= 2 ? width : undefined;
    }, "native Thread Explorer viewport resize at the Workbench limit");
    assert.ok(
      threadViewportWidth >= 500,
      `Thread Explorer viewport is too narrow: ${threadViewportWidth}`,
    );
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    const tabOverflow = await waitFor(
      async () => {
        const state = await page
          .locator('[role="tablist"][aria-label="Open tools"]')
          .evaluate(async (element) => ({
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            scrollLeft: element.scrollLeft,
          }));
        return state.scrollWidth > state.clientWidth && state.scrollLeft > 0 ? state : undefined;
      },
      "workbench tab overflow and active-tab scroll",
      10_000,
    );
    assert.ok(tabOverflow.scrollWidth > tabOverflow.clientWidth, JSON.stringify(tabOverflow));
    assert.ok(tabOverflow.scrollLeft > 0, JSON.stringify(tabOverflow));
    await secondCreatedTerminal.click();
    const typeTerminal = async (command) => {
      const input = page.getByRole("textbox", { name: "Terminal command" });
      await input.click();
      await page.keyboard.type(command);
    };
    const activeTerminal = () =>
      page.locator('[role="tabpanel"][aria-hidden="false"]').getByTestId("terminal-output");
    const terminalText = () => activeTerminal().locator(".xterm-rows").innerText();
    await typeTerminal("Write-Output TERMINAL_TWO_DRAFT");
    await firstCreatedTerminal.click();
    await typeTerminal("Write-Output TERMINAL_CDP_OK");
    await secondCreatedTerminal.click();
    assert.match(await terminalText(), /PS /, "Terminal must render a PowerShell-style prompt");
    assert.match(await terminalText(), /TERMINAL_TWO_DRAFT/, "Terminal drafts stay isolated");
    await firstCreatedTerminal.click();
    assert.equal(
      normalizeWindowsPath(await activeTerminal().getAttribute("data-workspace")),
      normalizeWindowsPath(canonicalWorkspace),
    );
    await page.getByRole("textbox", { name: "Terminal command" }).press("Enter");
    await waitFor(
      async () =>
        (await snapshot(page)).terminalRuns.some(
          (run) =>
            run.command.includes("TERMINAL_CDP_OK") &&
            run.status === "succeeded" &&
            run.stdout.includes("TERMINAL_CDP_OK"),
        ),
      "Terminal success",
      30_000,
    );
    assert.equal(
      (await snapshot(page)).terminalRuns.find((run) => run.command.includes("TERMINAL_CDP_OK"))
        ?.ownerId,
      firstTerminalId,
      "Terminal run must retain its creating tab owner",
    );
    await typeTerminal("Write-Error TERMINAL_CDP_FAIL; exit 7");
    await page.getByRole("textbox", { name: "Terminal command" }).press("Enter");
    await waitFor(
      async () =>
        (await snapshot(page)).terminalRuns.some(
          (run) =>
            run.command.includes("TERMINAL_CDP_FAIL") &&
            run.status === "failed" &&
            run.exitCode === 7,
        ),
      "Terminal failure",
      30_000,
    );
    await typeTerminal("Start-Sleep -Seconds 20; Write-Output SHOULD_NOT_PRINT");
    await page.getByRole("textbox", { name: "Terminal command" }).press("Enter");
    await page.getByRole("button", { name: "Cancel terminal command" }).waitFor();
    const cancellableRun = await waitFor(
      async () =>
        (await snapshot(page)).terminalRuns.find(
          (run) =>
            run.command.includes("SHOULD_NOT_PRINT") &&
            run.ownerId === firstTerminalId &&
            run.status === "running",
        ),
      "running Terminal ownership",
      10_000,
    );
    assert.equal(cancellableRun.ownerId, firstTerminalId);
    await secondCreatedTerminal.click();
    await typeTerminal("Write-Output TERMINAL_CONCURRENT_OK");
    await page.getByRole("textbox", { name: "Terminal command" }).press("Enter");
    await waitFor(
      async () =>
        (await snapshot(page)).terminalRuns.some(
          (run) =>
            run.command.includes("TERMINAL_CONCURRENT_OK") &&
            run.ownerId === secondTerminalId &&
            run.status === "succeeded",
        ),
      "concurrent Terminal ownership",
      30_000,
    );
    await firstCreatedTerminal.click();
    await page.getByRole("button", { name: "Cancel terminal command" }).click();
    await waitFor(
      async () =>
        (await snapshot(page)).terminalRuns.some(
          (run) => run.command.includes("SHOULD_NOT_PRINT") && run.status === "cancelled",
        ),
      "Terminal cancellation",
      30_000,
    );
    await firstCreatedTerminal.locator("..").getByRole("button").last().click();
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    const newestTerminal = page.getByRole("tab", { name: /Terminal/ }).last();
    assert.notEqual(
      await newestTerminal.textContent(),
      secondTerminalTitle,
      "Terminal tab ordinals must remain unique after closing an older tab",
    );
    await page.locator(".thread-row", { hasText: "CDP production thread" }).click();

    log("markdown_wysiwyg");
    await page.getByRole("button", { name: "Markdown", exact: true }).click();
    await page.getByRole("textbox", { name: "Markdown path" }).fill("report.md");
    await page.getByRole("button", { name: "Open Markdown" }).click();
    const editor = page.locator(".milkdown [contenteditable=true]");
    await editor.waitFor();
    await editor.locator(":scope > p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("WYSIWYG CDP OK");
    await page.getByRole("button", { name: "Save Markdown" }).click();
    await page.getByText(/Saved .*report.md/).waitFor();
    await page.getByRole("button", { name: "Open Markdown" }).click();
    await page
      .locator(".milkdown")
      .getByText(/WYSIWYG CDP OK/, { exact: false })
      .waitFor();
    assert.match(await fs.readFile(path.join(workspace, "report.md"), "utf8"), /WYSIWYG CDP OK/);
  } else {
    process.stdout.write(
      "SKIP legacy-pane-cdp: current /pane Browser, Terminal, and Markdown coverage is provided by the required SPA suite\n",
    );
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".thread-row", { hasText: "CDP production thread" }).click();
  threadPage = await threadPageFor(browser, thread.id);
  await threadPage.locator("[data-conversation-root]").waitFor();
  state = await snapshot(page);
  assert.equal(state.threads.find((item) => item.id === thread.id)?.title, "CDP production thread");
  assert.ok(state.goals.some((item) => item.title === "CDP Goal"));
  assert.ok(state.skills.some((item) => item.id === "cdp-check"));
  assert.ok(state.models.some((item) => item.id === "cdp-model"));
  assert.ok(state.tools.some((item) => item.id === "cdp-shell"));
  assert.ok(state.agents.some((item) => item.id === "cdp-sample"));
  const restoredChartPart = state.messages
    .filter((message) => message.threadId === thread.id && message.role === "assistant")
    .flatMap((message) => message.parts)
    .find((part) => part.kind === "echarts");
  assert.ok(restoredChartPart, "ECharts Message Block must survive reload");
  assert.match(restoredChartPart.dataJson ?? "", /ECHARTS_CDP_OK/);
  let restoredChartDiagnostics;
  await waitFor(async () => {
    const activeThreadPage = await threadPageFor(browser, thread.id);
    restoredChartDiagnostics = await activeThreadPage.evaluate(async () => {
      const hosts = document.querySelectorAll('[data-message-block-kind="echarts"]');
      const host = hosts.item(hosts.length - 1);
      if (!(host instanceof HTMLElement)) return undefined;
      const block = host.shadowRoot?.querySelector("[data-message-block-kind]");
      const surface = block?.querySelector(".ovule-echarts-surface");
      const style = host.shadowRoot?.querySelector("link[rel=stylesheet]");
      return {
        canvas: Boolean(surface?.querySelector("canvas")),
        extensionId: host.getAttribute("data-extension-id"),
        registry: host.getAttribute("data-registry"),
        runtimeTag: host.getAttribute("data-runtime-tag"),
        customElement: host.getAttribute("data-custom-element"),
        fallback: host.shadowRoot?.querySelector(".message-extension-error")?.textContent,
        blockTag: block?.localName,
        blockConstructor: block?.constructor.name,
        blockRect: block?.getBoundingClientRect().toJSON(),
        surfaceRect: surface?.getBoundingClientRect().toJSON(),
        surfaceMinHeight: surface ? getComputedStyle(surface).minHeight : undefined,
        styleUrl: style?.href,
        styleLoaded: Boolean(style?.sheet),
      };
    });
    return restoredChartDiagnostics?.canvas ? restoredChartDiagnostics : undefined;
  }, "restored scoped ECharts canvas").catch((error) => {
    browserDiagnostics.push(`restored-chart:${JSON.stringify(restoredChartDiagnostics)}`);
    throw error;
  });

  log("extension_channel_workflow");
  const existingGoalIds = new Set(state.goals.map((goal) => goal.id));
  const existingAttemptIds = new Set(state.attempts.map((attempt) => attempt.id));
  await page.evaluate(
    async ({ threadId }) =>
      (await import("/shell_api.js")).message.sendMessage(threadId, "/channel 配置 channel bot"),
    { threadId: thread.id },
  );
  const onboardingAttempt = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (attempt) =>
        attempt.threadId === thread.id &&
        !attempt.taskId &&
        !existingAttemptIds.has(attempt.id) &&
        ["succeeded", "failed", "cancelled"].includes(attempt.status),
    );
  }, "Channel extension Goal derivation");
  assert.equal(onboardingAttempt.status, "succeeded", onboardingAttempt.summary);
  state = await snapshot(page);
  const channelGoal = state.goals.find((goal) => !existingGoalIds.has(goal.id));
  assert.ok(channelGoal, "The /channel extension command must create a Goal");
  assert.equal(channelGoal.title, "配置 Channel Bot");
  const channelNodes = state.nodes.filter((node) => node.goalId === channelGoal.id);
  assert.equal(channelNodes.length, 6, "The manifest fallback must create the complete Workflow");
  assert.ok(
    channelNodes.every((node) => [...node.title].length <= 256),
    "derived Workflow node titles must be bounded by Unicode characters",
  );
  const channelStatusPart = state.messages
    .filter((message) => message.threadId === thread.id && message.role === "assistant")
    .flatMap((message) => message.parts)
    .find((part) => part.kind === "channel-setup");
  assert.ok(channelStatusPart, "The /channel extension command must emit its status Message Block");
  assert.ok(state.skills.some((skill) => skill.id === "channel-channel" && skill.enabled));
  assert.ok(state.skills.some((skill) => skill.id === "channel-cli" && skill.enabled));
  await page.locator(".thread-row", { hasText: "CDP production thread" }).click();
  await new Promise((resolve) => setTimeout(resolve, 750));
  threadPage = await threadPageFor(browser, thread.id);
  await threadPage.locator("[data-conversation-root]").waitFor();
  const channelWorkflowCard = threadPage.locator(".goal-card").filter({
    hasText: "配置 Channel Bot",
  });
  const parallelBranches = channelWorkflowCard.locator(
    '[data-workflow-level="2"] [role="listitem"]',
  );
  assert.equal(
    await parallelBranches.count(),
    2,
    "independent Channel preparation tasks must render as parallel branches",
  );
  const workflowGeometry = await channelWorkflowCard.evaluate(async (card) => {
    const box = (selector) => {
      const element = card.querySelector(selector);
      if (!(element instanceof HTMLElement)) return undefined;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        centerY: rect.y + rect.height / 2,
      };
    };
    const parallel = [...card.querySelectorAll('[data-workflow-level="2"] [role="listitem"]')]
      .filter((element) => element instanceof HTMLElement)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          centerY: rect.y + rect.height / 2,
        };
      });
    return {
      before: box('[data-workflow-level="1"] [role="listitem"]'),
      parallel,
      after: box('[data-workflow-level="3"] [role="listitem"]'),
    };
  });
  assert.equal(workflowGeometry.parallel.length, 2);
  const [upperBranch, lowerBranch] = workflowGeometry.parallel;
  assert.ok(
    Math.abs(upperBranch.x - lowerBranch.x) <= 1 &&
      Math.abs(upperBranch.width - lowerBranch.width) <= 1,
    `parallel Workflow Nodes must share one aligned column: ${JSON.stringify(workflowGeometry)}`,
  );
  assert.ok(
    lowerBranch.y >= upperBranch.y + upperBranch.height,
    `parallel Workflow Nodes must not overlap: ${JSON.stringify(workflowGeometry)}`,
  );
  const branchCenter = (upperBranch.centerY + lowerBranch.centerY) / 2;
  assert.ok(
    workflowGeometry.before &&
      workflowGeometry.after &&
      Math.abs(workflowGeometry.before.centerY - branchCenter) <= 1 &&
      Math.abs(workflowGeometry.after.centerY - branchCenter) <= 1,
    `Workflow fork and join columns must align to the branch center: ${JSON.stringify(workflowGeometry)}`,
  );
  const channelBlockState = await waitFor(async () => {
    const activeThreadPage = await threadPageFor(browser, thread.id);
    return activeThreadPage.evaluate(async () => {
      const hosts = document.querySelectorAll('[data-message-block-kind="channel-setup"]');
      const host = hosts.item(hosts.length - 1);
      if (!(host instanceof HTMLElement)) return undefined;
      return {
        connect: host.shadowRoot?.textContent?.includes("Connect selected bot") === true,
        select: Boolean(host.shadowRoot?.querySelector("select")),
        add: host.shadowRoot?.textContent?.includes("Add bot") === true,
      };
    });
  }, "Channel status extension block");
  assert.deepEqual(channelBlockState, { connect: true, select: true, add: true });
  const activeChannelThreadPage = await threadPageFor(browser, thread.id);
  const addBotResult = await activeChannelThreadPage.evaluate(async () => {
    const hosts = document.querySelectorAll('[data-message-block-kind="channel-setup"]');
    const host = hosts.item(hosts.length - 1);
    if (!(host instanceof HTMLElement)) throw new Error("Channel status block is unavailable");
    let dialogCalled = false;
    const originalPrompt = window.prompt;
    window.prompt = () => {
      dialogCalled = true;
      throw new Error("Add bot must not open a native modal dialog");
    };
    try {
      const button = [...(host.shadowRoot?.querySelectorAll("button") ?? [])].find(
        (candidate) => candidate.textContent?.trim() === "Add bot",
      );
      button?.click();
      const input = host.shadowRoot?.querySelector("input[name='connection-id']");
      return {
        dialogCalled,
        inputVisible: input instanceof HTMLInputElement,
        value: input instanceof HTMLInputElement ? input.value : "",
        stillConnected: host.isConnected,
      };
    } finally {
      window.prompt = originalPrompt;
    }
  });
  assert.deepEqual(addBotResult, {
    dialogCalled: false,
    inputVisible: true,
    value: "channel-2",
    stillConnected: true,
  });
  assert.equal(
    activeChannelThreadPage.isClosed(),
    false,
    "Add bot must keep the Thread Explorer alive",
  );
  const channelRegistration = await page.evaluate(async () =>
    (await import("/shell_api.js")).extensions.runExtensionAction({
      extensionId: "io.ovule.channel.sample",
      actionId: "connect-existing",
      connectionId: "smoke-channel",
    }),
  );
  assert.match(channelRegistration.openUrl ?? "", /^https:\/\/open\.global\.cn\//);
  const channelRoundTrip = await waitFor(
    async () => {
      const statusResult = await page.evaluate(async () => {
        try {
          return await (
            await import("/shell_api.js")
          ).extensions.runExtensionAction({
            extensionId: "io.ovule.channel.sample",
            actionId: "refresh",
            connectionId: "smoke-channel",
          });
        } catch {
          return undefined;
        }
      });
      if (!statusResult) return undefined;
      const overview = JSON.parse(statusResult.dataJson);
      const connection = overview.connections.find(
        (candidate) => candidate.connectionId === "smoke-channel",
      );
      const value = await snapshot(page);
      const channelThread = value.threads.find(
        (candidate) => candidate.title === "Channel · Smoke Owner",
      );
      const reply = channelThread
        ? value.messages.find(
            (message) =>
              message.threadId === channelThread.id &&
              message.role === "assistant" &&
              message.content.includes("CHANNEL_AGENT_ROUND_TRIP_OK"),
          )
        : undefined;
      return connection?.ownerPaired && connection?.lastDeliveryAtMs && reply
        ? { connection, channelThread, reply }
        : undefined;
    },
    "Channel pairing, inbound Agent turn, and durable outbox delivery",
    90_000,
  );
  assert.equal(channelRoundTrip.connection.connected, true);
  assert.equal(channelRoundTrip.connection.provisioned, true);
  assert.ok(channelRoundTrip.connection.lastMessageAtMs);
  assert.ok(channelRoundTrip.connection.lastAgentAttemptAtMs);
  assert.ok(channelRoundTrip.connection.lastDeliveryAtMs);
  log("channel_round_trip_ok");

  log("deepseek_native_thread");
  const deepSeekProfile = configuredOnboarding.agents.find(
    (agent) =>
      agent.driver === "ovule" &&
      agent.enabled &&
      agent.modelId === "onboarding-deepseek-deepseek-v4-special",
  );
  assert.ok(deepSeekProfile, "DeepSeek Ovule profile must be configured");
  let deepSeekSnapshot = await page.evaluate(
    async ({ workspacePath }) =>
      (await import("/shell_api.js")).workspace.createThread({ workspacePath }),
    { workspacePath: canonicalWorkspace },
  );
  const deepSeekThread = deepSeekSnapshot.threads.at(-1);
  assert.ok(deepSeekThread, "DeepSeek Thread must be created");
  deepSeekSnapshot = await page.evaluate(
    async ({ threadId, agentId }) =>
      (await import("/shell_api.js")).message.selectAgent(threadId, agentId),
    { threadId: deepSeekThread.id, agentId: deepSeekProfile.id },
  );
  const deepSeekAttemptIds = new Set(deepSeekSnapshot.attempts.map((attempt) => attempt.id));
  await page.evaluate(
    async ({ threadId }) =>
      (await import("/shell_api.js")).message.sendMessage(threadId, "DEEPSEEK_NATIVE_CDP"),
    { threadId: deepSeekThread.id },
  );
  const deepSeekAttempt = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (attempt) =>
        attempt.threadId === deepSeekThread.id &&
        !deepSeekAttemptIds.has(attempt.id) &&
        ["succeeded", "failed", "cancelled"].includes(attempt.status),
    );
  }, "Host-native DeepSeek Thread response");
  assert.equal(deepSeekAttempt.status, "succeeded", deepSeekAttempt.summary);
  assert.match(deepSeekAttempt.summary, /DEEPSEEK_NATIVE_CDP_OK/);
  assert.match(deepSeekAttempt.summary, /CRD_COMPUTER_USE_CDP_OK/);

  log("ollama_thread");
  const discovered = await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.ollamaModels(),
  );
  const ollamaModel = discovered.models.find(
    (item) => item.available && item.remoteId === "ollama:smollm2:135m",
  );
  assert.ok(ollamaModel, "Ollama model must remain discoverable");
  const pullStarted = await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.pullOllamaModel("smollm2:135m"),
  );
  assert.equal(pullStarted.status, "pulling");
  const pullFinished = await waitFor(async () => {
    const jobs = await page.evaluate(async () =>
      (await import("/shell_api.js")).setup.ollamaModelJobs(),
    );
    return jobs.find(
      (item) => item.model === "smollm2:135m" && ["succeeded", "failed"].includes(item.status),
    );
  }, "Ollama model pull");
  assert.equal(pullFinished.status, "succeeded", pullFinished.error);
  let ollamaSnapshot = await page.evaluate(
    async ({ workspacePath }) =>
      (await import("/shell_api.js")).workspace.createThread({ workspacePath }),
    { workspacePath: canonicalWorkspace },
  );
  const ollamaThread = ollamaSnapshot.threads.at(-1);
  assert.ok(ollamaThread, "Ollama test Thread must be created");
  ollamaSnapshot = await page.evaluate(
    async ({ threadId, modelId }) =>
      (await import("/shell_api.js")).setup.completeOnboarding({
        threadId,
        agents: [{ id: "ovule", label: "Ovule", driver: "ovule", modelId }],
        defaultAgentId: "ovule",
      }),
    { threadId: ollamaThread.id, modelId: ollamaModel.id },
  );
  assert.equal(ollamaSnapshot.threads.find((item) => item.id === ollamaThread.id)?.agent, "ovule");
  await page.evaluate(async () => {
    window.__ovuleAgentChunks = [];
    window.tuffite.addEventListener("channel", (event) => {
      if (event.detail.channel === "ovule:agent-output") {
        window.__ovuleAgentChunks.push(new TextDecoder().decode(event.detail.data));
      }
    });
  });
  const chunkCountBeforeOllama = await page.evaluate(async () => window.__ovuleAgentChunks.length);
  await page.evaluate(
    async ({ threadId }) =>
      (await import("/shell_api.js")).message.sendMessage(threadId, "Reply in Markdown"),
    { threadId: ollamaThread.id },
  );
  const ollamaAttempt = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (attempt) =>
        attempt.threadId === ollamaThread.id &&
        !attempt.taskId &&
        ["succeeded", "failed", "cancelled"].includes(attempt.status),
    );
  }, "Ollama Thread Attempt");
  assert.equal(ollamaAttempt.status, "succeeded", ollamaAttempt.summary);
  assert.match(ollamaAttempt.output, /OLLAMA_CDP_OK/);
  assert.match(ollamaAttempt.output, /CRD_COMPUTER_USE_CDP_OK/);
  assert.ok(ollamaAttempt.outputSequence > 1n, "Ollama output must persist incrementally");
  assert.ok(
    (await page.evaluate(async () => window.__ovuleAgentChunks.length)) > chunkCountBeforeOllama,
    "Ollama Worker must emit streaming Agent output events",
  );
  await page.evaluate(async () =>
    (await import("/shell_api.js")).setup.removeExtension("io.ovule.channel.sample"),
  );
  const afterChannelRemoval = await snapshot(page);
  assert.ok(
    !afterChannelRemoval.skills.some((skill) =>
      ["channel-channel", "channel-cli"].includes(skill.id),
    ),
    "removing channel-sample must remove its contributed Skills",
  );
  const catalogAfterChannelRemoval = await page.evaluate(async () =>
    (await import("/shell_api.js")).extensions.extensionCatalog(),
  );
  assert.ok(
    !catalogAfterChannelRemoval.extensions.some(
      (extension) => extension.id === "io.ovule.channel.sample",
    ),
  );
  assert.ok(!catalogAfterChannelRemoval.slashCommands.some((command) => command.id === "channel"));
  assert.ok(
    !(
      await page.evaluate(async () => (await import("/shell_api.js")).setup.toolchainStatus())
    ).some((toolchain) => toolchain.id === "channel-cli"),
    "removing channel-sample must remove its Toolchain contribution",
  );
  const suggestionPage = await threadPageFor(browser, thread.id);
  await waitFor(
    async () =>
      (await suggestionPage.locator("[data-suggestion='goal']").count()) === 1 || undefined,
    "Composer suggestion refresh after Channel removal",
  );
  assert.equal(
    await suggestionPage
      .locator(
        "[data-suggestion='channel'], [data-suggestion='channel-channel'], [data-suggestion='channel-cli']",
      )
      .count(),
    0,
    "removed channel-sample commands and Skills must disappear from the Composer",
  );
  process.stdout.write(
    `native_cdp_smoke=ok sample_download=true sample_install=true sample_thread=true sample_spinner=true sample_echarts=true custom_element=true registry=${nativeChartState.registry} browser_empty=true ollama_discovery=true ollama_thread=true native_crd_computer_use=true goal_workflow=true channel_download=true channel_install=true channel_pairing=true channel_inbound=true channel_agent=true channel_outbox=true channel_delivery=true channel_remove_cleanup=true extension_channel=true channel_status_block=true global_onboarding_generic=true catalog_skills_tools_models_agents=true extensions=true explorer=true terminal=true markdown=true\n`,
  );
} catch (error) {
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => isOvuleResource(candidate.url(), "index.html"));
  if (page) {
    const artifactRoot = process.env.OVULE_CDP_ARTIFACTS ?? path.join(workspace, "cdp-artifacts");
    await fs.mkdir(artifactRoot, { recursive: true });
    await page
      .screenshot({ path: path.join(artifactRoot, "failure.png"), fullPage: true })
      .catch(() => {});
    const diagnosticValue = async (operation, fallback) =>
      Promise.race([
        operation().catch(() => fallback),
        new Promise((resolve) => setTimeout(() => resolve(fallback), 2_000)),
      ]);
    const diagnostic = {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      url: page.url(),
      title: await diagnosticValue(() => page.title(), ""),
      body: await diagnosticValue(() => page.locator("body").innerText(), ""),
      html: await diagnosticValue(() => page.content(), ""),
      browserDiagnostics,
    };
    await fs.writeFile(
      path.join(artifactRoot, "failure.json"),
      JSON.stringify(diagnostic, null, 2),
    );
    process.stderr.write(`cdp_failure_artifacts=${artifactRoot}\n`);
  }
  throw error;
} finally {
  await browser.close();
}

function isNearWhite(color) {
  const oklch = color.match(/^oklch\(([\d.]+)/);
  if (oklch) return Number(oklch[1]) >= 0.98;
  const oklab = color.match(/^oklab\(([\d.]+)/);
  if (oklab) return Number(oklab[1]) >= 0.98;
  const srgb = color.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s+\/\s+[\d.]+)?\)$/);
  if (srgb) return srgb.slice(1).every((channel) => Number(channel) >= 0.98);
  const rgb = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return Boolean(rgb && rgb.slice(1).every((channel) => Number(channel) >= 250));
}

async function setGoalPrompt(threadPage) {
  await threadPage.getByRole("textbox", { name: "Goal prompt" }).evaluate(async (input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(
      input,
      "Create CDP Goal and return the exact marker WORKFLOW_CDP_OK without modifying files.",
    );
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  });
}

async function verifyGoalWorkflow({ browser, page, threadPage, thread }) {
  log("sample_goal_workflow");
  await threadPage.locator(".topbar").getByRole("button", { name: "Goal", exact: true }).click();
  await setGoalPrompt(threadPage);
  await threadPage.getByRole("button", { name: "Ask Agent to create", exact: true }).click();
  const cdpWorkflowCard = threadPage.locator(".goal-card").filter({ hasText: "CDP Goal" });
  await cdpWorkflowCard.waitFor({ timeout: 30_000 });
  assert.equal(
    await threadPage
      .locator(".topbar")
      .getByRole("button", { name: "Workflow", exact: true })
      .count(),
    0,
  );
  await cdpWorkflowCard.getByRole("button", { name: "Open Workflow", exact: true }).click();
  const workflowPanel = await panePageFor(browser, "workflow", thread.id);
  assert.equal(
    await workflowPanel.getByRole("textbox", { name: "New node title" }).count(),
    0,
    "Workflow Nodes must be Agent-generated",
  );
  const workflowTask = await waitFor(async () => {
    const value = await snapshot(page);
    const goal = value.goals.find((item) => item.title === "CDP Goal");
    return goal && value.nodes.find((item) => item.goalId === goal.id && item.kind === "task");
  }, "Agent-created Workflow Task");
  const workflowAttempt = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (item) =>
        item.taskId === workflowTask.id &&
        ["succeeded", "failed", "cancelled"].includes(item.status),
    );
  }, "automatically dispatched Workflow Task");
  assert.equal(workflowAttempt.status, "succeeded", workflowAttempt.summary);
  assert.equal(workflowAttempt.threadId, workflowTask.threadId);
  assert.match(workflowAttempt.output, /WORKFLOW_CDP_OK/);
  const dynamicReplan = await waitFor(async () => {
    const value = await snapshot(page);
    return value.attempts.find(
      (item) =>
        item.purpose.startsWith("workflow_replan:") &&
        ["succeeded", "failed", "cancelled"].includes(item.status),
    );
  }, "dynamic Workflow replan");
  assert.equal(dynamicReplan.status, "succeeded", dynamicReplan.summary);
  const replanned = await snapshot(page);
  assert.equal(
    replanned.nodes.find((item) => item.goalId === workflowTask.goalId && item.kind === "gate")
      ?.status,
    "superseded",
  );
  await workflowPanel.getByText(workflowTask.title, { exact: true }).click();
  const workflowNodeThread = await threadPageFor(browser, workflowTask.threadId);
  await workflowNodeThread
    .getByText("WORKFLOW_CDP_OK", { exact: false })
    .last()
    .waitFor({ timeout: 30_000 });
  assert.equal(
    await workflowNodeThread
      .locator(".topbar")
      .getByRole("button", { name: "Goal", exact: true })
      .count(),
    0,
  );
  await workflowNodeThread
    .locator(".topbar")
    .getByRole("button", { name: "Workflow", exact: true })
    .waitFor();
}

function isOvuleResource(value, filename) {
  try {
    const url = new URL(value);
    const expectedPath =
      filename === "thread.html" ? "/thread" : filename === "pane.html" ? "/pane" : "/main";
    return url.protocol === "ovule:" && url.host === "-" && url.pathname === expectedPath;
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

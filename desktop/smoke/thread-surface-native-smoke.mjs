import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const port = Number(process.env.OVULE_CDP_PORT ?? "9247");
let browser;
try {
  phase("connect-cdp");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
  phase("find-outer-app");
  let app;
  try {
    app = await waitFor(async () => {
      const candidates = browser
        .contexts()
        .flatMap((context) => context.pages())
        .filter((page) => isOvuleResource(page.url(), "index.html"));
      for (const candidate of candidates) {
        if (
          await candidate
            .evaluate(
              async () => typeof (await import("/shell_api.js")).workspace.snapshot === "function",
            )
            .catch(() => false)
        )
          return candidate;
      }
      return undefined;
    });
  } catch (error) {
    const diagnostics = await Promise.all(
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .map(async (page) => ({
          url: page.url(),
          state: await page
            .evaluate(async () => ({
              readyState: document.readyState,
              title: document.title,
              bodyText: document.body?.innerText.slice(0, 240),
              hasWorkspaceApi:
                typeof (await import("/shell_api.js")).workspace.snapshot === "function",
            }))
            .catch((cause) => ({ evaluationError: String(cause) })),
        })),
    );
    console.error("[thread-surface-smoke] outer-app diagnostics", JSON.stringify(diagnostics));
    throw error;
  }
  assert.ok(app, "Ovule outer App target was not found");
  app.setDefaultTimeout(15_000);
  app.setDefaultNavigationTimeout(15_000);
  phase("prepare-workspace");
  await app.evaluate(async () => {
    localStorage.setItem("ovule.onboarding.dismissed", "true");
    const snapshot = await (await import("/shell_api.js")).workspace.snapshot();
    if (!snapshot.threads.length) await (await import("/shell_api.js")).workspace.createThread({});
  });
  phase("reload-outer-app");
  await app.reload();
  phase("wait-thread-element");
  await app.locator('explorer[aria-label="Conversation Thread"]').waitFor({
    state: "attached",
    timeout: 30_000,
  });

  const targets = async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    assert.equal(response.ok, true);
    return response.json();
  };
  phase("find-first-thread-target");
  const firstThreadTarget = await waitFor(async () =>
    (await targets()).find((target) => isOvuleResource(target.url, "thread.html")),
  );
  const firstThreadUrl = firstThreadTarget.url;
  const firstThreadId = new URL(firstThreadUrl).searchParams.get("thread");
  assert.ok(firstThreadId, "Initial Thread surface did not bind a Thread");

  phase("attach-first-thread");
  let thread = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => isOvuleResource(page.url(), "thread.html")),
  );
  thread.setDefaultTimeout(15_000);
  thread.setDefaultNavigationTimeout(15_000);
  phase("verify-thread-ui");
  const attachWorkspaceButton = thread.getByRole("button", {
    name: "Attach workspace",
    exact: true,
  });
  await attachWorkspaceButton.click();
  const emptyWorkspaceMenu = thread.locator('[role="menu"][aria-label="Select workspaces"]');
  await emptyWorkspaceMenu.waitFor();
  assert.equal(await emptyWorkspaceMenu.locator("[data-remote-host-workspaces]").count(), 0);
  assert.equal(
    await emptyWorkspaceMenu
      .locator("[data-workspace-menu-actions]")
      .getAttribute("data-separated"),
    null,
    "workspace actions must not render a separator without Remote Hosts",
  );
  await attachWorkspaceButton.click();
  const manageButton = app.getByRole("button", { name: "Settings", exact: true });
  assert.equal(
    await app.getByRole("button", { name: "Hosts", exact: true }).count(),
    0,
    "Hosts must live inside Manage instead of the titlebar",
  );
  await manageButton.click();
  const manageSurface = app.locator('[data-framework-content="settings"]');
  await manageSurface.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await manageSurface.getByRole("button", { name: "Hosts", exact: true }).click();
  const hostsSurface = app.locator('[data-framework-content="settings"]');
  await hostsSurface.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await hostsSurface
    .locator("[data-catalog-section-header]")
    .getByRole("heading", { name: "Hosts", exact: true })
    .waitFor();
  await hostsSurface.getByRole("heading", { name: "Paired Devices", exact: true }).waitFor();
  const pairedDevicesTab = hostsSurface.getByRole("tab", { name: /Paired Devices/ });
  const remoteHostsTab = hostsSurface.getByRole("tab", { name: /Remote Hosts/ });
  const sharedHost = await app.evaluate(async (threadId) => {
    return (await import("/shell_api.js")).workspace.shareCurrentWorkspaceLink(threadId);
  }, firstThreadId);
  const sharedWorkspace = sharedHost.workspaces.at(-1);
  assert.ok(sharedWorkspace, "sharing the current Workspace must publish a Host resource");
  phase(`shared-root=${sharedWorkspace.root}`);
  assert.match(
    sharedWorkspace.root,
    process.platform === "win32" ? /^[a-z]:[\\/]/i : /^\//,
    "current Workspace share must resolve to an absolute path",
  );
  await hostsSurface
    .getByRole("button", { name: "Reset this Host Link identity", exact: true })
    .click();
  const resetHostDialog = app.getByRole("alertdialog");
  await resetHostDialog
    .getByRole("heading", { name: "Reset this Host Link identity?", exact: true })
    .waitFor();
  await resetHostDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await resetHostDialog.waitFor({ state: "hidden" });
  const pairLink = hostsSurface.getByRole("textbox", { name: "This Host pair link" });
  await hostsSurface.getByRole("button", { name: "Show pair link" }).click();
  const generatedLink = await pairLink.inputValue();
  assert.ok(generatedLink.startsWith("ovule://app/hosts/link?"));
  assert.equal(new URL(generatedLink).searchParams.has("protocol"), false);
  const clientId = await app.evaluate(async (link) => {
    const url = new URL(link);
    const encoded = url.searchParams.get("address").replaceAll("-", "+").replaceAll("_", "/");
    const address = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    const tested = await (
      await import("/shell_api.js")
    ).workspace.testWorkspaceLink(address, url.searchParams.get("share"));
    return tested.clientId;
  }, generatedLink);
  assert.equal(
    await hostsSurface.getByRole("button", { name: "Copy this Host pair link" }).count(),
    1,
  );
  assert.equal(await pairLink.getAttribute("type"), "text");
  await remoteHostsTab.click();
  await hostsSurface.getByRole("heading", { name: "Remote Hosts", exact: true }).waitFor();
  await hostsSurface.getByLabel("Ovule Link").fill(generatedLink);
  await hostsSurface.getByRole("button", { name: "Continue", exact: true }).click();
  await hostsSurface.getByRole("button", { name: "Connect", exact: true }).click();
  const pairingInput = hostsSurface.getByLabel("Pairing code", { exact: true });
  const connectionState = await waitFor(async () => {
    if (await pairingInput.isVisible().catch(() => false)) return "pairing";
    if (
      await hostsSurface
        .getByText(/Remote Host connected/)
        .isVisible()
        .catch(() => false)
    ) {
      return "connected";
    }
    return undefined;
  });
  if (connectionState === "pairing") {
    assert.equal(
      /\b\d{6}\b/.test((await hostsSurface.locator(".workspace-status").textContent()) ?? ""),
      false,
      "Client status must not reveal the Host pairing code",
    );
    await pairedDevicesTab.click();
    const hostCode = hostsSurface.getByLabel("Host pairing code");
    await hostCode.waitFor({ timeout: 10_000 });
    const shownCode = (await hostCode.textContent()).trim();
    assert.match(shownCode, /^\d{6}$/);
    await remoteHostsTab.click();
    await pairingInput.waitFor();
    await pairingInput.fill(shownCode);
    await hostsSurface.getByRole("button", { name: "Pair & connect" }).click();
    await hostsSurface.getByText(/Remote Host connected/).waitFor({ timeout: 30_000 });
  }
  await app.evaluate(
    async ({ clientId, workspaceIds, agentIds }) => {
      await (
        await import("/shell_api.js")
      ).workspace.setWorkspaceLinkAccess({
        clientId,
        workspaceIds,
        agentIds,
      });
    },
    {
      clientId,
      workspaceIds: sharedHost.workspaces.map((workspace) => workspace.shareId),
      agentIds: sharedHost.agents.map((agent) => agent.id),
    },
  );
  const remoteHosts = hostsSurface
    .getByRole("heading", { name: "Remote Hosts", exact: true })
    .locator("xpath=ancestor::section[1]");
  await remoteHosts
    .getByRole("button", { name: /Refresh / })
    .first()
    .click();
  await attachWorkspaceButton.click();
  const remoteWorkspaceMenu = thread.locator('[role="menu"][aria-label="Select workspaces"]');
  await remoteWorkspaceMenu.locator("[data-remote-host-workspaces]").waitFor();
  assert.equal(
    await remoteWorkspaceMenu
      .locator("[data-workspace-menu-actions]")
      .getAttribute("data-separated"),
    "true",
  );
  await attachWorkspaceButton.click();
  await remoteHosts.getByRole("button", { name: "Bind", exact: true }).first().click();
  await attachWorkspaceButton.click();
  await thread.locator('[role="menu"][aria-label="Select workspaces"]').waitFor();
  await thread
    .getByText(/TUNNEL .* Attached/)
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => undefined);
  await thread.keyboard.press("Escape");
  await app.locator('[data-framework-content="settings"]').waitFor();
  await manageButton.click();
  await app.locator("[data-framework-content]").waitFor({ state: "hidden" });
  const messageInput = thread.getByRole("textbox", { name: "Message" });
  await messageInput.waitFor({ timeout: 30_000 });
  const hostSelector = thread.getByRole("combobox", {
    name: "Conversation Thread Host",
    exact: true,
  });
  const agentSelector = thread.getByRole("button", {
    name: "Conversation Thread Agent",
    exact: true,
  });
  await hostSelector.waitFor();
  await agentSelector.waitFor();
  const messageBox = await messageInput.boundingBox();
  const agentBox = await agentSelector.boundingBox();
  assert.ok(
    messageBox && agentBox && agentBox.y > messageBox.y,
    "Agent selector must be in composer",
  );
  assert.equal(
    await thread.getByText(/Enter to send|Shift\+Enter for newline/).count(),
    0,
    "composer must not render the old shortcut hint",
  );
  console.log("remote_host_ui=ok host_selector=titlebar agent_selector=composer");
  assert.equal(await thread.locator(".conversation").count(), 1);
  assert.equal(await thread.locator(".composer").count(), 1);
  assert.equal(await app.locator(".conversation,.composer").count(), 0);
  const composerLayout = await thread.evaluate(async () => {
    const conversation = document.querySelector(".conversation")?.getBoundingClientRect();
    const timeline = document
      .querySelector('[data-testid="thread-timeline"]')
      ?.getBoundingClientRect();
    const composer = document.querySelector(".composer")?.getBoundingClientRect();
    if (!conversation || !timeline || !composer) return undefined;
    return {
      viewportHeight: window.innerHeight,
      conversationBottom: conversation.bottom,
      timelineBottom: timeline.bottom,
      composerTop: composer.top,
      composerBottom: composer.bottom,
    };
  });
  assert.ok(composerLayout, "Thread timeline and composer bounds are unavailable");
  assert.equal(
    await thread
      .locator(".topbar-primary-action")
      .evaluateAll((buttons) =>
        buttons.every(
          (button) =>
            getComputedStyle(button).color ===
              getComputedStyle(document.documentElement).getPropertyValue("--text").trim() ||
            getComputedStyle(button).color !==
              getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
        ),
      ),
    true,
    "Workflow and Goal actions must use the normal foreground color",
  );
  assert.ok(
    composerLayout.timelineBottom <= composerLayout.composerTop - 10,
    `Composer must reserve space below the timeline: ${JSON.stringify(composerLayout)}`,
  );
  assert.ok(
    composerLayout.composerBottom <= composerLayout.conversationBottom + 0.5 &&
      composerLayout.conversationBottom <= composerLayout.viewportHeight + 0.5,
    `Composer must stay at the bottom of the Thread surface: ${JSON.stringify(composerLayout)}`,
  );
  assert.equal(
    await thread.evaluate(async () => typeof (await import("/shell_api.js")).workspace.snapshot),
    "function",
    "Thread Explorer did not receive its capability-gated ShellAPI",
  );

  phase("verify-shared-partition");
  const outerSurface = app.locator('explorer[aria-label="Conversation Thread"]');
  const outerState = await outerSurface.evaluate(async (element) => element.getNavigationState());
  assert.equal(outerState.storagePartition.requested, "");
  assert.equal(outerState.storagePartition.mode, "shared");
  assert.equal(outerState.storagePartition.shared, true);
  assert.equal(outerState.storagePartition.createdDomain, outerState.storagePartition.domain);
  assert.equal(outerState.storagePartition.createdName, outerState.storagePartition.name);
  assert.equal(outerState.storagePartition.createdInMemory, outerState.storagePartition.inMemory);

  phase("verify-workbench-rpc");
  let conversationAdd = thread.locator(".topbar").getByRole("button", { name: "Add tab" });
  const artifactsBeforeConversationAdd = await app.locator(".artifact-row").count();
  await conversationAdd.hover();
  await thread.getByRole("tooltip", { name: "Add tab" }).waitFor();
  await conversationAdd.click();
  await thread.locator(".topbar-add-dropdown").waitFor();
  assert.equal(await app.locator(".artifact-row").count(), artifactsBeforeConversationAdd);
  await thread.locator(".topbar").press("Escape");
  assert.equal(await thread.locator(".topbar-add-dropdown").count(), 0);
  assert.equal(
    await thread.locator(".topbar").getByRole("button", { name: "Workflow", exact: true }).count(),
    0,
  );
  assert.equal(
    await thread.locator(".topbar").getByRole("button", { name: "Goal", exact: true }).count(),
    0,
  );
  const localHostLabel = await app.evaluate(async () => {
    const state = await (await import("/shell_api.js")).workspace.snapshot();
    return state.hosts.find((item) => item.id === "local")?.displayName;
  });
  assert.ok(localHostLabel, "local Host must remain selectable");
  await hostSelector.click();
  await thread.getByRole("option").filter({ hasText: localHostLabel }).click();
  await waitFor(() =>
    app.evaluate(async (threadId) => {
      const state = await (await import("/shell_api.js")).workspace.snapshot();
      return state.threads.find((item) => item.id === threadId)?.hostId === "local"
        ? true
        : undefined;
    }, firstThreadId),
  );
  await app.evaluate(async (threadId) => {
    await (
      await import("/shell_api.js")
    ).workflow.createGoal(
      threadId,
      "Thread surface Workflow",
      "Verify Workflow Node Thread navigation",
    );
  }, firstThreadId);
  const goalId = await waitFor(() =>
    app.evaluate(async () => {
      const state = await (await import("/shell_api.js")).workspace.snapshot();
      return state.goals.find((item) => item.title === "Thread surface Workflow")?.id;
    }),
  );
  const taskState = await app.evaluate(async (id) => {
    let result;
    let error;
    try {
      result = await (
        await import("/shell_api.js")
      ).workflow.addTask(id, "Thread surface Node", undefined);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const state = await (await import("/shell_api.js")).workspace.snapshot();
    return {
      error,
      resultType: typeof result,
      resultNodeCount: result?.nodes?.length,
      nodes: state.nodes.map((item) => ({
        id: item.id,
        goalId: item.goalId,
        title: item.title,
        threadId: item.threadId,
      })),
    };
  }, goalId);
  const pendingNode = taskState.nodes.find(
    (item) => item.goalId === goalId && item.title === "Thread surface Node",
  );
  assert.ok(pendingNode, JSON.stringify(taskState));
  assert.equal(pendingNode.threadId, "", "Pending nodes must not allocate empty Threads");
  const delegated = await app.evaluate(
    async (id) => (await import("/shell_api.js")).workflow.delegateTask(id),
    pendingNode.id,
  );
  const nodeThreadId = delegated.nodes.find((item) => item.id === pendingNode.id)?.threadId;
  assert.ok(nodeThreadId, "Delegating a Task creates its execution Thread");
  const workflowIds = { goalId, nodeThreadId };
  const workflowCard = thread.locator(".goal-card").filter({ hasText: "Thread surface Workflow" });
  await workflowCard.waitFor();
  const activity = thread.locator("[data-active-workflow]");
  if (await activity.count()) await activity.locator("header button").last().click();
  await workflowCard.getByRole("button", { name: "Open Workflow", exact: true }).click();
  await app.locator(".artifact-row").last().waitFor({ timeout: 15_000 });
  assert.equal(await app.locator(".artifact-row").count(), artifactsBeforeConversationAdd + 1);
  assert.equal(await app.locator(".workbench").isVisible(), false);
  const workflow = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => {
        const url = new URL(page.url());
        return url.pathname === "/pane" && url.searchParams.get("kind") === "workflow";
      }),
  );
  await workflow.locator(".workflow-panel").waitFor();
  assert.equal(new URL(workflow.url()).searchParams.get("target"), workflowIds.goalId);
  await workflow.locator(".goal-card button").filter({ hasText: "Thread surface Node" }).click();
  const nodeThread = thread;
  await nodeThread
    .getByRole("combobox", { name: "Workflow Node Thread Host", exact: true })
    .waitFor();
  await nodeThread
    .getByRole("button", { name: "Workflow Node Thread Agent", exact: true })
    .waitFor();
  assert.equal(
    await nodeThread.locator(".topbar").getByRole("button", { name: "Goal", exact: true }).count(),
    0,
  );
  await nodeThread
    .locator(".topbar")
    .getByRole("button", { name: "Workflow", exact: true })
    .click();
  const nodeWorkflow = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => {
        const url = new URL(page.url());
        return (
          url.pathname === "/pane" &&
          url.searchParams.get("kind") === "workflow" &&
          url.searchParams.get("target") === workflowIds.goalId
        );
      }),
  );
  await nodeWorkflow.getByRole("button", { name: "Conversation Thread", exact: true }).click();
  await thread.getByRole("button", { name: "Conversation Thread Agent", exact: true }).waitFor();
  conversationAdd = thread.locator(".topbar").getByRole("button", { name: "Add tab" });
  assert.equal(
    await app.locator(".workspace").getByRole("button", { name: "Edit address" }).count(),
    0,
  );

  phase("verify-empty-browser-tab");
  const workspaceTitlebar = app.locator(".workspace [data-workspace-titlebar-root]");
  await conversationAdd.click();
  await thread.getByRole("menuitem", { name: "Browser", exact: true }).click();
  const emptyBrowser = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => {
        const url = new URL(page.url());
        return url.pathname === "/pane" && url.searchParams.get("kind") === "browser";
      }),
  );
  await emptyBrowser.locator(".browser-panel").waitFor();
  assert.equal(await emptyBrowser.getByText(/No provider registered for PanesService/).count(), 0);
  await waitFor(() =>
    emptyBrowser.evaluate(
      async () => document.activeElement?.getAttribute("aria-label") === "Address or search",
    ),
  );
  await workspaceTitlebar.locator(".pane-active-tab").hover();
  await workspaceTitlebar
    .getByRole("button", { name: /^Close / })
    .last()
    .click();
  await waitFor(
    async () => (await app.locator(".artifact-row").count()) === artifactsBeforeConversationAdd + 1,
  );

  phase("verify-open-routing");
  const remote = "https://example.com/thread-surface-smoke";
  const artifactsBeforePopup = await app.locator(".artifact-row").count();
  await outerSurface.evaluate(
    async (element, url) =>
      element.executeJavaScript(
        `window.open(${JSON.stringify(url)}, '_blank', 'popup,width=480,height=320'); true`,
      ),
    remote,
  );
  const popupPage = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => page.url() === remote),
  );
  assert.equal(await app.locator(".artifact-row").count(), artifactsBeforePopup);
  const preview = app.locator("[data-explorer-preview]");
  await preview.waitFor();
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await preview.waitFor({ state: "hidden" });

  await conversationAdd.click();
  await thread.getByRole("menuitem", { name: "Browser", exact: true }).click();
  await workspaceTitlebar.locator(".pane-active-tab").hover();
  await workspaceTitlebar.getByRole("button", { name: "Edit address" }).click();
  const address = workspaceTitlebar.getByRole("combobox");
  await address.fill(remote);
  await address.press("Enter");
  await app.locator(".artifact-row").last().waitFor({ timeout: 15_000 });
  assert.equal(
    await app.locator(".artifact-row .artifact-select").count(),
    artifactsBeforeConversationAdd + 2,
  );

  phase("verify-direct-artifact-and-parent-selection");
  const firstArtifactRow = app.locator(".artifact-row").first();
  await firstArtifactRow.hover();
  assert.equal(
    await firstArtifactRow.locator('[data-slot="sidebar-menu-action"]:visible').count(),
    2,
  );
  assert.equal(
    await app
      .locator(".artifact-row:not(:hover) .artifact-action-tooltip")
      .evaluateAll((tooltips) =>
        tooltips.every(
          (tooltip) =>
            getComputedStyle(tooltip).opacity === "0" &&
            getComputedStyle(tooltip).pointerEvents === "none",
        ),
      ),
    true,
  );
  const artifactAlignment = await firstArtifactRow.evaluate(async (row) => {
    const select = row.querySelector(".artifact-select");
    const title = select.querySelector("span");
    const actions = [...row.querySelectorAll('[data-slot="sidebar-menu-action"]')];
    const bounds = select.getBoundingClientRect();
    return {
      height: Math.round(bounds.height),
      titleCenter: Math.round(
        title.getBoundingClientRect().top + title.getBoundingClientRect().height / 2,
      ),
      actionCenters: actions.map((action) => {
        const box = action.getBoundingClientRect();
        return Math.round(box.top + box.height / 2);
      }),
      rowCenter: Math.round(bounds.top + bounds.height / 2),
      paddingLeft: getComputedStyle(select).paddingLeft,
      paddingTop: getComputedStyle(select).paddingTop,
      paddingBottom: getComputedStyle(select).paddingBottom,
    };
  });
  assert.equal(artifactAlignment.height, 28);
  assert.equal(artifactAlignment.titleCenter, artifactAlignment.rowCenter);
  assert.ok(
    artifactAlignment.actionCenters.every((center) => center === artifactAlignment.rowCenter),
  );
  assert.equal(artifactAlignment.paddingLeft, "6px");
  assert.equal(artifactAlignment.paddingTop, artifactAlignment.paddingBottom);
  const browserTabId = await waitFor(() =>
    app.locator(".artifact-row.selected").getAttribute("data-tab-id"),
  );
  assert.ok(browserTabId?.startsWith("browser-"), "Active artifact is not the Browser tab");
  const browserSurface = app.locator(`[data-tool-tab="${browserTabId}"]`);
  await browserSurface.locator("explorer").waitFor({ state: "attached" });
  assert.equal(
    await browserSurface.locator("explorer").count(),
    1,
    "Browser tab must keep one native Explorer surface",
  );
  const browserChild = app.locator(`.artifact-row[data-tab-id="${browserTabId}"] .artifact-select`);
  for (let iteration = 0; iteration < 12; iteration += 1) {
    await app.locator(".thread-row").first().click();
    await waitFor(
      async () => (await app.locator(".workspace [data-workspace-titlebar-root]").count()) === 0,
    );
    assert.equal(await browserSurface.getAttribute("data-active"), "false");
    assert.ok((await browserSurface.boundingBox()).x < -90_000);
    assert.equal(
      await outerSurface.evaluate(async (element) => getComputedStyle(element).display),
      "block",
    );
    await browserChild.click();
    await app.locator(".workspace [data-workspace-titlebar-root]").waitFor();
    assert.equal(await browserSurface.getAttribute("data-active"), "true");
    assert.ok((await browserSurface.boundingBox()).x >= 0);
  }
  assert.equal(await app.locator(".primary-nav").count(), 0);
  assert.equal(
    await app.locator(".titlebar").getByRole("button", { name: "Settings", exact: true }).count(),
    1,
  );
  await app.locator(".sidebar-search").click();
  await app.getByRole("dialog").waitFor();
  await app.keyboard.press("Escape");
  await app.getByRole("dialog").waitFor({ state: "detached" });
  await browserChild.click();
  const browserTitlebar = app.locator(".workspace [data-workspace-titlebar-root]");
  await browserTitlebar.waitFor();
  const activeTab = browserTitlebar.locator(".pane-active-tab");
  const activeClose = activeTab.getByRole("button", { name: /Close / });
  await app.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await activeTab.hover();
  await waitFor(
    async () =>
      (await activeClose.evaluate(
        async (button) => getComputedStyle(button.parentElement).opacity,
      )) === "1",
  );
  assert.equal(
    await activeTab.evaluate(async (tab) =>
      tab.contains(tab.querySelector('[aria-label^="Close "]')),
    ),
    true,
  );

  phase("verify-browser-history-actions");
  await browserTitlebar.locator(".pane-active-tab").hover();
  await browserTitlebar.getByRole("button", { name: "Edit address" }).click();
  const secondAddress = browserTitlebar.getByRole("combobox");
  await secondAddress.fill("https://example.com/thread-surface-smoke-second");
  await secondAddress.press("Enter");
  await browserTitlebar.getByRole("button", { name: "Reload page" }).waitFor();
  const goBack = browserTitlebar.getByRole("button", { name: "Go back" });
  if (await goBack.count()) {
    await goBack.click();
    await browserTitlebar.getByRole("button", { name: "Go forward" }).waitFor();
  }

  phase("verify-artifact-pane-retention");
  const threadArtifactsBeforeMove = await app.locator(".artifact-row").count();
  await app
    .locator(".workspace [data-workspace-titlebar-root]")
    .getByRole("button", { name: "Open in Workbench" })
    .click();
  await waitFor(async () => (await browserSurface.getAttribute("data-placement")) === "workbench");
  assert.ok((await app.locator(".artifact-row").count()) < threadArtifactsBeforeMove);
  assert.equal(await browserSurface.locator("explorer").count(), 1);
  const dimensions = await app.evaluate(async () => {
    const shell = document.querySelector(".framework");
    const a = document.querySelector(".chat"),
      b = document.querySelector(".workbench");
    return {
      gap: getComputedStyle(shell).columnGap,
      a: getComputedStyle(a).borderRadius,
      b: getComputedStyle(b).borderRadius,
      header: b.querySelector(".explorer-titlebar").getBoundingClientRect().height,
    };
  });
  assert.deepEqual(dimensions, { gap: "4px", a: "12px", b: "12px", header: 56 });
  const darkWorkspaceSeam = await app.evaluate(async () => {
    document.documentElement.dataset.theme = "dark";
    const workspace = document.querySelector(".workspace");
    const panel = workspace.closest(".ui-resizable-panel");
    const thread = workspace.querySelector("[data-thread-surface]");
    const explorer = workspace.querySelector('explorer[aria-label="Conversation Thread"]');
    return {
      surface: getComputedStyle(workspace).backgroundColor,
      panel: getComputedStyle(panel).backgroundColor,
      workspaceRadius: getComputedStyle(workspace).borderRadius,
      threadRadius: getComputedStyle(thread).borderRadius,
      explorerRadius: getComputedStyle(explorer).borderRadius,
    };
  });
  assert.equal(darkWorkspaceSeam.panel, darkWorkspaceSeam.surface);
  assert.equal(darkWorkspaceSeam.workspaceRadius, "0px");
  assert.equal(darkWorkspaceSeam.threadRadius, "0px");
  assert.equal(darkWorkspaceSeam.explorerRadius, "0px");
  assert.notEqual(darkWorkspaceSeam.surface, "rgb(255, 255, 255)");
  phase("verify-empty-workbench-browser-tab");
  const workbenchTitlebar = app.locator(".workbench [data-workspace-titlebar-root]");
  const existingPanePages = new Set(
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((page) => new URL(page.url()).pathname === "/pane"),
  );
  await workbenchTitlebar.getByRole("button", { name: "Add tab" }).click();
  const workbenchAddMenu = workbenchTitlebar.locator(".pane-add-dropdown");
  await workbenchAddMenu.waitFor();
  await workbenchAddMenu
    .getByRole("menuitem", { name: "Browser", exact: true })
    .evaluate(async (button) => button.click());
  const emptyWorkbenchBrowser = await waitFor(() =>
    browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => {
        if (existingPanePages.has(page)) return false;
        const url = new URL(page.url());
        return (
          url.pathname === "/pane" &&
          url.searchParams.get("kind") === "browser" &&
          !url.searchParams.get("target")
        );
      }),
  );
  await emptyWorkbenchBrowser.getByRole("combobox", { name: "Address or search" }).waitFor();
  assert.ok((await emptyWorkbenchBrowser.locator(".browser-surface").boundingBox()).height > 100);
  await waitFor(() =>
    emptyWorkbenchBrowser.evaluate(
      async () => document.activeElement?.getAttribute("aria-label") === "Address or search",
    ),
  );
  assert.equal(
    await emptyWorkbenchBrowser
      .getByRole("combobox", { name: "Address or search" })
      .evaluate(async (input) => getComputedStyle(input).outlineStyle),
    "none",
  );
  const activeWorkbenchSurface = app.locator(
    '.tool-surface[data-placement="workbench"][data-active="true"]',
  );
  assert.ok((await activeWorkbenchSurface.boundingBox()).height > 100);
  await workbenchTitlebar.locator(".pane-active-tab").hover();
  await workbenchTitlebar
    .getByRole("button", { name: /^Close / })
    .last()
    .click();
  await app.locator(".workbench").getByRole("button", { name: "Edit address" }).click();
  await app.locator(".workbench").getByRole("combobox").waitFor();
  await app.locator(".workbench").getByRole("combobox").press("Escape");
  await app.locator(".titlebar").getByRole("button", { name: "Hide workbench" }).click();
  assert.equal(await app.locator(".workbench").isVisible(), false);
  assert.equal(await browserSurface.locator("explorer").count(), 1);

  phase("create-second-thread");
  const created = await app.evaluate(async () => {
    const existing = new Set(
      (await (await import("/shell_api.js")).workspace.snapshot()).threads.map((item) => item.id),
    );
    const snapshot = await (await import("/shell_api.js")).workspace.createThread({});
    return snapshot.threads.find((item) => !existing.has(item.id))?.id;
  });
  assert.ok(created, "Could not create a second Thread");
  phase("switch-thread");
  await waitFor(async () => (await app.locator(".thread-row").count()) >= 2);
  await app.locator(".thread-row").last().click();
  const secondThreadTarget = await waitFor(async () =>
    (await targets()).find((target) => target.id === firstThreadTarget.id),
  );
  const secondThread = thread;
  await secondThread.getByRole("textbox", { name: "Message" }).waitFor();
  await secondThread.getByRole("button", { name: /workspace/i }).click();
  const connectedWorkspace = secondThread.locator('[role="menu"][aria-label="Select workspaces"]');
  await connectedWorkspace.waitFor();
  assert.equal(
    secondThreadTarget.id,
    firstThreadTarget.id,
    "Thread switches must retain WebContents",
  );
  const afterSwitch = await outerSurface.evaluate(async (element) => element.getNavigationState());
  assert.equal(
    afterSwitch.documentId,
    outerState.documentId,
    "Thread switches must retain the document",
  );

  phase("complete");
  process.stdout.write(
    JSON.stringify({
      status: "ok",
      outer: app.url(),
      firstThreadId,
      secondThreadId: created,
      firstTarget: firstThreadTarget.id,
      secondTarget: secondThreadTarget.id,
      shellApi: true,
      conversationAndComposerInExplorer: true,
      composerLayout: true,
      workbenchRpc: true,
      openRequestRouting: true,
      threadRetained: true,
    }) + "\n",
  );
  // Playwright's Browser.close() asks the native browser to shut down. Tuffite's
  // runner owns that lifecycle, so let process exit close only the CDP socket.
  process.exit(0);
} catch (error) {
  process.stderr.write(`[thread-surface-smoke] failed: ${error?.stack ?? error}\n`);
  process.exit(1);
}

function phase(name) {
  process.stderr.write(`[thread-surface-smoke] ${name}\n`);
}

function isOvuleResource(value, filename) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "ovule:" &&
      url.host === "-" &&
      url.pathname === (filename === "thread.html" ? "/thread" : "/main")
    );
  } catch {
    return false;
  }
}

async function waitFor(probe, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out; last=${JSON.stringify(value)}`);
}

import type { AppSnapshot, OnboardingStatus, WorkspaceFile } from "@ovule/shell-api";
import type { WorkspaceApi } from "./contract";
let revision = 0n;
let nextId = 10;
let mockCodexAvailable = false;
let mockOpenAiAuthenticated = false;
let mockDeepSeekConfigured = false;
let mockOllamaConfigured = false;
const mockDisabledExtensions = new Set<string>();
const mockRemovedExtensions = new Set<string>();
let mockHostWorkspaceIds = ["mock-share"];
let mockHostAgentIds = ["ovule", "codex"];
let mockPairToken = "host-token-1";
let mockHostHasPairedDevice = true;
let mockHostHasWorkspace = true;
let mockHostKeepAwake = false;
const mockWorkspaceFiles = new Map<string, Uint8Array>();
const now = Date.now();
let mock: AppSnapshot = {
  revision,
  agents: [
    {
      id: "codex",
      label: "Codex",
      driver: "codex",
      available: true,
      enabled: true,
      detail: "Structured CLI · detected",
      extensionId: "io.ovule.agent.codex",
      skillIds: [],
      toolIds: [],
      instructions: "",
    },
    {
      id: "sample",
      label: "Sample ACP",
      driver: "sample",
      available: true,
      enabled: true,
      detail: "JSONL · detected",
      extensionId: "io.ovule.agent.sample",
      skillIds: ["release-check"],
      toolIds: ["docs"],
      instructions: "Verify changes before reporting completion.",
    },
    {
      id: "ovule",
      label: "Ovule",
      driver: "ovule",
      available: false,
      enabled: true,
      detail: "Built-in Agent Worker is not installed yet",
      skillIds: [],
      toolIds: ["computer-use"],
      instructions: "",
    },
  ],
  skills: [
    {
      id: "release-check",
      name: "release-check",
      description: "Verify a release before handoff.",
      path: "D:\\ovule\\.agents\\skills\\release-check\\SKILL.md",
      enabled: true,
    },
  ],
  tools: [
    {
      id: "docs",
      label: "Documentation",
      transport: "http",
      target: "https://example.com/mcp",
      args: [],
      enabled: true,
      required: false,
      available: true,
      detail: "Streamable HTTP MCP server",
      capabilities: [],
    },
    {
      id: "computer-use",
      label: "CRD Computer Use",
      transport: "native-crd",
      target: "tuffite.remoting",
      args: [],
      enabled: true,
      required: false,
      available: true,
      detail: "Built-in Chromium Remote Desktop capture and input",
      extensionId: "io.ovule.host",
      capabilities: ["desktop.snapshot", "desktop.input", "clipboard.write"],
    },
  ],
  models: [
    {
      id: "fast",
      label: "Fast coding",
      provider: "sample",
      remoteId: "default",
      enabled: true,
      agentIds: ["sample"],
      recommended: true,
      description: "Browser prototype model",
    },
    {
      id: "deepseek-flash",
      label: "DeepSeek Flash",
      provider: "deepseek",
      remoteId: "deepseek-flash",
      enabled: true,
      agentIds: ["ovule"],
      extensionId: "io.ovule.provider.deepseek",
      recommended: true,
      description: "Fast DeepSeek model with thinking and non-thinking modes",
    },
    {
      id: "deepseek-v4-pro",
      label: "DeepSeek V4 Pro",
      provider: "deepseek",
      remoteId: "deepseek-v4-pro",
      enabled: true,
      agentIds: ["ovule"],
      extensionId: "io.ovule.provider.deepseek",
      recommended: false,
      description: "High-capability DeepSeek model through the official API",
    },
  ],
  threads: [
    {
      id: "thread-0001",
      title: "Build a launch page",
      agent: "sample",
      hostId: "local",
      workspacePath: "D:\\ovule",
      projectId: "project-0001",
      workspaceBindingIds: [],
    },
    {
      id: "thread-node-0003",
      title: "Inspect workspace",
      agent: "sample",
      hostId: "local",
      workspacePath: "D:\\ovule",
      projectId: "project-0001",
      workspaceBindingIds: [],
    },
    {
      id: "thread-node-0004",
      title: "Build and preview HTML",
      agent: "ovule",
      hostId: "local",
      workspacePath: "D:\\ovule",
      projectId: "project-0001",
      workspaceBindingIds: [],
    },
    {
      id: "thread-node-0005",
      title: "Approve final report",
      agent: "sample",
      hostId: "local",
      workspacePath: "D:\\ovule",
      projectId: "project-0001",
      workspaceBindingIds: [],
    },
  ],
  messages: [
    {
      id: "message-visual-demo",
      threadId: "thread-0001",
      role: "assistant",
      content:
        "Local execution summary\n\n[Open generated preview](preview.html)\n\n[Open project website](https://example.com/)",
      parts: [
        {
          id: "message-visual-demo-markdown",
          kind: "markdown",
          text: "Local execution summary\n\n[Open generated preview](preview.html)\n\n[Open project website](https://example.com/)",
          mediaType: "text/markdown",
        },
        {
          id: "message-visual-demo-chart",
          kind: "echarts",
          dataJson: JSON.stringify({
            option: {
              title: { text: "Attempt latency" },
              tooltip: { trigger: "axis" },
              xAxis: { type: "category", data: ["Plan", "Run", "Verify"] },
              yAxis: { type: "value" },
              series: [{ type: "bar", data: [12, 42, 18] }],
            },
          }),
          mediaType: "application/json",
        },
      ],
      status: "complete",
      streamSequence: 0n,
      createdAt: now,
    },
    {
      id: "message-after-workflow",
      threadId: "thread-0001",
      role: "user",
      content: "Keep the Workflow visible in conversation history.",
      parts: [
        {
          id: "message-after-workflow-markdown",
          kind: "markdown",
          text: "Keep the Workflow visible in conversation history.",
          mediaType: "text/markdown",
        },
      ],
      status: "complete",
      streamSequence: 0n,
      createdAt: now + 2_000,
    },
    {
      id: "node-message-user",
      threadId: "thread-node-0003",
      role: "user",
      content: "Inspect workspace",
      parts: [
        {
          id: "node-message-user-markdown",
          kind: "markdown",
          text: "Inspect workspace",
          mediaType: "text/markdown",
        },
      ],
      status: "complete",
      streamSequence: 0n,
      createdAt: now + 500,
    },
    {
      id: "node-message-assistant",
      threadId: "thread-node-0003",
      role: "assistant",
      content: "Workspace inspected; implementation plan is ready.",
      parts: [
        {
          id: "node-message-assistant-markdown",
          kind: "markdown",
          text: "Workspace inspected; implementation plan is ready.",
          mediaType: "text/markdown",
        },
      ],
      status: "complete",
      streamSequence: 1n,
      createdAt: now + 1_000,
      attemptId: "attempt-0006",
    },
  ],
  goals: [
    {
      id: "goal-0002",
      threadId: "thread-0001",
      title: "Ship the first Ovule workflow",
      intent: "Plan the work, verify the preview, and prepare a reviewed report.",
      status: "active",
      progress: "1/3 nodes complete · 1 gate waiting",
      createdAt: now + 1_000,
    },
  ],
  nodes: [
    {
      id: "node-0003",
      goalId: "goal-0002",
      threadId: "thread-node-0003",
      kind: "task",
      title: "Inspect workspace",
      status: "succeeded",
      agent: "sample",
      dependencyIds: [],
      hostId: "local",
      workspaceBindingIds: [],
      createdAt: now,
    },
    {
      id: "node-0004",
      goalId: "goal-0002",
      threadId: "thread-node-0004",
      kind: "task",
      title: "Build and preview HTML",
      status: "pending",
      agent: "ovule",
      dependencyIds: ["node-0003"],
      hostId: "local",
      workspaceBindingIds: [],
      createdAt: now,
    },
    {
      id: "node-0005",
      goalId: "goal-0002",
      threadId: "thread-node-0005",
      kind: "gate",
      title: "Approve final report",
      status: "waiting",
      dependencyIds: ["node-0004"],
      hostId: "local",
      workspaceBindingIds: [],
      createdAt: now,
    },
  ],
  attempts: [
    {
      id: "attempt-0006",
      threadId: "thread-node-0003",
      taskId: "node-0003",
      purpose: "task",
      agent: "sample",
      hostId: "local",
      driver: "sample",
      status: "succeeded",
      summary: "Workspace inspected; implementation plan is ready.",
      output: "Workspace inspected; implementation plan is ready.",
      outputSequence: 1n,
      createdAt: now,
      startedAt: now,
      finishedAt: now,
      durationMs: 1_240,
      events: [
        {
          kind: "attempt/created",
          occurredAt: now,
          detail: "Task delegated to an Agent",
        },
        {
          kind: "attempt/dispatched",
          occurredAt: now,
          detail: "Sample ACP AgentDriver accepted the Attempt",
        },
        {
          kind: "attempt/started",
          occurredAt: now,
          detail: "Worker process started",
        },
        {
          kind: "attempt/succeeded",
          occurredAt: now,
          detail: "Workspace inspected; implementation plan is ready.",
        },
      ],
    },
  ],
  terminalRuns: [],
  capabilities: [],
  legacyDataIssues: [],
  projects: [
    {
      id: "project-0001",
      name: "Default project",
      sortOrder: 0,
      createdAt: now,
    },
  ],
  hosts: [
    {
      id: "local",
      displayName: "Local Host",
      kind: "local",
      connector: "in_process",
      status: "ready",
      agentIds: ["codex", "sample", "ovule"],
    },
  ],
  endpoints: [
    {
      id: "legacy-link-host",
      displayName: "Legacy Link Host",
      transport: "tunnel",
      host: JSON.stringify({ id: "legacy-link-host", addrs: [] }),
      user: "host",
      agentIds: [],
      workspaces: [],
    },
  ],
  bindings: [],
};

function update(mutator: (value: AppSnapshot) => AppSnapshot) {
  revision += 1n;
  mock = { ...mutator(mock), revision };
  return Promise.resolve(structuredClone(mock));
}

function normalizeMockWorkspacePath(path: string): string {
  return path.trim().replaceAll("\\", "/");
}

function mockWorkspaceFile(path: string): WorkspaceFile {
  const normalized = normalizeMockWorkspacePath(path);
  const name = normalized.split("/").at(-1) || "workbook.csv";
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? "").toLowerCase() : "";
  const key = normalized.toLocaleLowerCase();
  const fallback =
    extension === "csv"
      ? new TextEncoder().encode("Item,Value\nOvule,1\nOffice extension,2\n")
      : new Uint8Array();
  const bytes = Uint8Array.from(mockWorkspaceFiles.get(key) ?? fallback);
  return {
    path: normalized,
    name,
    extension,
    sizeBytes: BigInt(bytes.byteLength),
    bytes,
  };
}

const mockOnboardingSetups = (): OnboardingStatus["setups"] => [
  {
    extensionId: "io.ovule.agent.codex",
    id: "codex",
    label: "OpenAI / Codex",
    description: "Install Codex and authenticate with ChatGPT or an OpenAI API key.",
    icon: "key",
    agentIds: ["codex"],
    modelProvider: "openai",
    tag: "ovule-onboarding",
    inputFields: ["apiKey"],
    actions: [
      {
        id: "install",
        requiresAuthentication: false,
        requiredToolchains: ["codex-acp"],
      },
      {
        id: "chatgpt",
        requiresAuthentication: true,
        requiredToolchains: ["codex"],
      },
      {
        id: "api-key",
        requiresAuthentication: true,
        requiredToolchains: ["codex"],
      },
    ],
    allowedLinks: ["https://platform.openai.com/api-keys"],
    status: {
      id: "codex",
      available: mockCodexAvailable,
      authenticated: mockOpenAiAuthenticated,
      detail: mockOpenAiAuthenticated
        ? "Codex is installed and authenticated."
        : "Install Codex and authenticate.",
    },
  },
  {
    extensionId: "io.ovule.provider.deepseek",
    id: "deepseek",
    label: "DeepSeek",
    description: "Connect the official DeepSeek API and discover its current model catalog.",
    icon: "key",
    agentIds: [],
    modelProvider: "deepseek",
    tag: "ovule-onboarding",
    inputFields: ["apiKey"],
    actions: [
      {
        id: "configure",
        requiresAuthentication: true,
        requiredToolchains: [],
      },
    ],
    allowedLinks: ["https://platform.deepseek.com/api_keys"],
    status: {
      id: "deepseek",
      available: true,
      authenticated: mockDeepSeekConfigured,
      detail: mockDeepSeekConfigured
        ? "DeepSeek API key is securely configured."
        : "Enter a DeepSeek API key.",
    },
  },
  {
    extensionId: "io.ovule.host",
    id: "ollama",
    label: "Ollama",
    description: "Install Ollama and pull a local model for private on-device inference.",
    icon: "cloud",
    agentIds: [],
    modelProvider: "ollama",
    tag: "ovule-onboarding",
    inputFields: ["model"],
    actions: [
      {
        id: "pull",
        requiresAuthentication: true,
        requiredToolchains: ["ollama"],
      },
    ],
    allowedLinks: ["https://ollama.com/search"],
    status: {
      id: "ollama",
      available: mockOllamaConfigured,
      authenticated: mockOllamaConfigured,
      detail: mockOllamaConfigured
        ? "Ollama is installed and ready."
        : "Install Ollama and pull a local model.",
    },
  },
];

export const mockWorkspaceApi: WorkspaceApi = {
  openSystemUrl: async (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  },
  snapshot: async () => structuredClone(mock),
  extensionCatalog: async () => ({
    extensions: [
      {
        id: "io.ovule.agent.codex",
        installPath: "/mock/extensions/io.ovule.agent.codex",
        version: "0.1.0",
        source: "built-in",
        enabled: true,
        removable: false,
      },
      {
        id: "io.ovule.provider.deepseek",
        installPath: "/mock/extensions/io.ovule.provider.deepseek",
        version: "0.1.0",
        source: "built-in",
        enabled: true,
        removable: false,
      },
      {
        id: "io.ovule.agent.sample",
        installPath: "/mock/extensions/io.ovule.agent.sample",
        version: "0.1.0",
        source: "installed",
        enabled: !mockDisabledExtensions.has("io.ovule.agent.sample"),
        removable: true,
      },
      {
        id: "io.ovule.channel.sample",
        installPath: "/mock/extensions/io.ovule.channel.sample",
        version: "0.1.0",
        source: "installed",
        enabled: !mockDisabledExtensions.has("io.ovule.channel.sample"),
        removable: true,
      },
    ].filter((item) => !mockRemovedExtensions.has(item.id)),
    agents: [
      {
        extensionId: "io.ovule.agent.sample",
        id: "sample",
        label: "Sample ACP",
        executableCandidates: ["sample", "sample-alias"],
        mcpConfig: false,
        requiredEnvironment: [],
      },
      {
        extensionId: "io.ovule.agent.codex",
        id: "codex",
        label: "Codex",
        executableCandidates: ["codex"],
        mcpConfig: false,
        requiredEnvironment: [],
      },
    ],
    models: [
      {
        extensionId: "io.ovule.provider.deepseek",
        id: "deepseek-flash",
        label: "DeepSeek Flash",
        provider: "deepseek",
        remoteId: "deepseek-flash",
        agentIds: ["ovule"],
        recommended: true,
        description: "Fast DeepSeek model with thinking and non-thinking modes",
      },
      {
        extensionId: "io.ovule.provider.deepseek",
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
        provider: "deepseek",
        remoteId: "deepseek-v4-pro",
        agentIds: ["ovule"],
        recommended: false,
        description: "High-capability DeepSeek model through the official API",
      },
    ],
    capabilities: [
      {
        extensionId: "io.ovule.visuals",
        id: "visualization.echarts",
        label: "ECharts visualization",
        description: "Render declarative chart data in Thread messages.",
      },
    ],
    messageBlocks: [
      { extensionId: "io.ovule.visuals", kind: "interactive-ui", uiType: "iframe" },
      {
        extensionId: "io.ovule.visuals",
        kind: "echarts",
        tag: "ovule-echarts",
        uiType: "isolated",
        capability: "visualization.echarts",
      },
      {
        extensionId: "io.ovule.visuals",
        kind: "excalidraw",
        tag: "ovule-excalidraw",
        uiType: "isolated",
        capability: "drawing.excalidraw",
      },
      {
        extensionId: "io.ovule.channel.sample",
        kind: "channel-setup",
        hostRenderer: "channel-setup",
      },
    ],
    slashCommands: [
      {
        extensionId: "io.ovule.channel.sample",
        id: "channel",
        skills: ["channel-channel", "channel-cli"],
        label: "Sample channel",
        description: "Configure and verify the Channel message channel",
      },
    ],
    computerUse: [
      {
        extensionId: "io.ovule.host",
        id: "computer-use",
        label: "CRD Computer Use",
        provider: "crd",
        capabilities: ["desktop.snapshot", "desktop.input", "clipboard.write"],
      },
    ],
    fileEditors: [
      {
        extensionId: "io.ovule.visuals",
        id: "office-word",
        label: "Word preview",
        extensions: ["docx", "dotx"],
        mode: "read-only",
        threadPresentation: "card",
        tag: "ovule-office-editor",
        moduleUrl: "/extensions/visuals/dist/ui.js",
      },
      {
        extensionId: "io.ovule.visuals",
        id: "office-spreadsheet",
        label: "Spreadsheet editor",
        extensions: ["xlsx", "csv"],
        mode: "editable",
        threadPresentation: "card",
        tag: "ovule-office-editor",
        moduleUrl: "/extensions/visuals/dist/ui.js",
      },
      {
        extensionId: "io.ovule.visuals",
        id: "office-spreadsheet-preview",
        label: "Macro spreadsheet preview",
        extensions: ["xlsm"],
        mode: "read-only",
        threadPresentation: "card",
        tag: "ovule-office-editor",
        moduleUrl: "/extensions/visuals/dist/ui.js",
      },
      {
        extensionId: "io.ovule.visuals",
        id: "office-presentation",
        label: "PowerPoint preview",
        extensions: ["pptx", "pptm", "ppsx"],
        mode: "read-only",
        threadPresentation: "card",
        tag: "ovule-office-editor",
        moduleUrl: "/extensions/visuals/dist/ui.js",
      },
      {
        extensionId: "io.ovule.visuals",
        id: "office-pdf",
        label: "PDF preview",
        extensions: ["pdf"],
        mode: "read-only",
        threadPresentation: "card",
        tag: "ovule-office-editor",
        moduleUrl: "/extensions/visuals/dist/ui.js",
      },
    ],
  }),
  onboardingStatus: async () =>
    ({
      agents: structuredClone(mock.agents),
      models: [
        {
          id: "default:sample",
          label: "Sample ACP default",
          provider: "sample",
          remoteId: "",
          available: true,
          recommended: true,
          detail: "Browser prototype Agent",
          agentId: "sample",
        },
        {
          id: "sample:gpt-6-astra",
          label: "GPT-6 Astra",
          provider: "openai",
          remoteId: "GPT-6-Astra",
          available: true,
          recommended: false,
          detail: "Available through Sample ACP",
          agentId: "sample",
        },
        {
          id: "openai:gpt-6-astra",
          label: "GPT-6 Astra",
          provider: "openai",
          remoteId: "gpt-6-astra",
          available: mockOpenAiAuthenticated,
          recommended: false,
          detail: "Available through authenticated Codex",
          agentId: "ovule",
        },
        {
          id: "deepseek-flash",
          label: "DeepSeek Flash",
          provider: "deepseek",
          remoteId: "deepseek-flash",
          available: mockDeepSeekConfigured,
          recommended: true,
          detail: "Fast DeepSeek model with thinking and non-thinking modes",
          agentId: "ovule",
        },
        {
          id: "deepseek-v4-pro",
          label: "DeepSeek V4 Pro",
          provider: "deepseek",
          remoteId: "deepseek-v4-pro",
          available: mockDeepSeekConfigured,
          recommended: false,
          detail: "High-capability DeepSeek model through the official API",
          agentId: "ovule",
        },
        ...(mockOllamaConfigured
          ? [
              {
                id: "ollama:qwen3-coder",
                label: "qwen3-coder",
                provider: "ollama",
                remoteId: "ollama:qwen3-coder",
                available: true,
                recommended: false,
                detail: "Available through Ollama",
                agentId: "ovule",
              },
            ]
          : []),
      ],
      toolchains: [
        {
          id: "nodejs",
          label: "Node.js",
          kind: "runtime",
          provider: "external",
          available: true,
          installable: false,
          managed: false,
          detail: "Detected v24",
          executable: "node",
          version: "v24",
          requiredToolchainIds: [],
          installStatus: "idle",
        },
        {
          id: "python",
          label: "Python",
          kind: "runtime",
          provider: "external",
          available: true,
          installable: false,
          managed: false,
          detail: "Detected Python 3",
          executable: "python",
          version: "Python 3",
          requiredToolchainIds: [],
          installStatus: "idle",
        },
        {
          id: "ollama",
          label: "Ollama",
          kind: "model-runtime",
          provider: "external",
          available: false,
          installable: false,
          managed: false,
          detail: "Not detected on PATH",
          requiredToolchainIds: [],
          installStatus: "idle",
        },
        {
          id: "codex",
          label: "Codex CLI",
          kind: "agent-cli",
          provider: "npm",
          requestedVersion: "0.154.0",
          available: mockCodexAvailable,
          installable: !mockCodexAvailable,
          managed: mockCodexAvailable,
          detail: mockCodexAvailable ? "Installed" : "Not detected",
          requiredToolchainIds: ["nodejs"],
          installStatus: mockCodexAvailable ? "succeeded" : "idle",
        },
        {
          id: "codex-acp",
          label: "Codex ACP adapter",
          kind: "agent-adapter",
          provider: "npm",
          requestedVersion: "0.9.4",
          available: mockCodexAvailable,
          installable: !mockCodexAvailable,
          managed: mockCodexAvailable,
          detail: mockCodexAvailable ? "Installed" : "Not detected",
          requiredToolchainIds: ["nodejs"],
          installStatus: mockCodexAvailable ? "succeeded" : "idle",
        },
      ],
      setups: mockOnboardingSetups(),
      defaultAgentId: mock.threads[0]?.agent ?? mock.agents.find((agent) => agent.enabled)?.id,
    }) satisfies OnboardingStatus,
  runExtensionAction: async (input) => {
    if (input.extensionId !== "io.ovule.channel.sample") {
      throw new Error("unknown extension action");
    }
    const connection = {
      connectionId: input.connectionId ?? "default",
      configured: false,
      enabled: false,
      connected: false,
      provisioned: false,
      state: input.actionId === "connect-existing" ? "waiting_for_authorization" : "not_configured",
      region: "global",
      appIdHint: "",
      detail:
        input.actionId === "connect-existing"
          ? "Select the existing Ovule app in channel."
          : "Connect the existing Ovule app from this extension block.",
      ownerPaired: false,
    };
    const data = {
      selectedConnectionId: connection.connectionId,
      connections: [connection],
    };
    return {
      dataJson: JSON.stringify(data),
      openUrl:
        input.actionId === "connect-existing"
          ? "https://api.example.com/page/cli?user_code=MOCK-PAIR"
          : undefined,
    };
  },
  toolchainStatus: async () => [
    ...(await mockWorkspaceApi.onboardingStatus()).toolchains,
    {
      id: "channel-cli",
      label: "Channel CLI",
      kind: "cli",
      provider: "npm",
      requestedVersion: "1.0.94",
      available: false,
      installable: true,
      managed: false,
      detail: "Not detected on PATH",
      requiredToolchainIds: ["nodejs"],
      installStatus: "idle",
    },
  ],
  installToolchain: async (toolchainId) => {
    const items = await mockWorkspaceApi.toolchainStatus();
    if (toolchainId === "codex" || toolchainId === "codex-acp") mockCodexAvailable = true;
    return items.map((item) =>
      item.id === toolchainId
        ? {
            ...item,
            available: true,
            installable: false,
            managed: true,
            detail: "Installed",
            installStatus: "succeeded",
          }
        : item,
    );
  },
  ollamaModelJobs: async () => [],
  ollamaModels: async () => ({ models: [], jobs: [] }),
  pullOllamaModel: async (model) => ({
    model,
    status: "pulling",
    detail: `Pulling ${model}`,
  }),
  completeOnboarding: (input) =>
    update((value) => {
      const selected = new Set(input.agents.map((agent) => agent.id));
      const selections = new Map(input.agents.map((agent) => [agent.id, agent.modelId]));
      const ovuleModelId = selections.get("ovule");
      const selectedOption = [
        {
          id: "openai:gpt-6-astra",
          label: "GPT-6 Astra",
          provider: "openai",
          remoteId: "gpt-6-astra",
        },
        {
          id: "deepseek-flash",
          label: "DeepSeek Flash",
          provider: "deepseek",
          remoteId: "deepseek-flash",
        },
        {
          id: "deepseek-v4-pro",
          label: "DeepSeek V4 Pro",
          provider: "deepseek",
          remoteId: "deepseek-v4-pro",
        },
      ].find((model) => model.id === ovuleModelId);
      const ovuleModel = ovuleModelId
        ? {
            id: `onboarding-${selectedOption?.provider ?? "ollama"}-${(selectedOption?.remoteId ?? ovuleModelId).replace(/[^A-Za-z0-9._-]/g, "-")}`,
            label: selectedOption?.label ?? ovuleModelId,
            provider: selectedOption?.provider ?? "ollama",
            remoteId: selectedOption?.remoteId ?? ovuleModelId,
            enabled: true,
            agentIds: ["ovule"],
            recommended: false,
            description: "Configured during onboarding",
          }
        : undefined;
      return {
        ...value,
        agents: [
          ...value.agents.map((agent) => ({
            ...agent,
            enabled: selected.has(agent.id),
            ...(agent.driver === "ovule" && selections.get(agent.id)
              ? { available: true, modelId: selections.get(agent.id) }
              : {}),
          })),
          ...input.agents
            .filter((agent) => !value.agents.some((existing) => existing.id === agent.id))
            .map((agent) => ({
              ...agent,
              available: true,
              enabled: true,
              detail: `${agent.driver} AgentDriver`,
              skillIds: [],
              toolIds:
                agent.driver === "ovule"
                  ? (value.agents.find((existing) => existing.id === "ovule")?.toolIds ?? [])
                  : [],
              instructions: "",
            })),
        ],
        models: ovuleModel ? upsertById(value.models, ovuleModel) : value.models,
        threads: value.threads.map((thread) =>
          thread.id === input.threadId
            ? {
                ...thread,
                agent: input.defaultAgentId,
                modelId: input.defaultAgentId === "ovule" ? ovuleModel?.id : undefined,
              }
            : thread,
        ),
        skills: upsertById(value.skills, {
          id: "onboarding",
          name: "onboarding",
          description: "Turn setup requests into an observable Goal and Workflow.",
          path: "bundled:onboarding/SKILL.md",
          enabled: true,
        }),
      };
    }),
  runExtensionSetupAction: async (input) => {
    if (input.setupId === "codex") {
      mockCodexAvailable = true;
      if (input.actionId !== "install") mockOpenAiAuthenticated = true;
    } else if (input.setupId === "deepseek") {
      mockDeepSeekConfigured = true;
    } else if (input.setupId === "ollama") {
      mockOllamaConfigured = true;
    } else {
      throw new Error(`unknown Extension setup: ${input.setupId}`);
    }
    return mockWorkspaceApi.onboardingStatus();
  },
  installExtension: async () => structuredClone(mock),
  cleanOnboardingState: async () => mockWorkspaceApi.onboardingStatus(),
  cleanLegacyData: async () => {
    mock = { ...mock, legacyDataIssues: [] };
    return structuredClone(mock);
  },
  setExtensionEnabled: async (extensionId, enabled) => {
    if (enabled) mockDisabledExtensions.delete(extensionId);
    else mockDisabledExtensions.add(extensionId);
    return structuredClone(mock);
  },
  removeExtension: async (extensionId) => {
    mockRemovedExtensions.add(extensionId);
    mockDisabledExtensions.delete(extensionId);
    return structuredClone(mock);
  },
  advanceWorkflow: async () => structuredClone(mock),
  createThread: (input) =>
    update((value) => {
      const defaultProject = value.projects[0]?.id;
      return {
        ...value,
        threads: [
          ...value.threads,
          {
            id: `thread-${nextId++}`,
            title: "New thread",
            agent: "sample",
            hostId: "local",
            workspacePath: input.workspacePath ?? "D:\\Ovule\\default",
            projectId: defaultProject,
            workspaceBindingIds: [],
          },
        ],
      };
    }),
  setThreadWorkspace: (threadId, workspacePath) =>
    update((value) => ({
      ...value,
      threads: value.threads.map((thread) =>
        thread.id === threadId ? { ...thread, workspacePath } : thread,
      ),
    })),
  readWorkspaceFile: async (_threadId, path) => mockWorkspaceFile(path),
  saveWorkspaceFile: async (_threadId, path, bytes) => {
    mockWorkspaceFiles.set(
      normalizeMockWorkspacePath(path).toLocaleLowerCase(),
      Uint8Array.from(bytes),
    );
    return mockWorkspaceFile(path);
  },
  selectAgent: (threadId, agent) =>
    update((value) => ({
      ...value,
      threads: value.threads.map((thread) =>
        thread.id === threadId ? { ...thread, agent } : thread,
      ),
    })),
  selectHost: (threadId, hostId) =>
    update((value) => ({
      ...value,
      threads: value.threads.map((thread) =>
        thread.id === threadId ? { ...thread, hostId } : thread,
      ),
    })),
  sendMessage: (threadId, content) =>
    update((value) => {
      const attemptId = `attempt-${nextId++}`;
      const sourceMessageId = `message-${nextId++}`;
      const responseMessageId = `message-${nextId++}`;
      const createdAt = Date.now();
      const finishedAt = createdAt + 25;
      const goalCommand = content.trim().match(/^\/goal(?:\s+#([^\s]+))?\s+([\s\S]+)$/);
      const goalPrompt = goalCommand?.[2]?.trim();
      const targetGoal = goalCommand?.[1]
        ? value.goals.find((goal) => goal.id === goalCommand[1] && goal.threadId === threadId)
        : undefined;
      const goalId = targetGoal?.id ?? (goalPrompt ? `goal-${nextId++}` : undefined);
      const parent = value.threads.find((thread) => thread.id === threadId);
      const nodeThreadId = goalId ? `thread-${nextId++}` : undefined;
      const nodeId = goalId ? `node-${nextId++}` : undefined;
      const goalTitle = goalPrompt?.split(/\r?\n/, 1)[0]?.slice(0, 80) || "Planned Goal";
      const response = goalId
        ? targetGoal
          ? `Mock Agent adjusted Goal ${goalId}`
          : `Mock Agent created Goal ${goalId}`
        : `Mock Agent received: ${content}`;
      return {
        ...value,
        threads: nodeThreadId
          ? [
              ...value.threads,
              {
                id: nodeThreadId,
                title: `Execute ${goalTitle}`,
                agent: parent?.agent ?? "sample",
                hostId: parent?.hostId ?? "local",
                workspacePath: parent?.workspacePath ?? "D:\\ovule",
                projectId: parent?.projectId,
                workspaceBindingIds: [],
              },
            ]
          : value.threads,
        goals: goalId
          ? targetGoal
            ? value.goals.map((goal) =>
                goal.id === goalId
                  ? {
                      ...goal,
                      intent: goalPrompt!,
                      status: "active",
                      progress: "0/1 nodes complete · 0 gates waiting",
                    }
                  : goal,
              )
            : [
                ...value.goals,
                {
                  id: goalId,
                  threadId,
                  title: goalTitle,
                  intent: goalPrompt!,
                  status: "active",
                  progress: "0/1 nodes complete · 0 gates waiting",
                  createdAt,
                },
              ]
          : value.goals,
        nodes:
          goalId && nodeId && nodeThreadId
            ? [
                ...value.nodes.map((node) =>
                  targetGoal &&
                  node.goalId === goalId &&
                  !["running", "cancelling", "succeeded", "approved"].includes(node.status)
                    ? { ...node, status: "superseded" }
                    : node,
                ),
                {
                  id: nodeId,
                  goalId,
                  threadId: nodeThreadId,
                  kind: "task",
                  title: `Execute ${goalTitle}`,
                  status: "pending",
                  agent: parent?.agent,
                  dependencyIds: [],
                  hostId: parent?.hostId ?? "local",
                  workspaceBindingIds: [],
                  createdAt,
                },
              ]
            : value.nodes,
        messages: [
          ...value.messages,
          {
            id: sourceMessageId,
            threadId,
            role: "user",
            content,
            parts: [
              {
                id: `part-${nextId++}`,
                kind: "markdown",
                text: content,
                mediaType: "text/markdown",
              },
            ],
            status: "complete",
            streamSequence: 0n,
            createdAt,
            attemptId,
          },
          {
            id: responseMessageId,
            threadId,
            role: "assistant",
            content: response,
            parts: [
              {
                id: `part-${nextId++}`,
                kind: "markdown",
                text: response,
                mediaType: "text/markdown",
              },
            ],
            status: "complete",
            streamSequence: 1n,
            createdAt: finishedAt,
            attemptId,
          },
        ],
        attempts: [
          ...value.attempts,
          {
            id: attemptId,
            threadId,
            sourceMessageId,
            responseMessageId,
            purpose: "conversation",
            agent: value.threads.find((thread) => thread.id === threadId)?.agent ?? "sample",
            hostId: value.threads.find((thread) => thread.id === threadId)?.hostId ?? "local",
            driver: "sample",
            status: "succeeded",
            summary: response,
            output: response,
            outputSequence: 1n,
            createdAt,
            startedAt: createdAt,
            finishedAt,
            durationMs: 25,
            events: [
              {
                kind: "attempt/created",
                occurredAt: createdAt,
                detail: "Thread message delegated to an Agent",
              },
              {
                kind: "attempt/dispatched",
                occurredAt: createdAt,
                detail: "Mock AgentDriver accepted the Attempt",
              },
              {
                kind: "attempt/started",
                occurredAt: createdAt,
                detail: "Mock Worker started",
              },
              {
                kind: "attempt/succeeded",
                occurredAt: finishedAt,
                detail: response,
              },
            ],
          },
        ],
      };
    }),
  sendMessageWithAttachments: (threadId, content, attachments) =>
    mockWorkspaceApi.sendMessage(
      threadId,
      content || `[${attachments.length} pasted image${attachments.length === 1 ? "" : "s"}]`,
    ),
  readMessageAttachment: async () => new Uint8Array(),
  readHtmlPreview: async (_threadId, path) => ({
    source: path,
    html: "<!doctype html><html><body><main><h1>Ovule artifact</h1><p>Local HTML preview loaded in an explorer WebContents.</p></main></body></html>",
  }),
  browserSuggestions: async (_threadId, query) => [
    ...(query.includes(".")
      ? [
          {
            id: "open-url",
            kind: "url",
            title: `Open ${query}`,
            detail: "Navigate in Explorer",
            target: query,
          },
        ]
      : []),
    {
      id: "search-web",
      kind: "search",
      title: `Search for ${query}`,
      detail: "Search the web",
      target: query,
    },
  ],
  readMarkdown: async (_threadId, path) => ({
    path,
    content: "# Launch report\n\nThis document is editable with **Markdown WYSIWYG**.",
  }),
  saveMarkdown: async (_threadId, path, content) => ({ path, content }),
  shellProfiles: async () => "[]",
  configureShellProfiles: async () => {
    throw new Error("Native PTY is unavailable in the web prototype");
  },
  openSession: async () => {
    throw new Error("Native PTY is unavailable in the web prototype");
  },
  readSession: async () => {
    throw new Error("Native PTY is unavailable in the web prototype");
  },
  writeSession: async () => {
    throw new Error("Native PTY is unavailable in the web prototype");
  },
  resizeSession: async () => {
    throw new Error("Native PTY is unavailable in the web prototype");
  },
  closeSession: async () => false,
  listSessions: async () => "[]",
  startTerminal: (threadId, command, ownerId) =>
    update((value) => ({
      ...value,
      terminalRuns: [
        ...value.terminalRuns,
        {
          id: `terminal-${nextId++}`,
          threadId,
          ownerId,
          command,
          status: "succeeded",
          stdout: `mock$ ${command}\ncommand completed\n`,
          stderr: "",
          exitCode: 0,
        },
      ],
    })),
  cancelTerminal: (runId) =>
    update((value) => ({
      ...value,
      terminalRuns: value.terminalRuns.map((run) =>
        run.id === runId ? { ...run, status: "cancelled" } : run,
      ),
    })),
  createGoal: (threadId, title, intent) =>
    update((value) => ({
      ...value,
      goals: [
        ...value.goals,
        {
          id: `goal-${nextId++}`,
          threadId,
          title,
          intent,
          status: "active",
          progress: "No nodes yet",
          createdAt: Date.now(),
        },
      ],
    })),
  addTask: (goalId, title, agent) =>
    update((value) => {
      const goal = value.goals.find((item) => item.id === goalId);
      const parent = value.threads.find((item) => item.id === goal?.threadId);
      const threadId = `thread-${nextId++}`;
      return {
        ...value,
        threads: [
          ...value.threads,
          {
            id: threadId,
            title,
            agent: agent ?? parent?.agent ?? "sample",
            hostId: parent?.hostId ?? "local",
            workspacePath: parent?.workspacePath ?? "D:\\ovule",
            projectId: parent?.projectId,
            workspaceBindingIds: [],
          },
        ],
        nodes: [
          ...value.nodes,
          {
            id: `node-${nextId++}`,
            goalId,
            threadId,
            kind: "task",
            title,
            status: "pending",
            agent,
            dependencyIds: value.nodes
              .filter((node) => node.goalId === goalId && node.status !== "superseded")
              .slice(-1)
              .map((node) => node.id),
            hostId: parent?.hostId ?? "local",
            workspaceBindingIds: [],
            createdAt: Date.now(),
          },
        ],
      };
    }),
  addGate: (goalId, title) =>
    update((value) => {
      const goal = value.goals.find((item) => item.id === goalId);
      const parent = value.threads.find((item) => item.id === goal?.threadId);
      const threadId = `thread-${nextId++}`;
      return {
        ...value,
        threads: [
          ...value.threads,
          {
            id: threadId,
            title,
            agent: parent?.agent ?? "sample",
            hostId: parent?.hostId ?? "local",
            workspacePath: parent?.workspacePath ?? "D:\\ovule",
            projectId: parent?.projectId,
            workspaceBindingIds: [],
          },
        ],
        nodes: [
          ...value.nodes,
          {
            id: `node-${nextId++}`,
            goalId,
            threadId,
            kind: "gate",
            title,
            status: "waiting",
            dependencyIds: value.nodes
              .filter((node) => node.goalId === goalId && node.status !== "superseded")
              .slice(-1)
              .map((node) => node.id),
            hostId: parent?.hostId ?? "local",
            workspaceBindingIds: [],
            createdAt: Date.now(),
          },
        ],
      };
    }),
  delegateTask: (taskId) =>
    update((value) => {
      const task = value.nodes.find((node) => node.id === taskId);
      if (!task || task.kind !== "task") throw new Error("Task not found");
      return {
        ...value,
        nodes: value.nodes.map((node) =>
          node.id === taskId ? { ...node, status: "running" } : node,
        ),
        attempts: [
          ...value.attempts,
          {
            id: `attempt-${nextId++}`,
            threadId: task.threadId,
            taskId,
            purpose: "task",
            agent: task.agent ?? "sample",
            hostId:
              value.threads.find(
                (thread) =>
                  thread.id === value.goals.find((goal) => goal.id === task.goalId)?.threadId,
              )?.hostId ?? "local",
            driver: task.agent ?? "sample",
            status: "running",
            summary: "Browser mock Worker is running.",
            output: "",
            outputSequence: 0n,
            createdAt: Date.now(),
            startedAt: Date.now(),
            events: [
              {
                kind: "attempt/created",
                occurredAt: Date.now(),
                detail: "Task delegated to an Agent",
              },
              {
                kind: "attempt/dispatched",
                occurredAt: Date.now(),
                detail: "Mock AgentDriver accepted the Attempt",
              },
              {
                kind: "attempt/started",
                occurredAt: Date.now(),
                detail: "Mock Worker started",
              },
            ],
          },
        ],
      };
    }),
  forkMessage: async (threadId, messageId) => {
    const before = await mockWorkspaceApi.snapshot();
    const source = before.threads.find((thread) => thread.id === threadId);
    const history = before.messages.filter((message) => message.threadId === threadId);
    const index = history.findIndex((message) => message.id === messageId);
    if (!source || index < 0) throw new Error("Message not found in Thread");
    const branchId = `thread-fork-${crypto.randomUUID()}`;
    const snapshot = await update((value) => ({
      ...value,
      threads: [...value.threads, { ...source, id: branchId, title: `${source.title} (fork)` }],
      messages: [
        ...value.messages,
        ...history.slice(0, index + 1).map((message) => ({
          ...message,
          id: `message-${crypto.randomUUID()}`,
          threadId: branchId,
          attemptId: undefined,
          status: "complete",
          streamSequence: 0n,
          parts: message.parts
            .filter((part) => {
              if (["markdown", "image", "thinking"].includes(part.kind)) return true;
              if (part.kind !== "tool" || !part.dataJson) return false;
              try {
                return ["completed", "failed"].includes(JSON.parse(part.dataJson).state);
              } catch {
                return false;
              }
            })
            .map((part) => ({ ...part, id: `part-${crypto.randomUUID()}` })),
        })),
      ],
    }));
    return { threadId: branchId, snapshot };
  },
  restartMessage: async (threadId, messageId, content) => {
    const before = await mockWorkspaceApi.snapshot();
    const source = before.messages.find(
      (message) => message.threadId === threadId && message.id === messageId,
    );
    if (source?.role !== "user" || !content.trim()) throw new Error("A user prompt is required");
    const history = before.messages.filter((message) => message.threadId === threadId);
    const index = history.findIndex((message) => message.id === messageId);
    const removed = new Set(history.slice(index).map((message) => message.id));
    await update((value) => ({
      ...value,
      messages: value.messages.filter((message) => !removed.has(message.id)),
      attempts: value.attempts.map((attempt) =>
        attempt.threadId === threadId
          ? {
              ...attempt,
              status: ["queued", "dispatched", "running", "cancelling"].includes(attempt.status)
                ? "cancelled"
                : attempt.status,
              sourceMessageId: removed.has(attempt.sourceMessageId ?? "")
                ? undefined
                : attempt.sourceMessageId,
              responseMessageId: removed.has(attempt.responseMessageId ?? "")
                ? undefined
                : attempt.responseMessageId,
            }
          : attempt,
      ),
    }));
    const sent = await mockWorkspaceApi.sendMessage(threadId, content);
    const replacement = sent.messages
      .filter((message) => message.threadId === threadId && message.role === "user")
      .at(-1)!;
    const snapshot = await update((value) => ({
      ...value,
      messages: value.messages.map((message) =>
        message.id === replacement.id
          ? {
              ...message,
              id: messageId,
              createdAt: source.createdAt,
              parts: [...message.parts, ...source.parts.filter((part) => part.kind === "image")],
            }
          : message,
      ),
      attempts: value.attempts.map((attempt) =>
        attempt.sourceMessageId === replacement.id
          ? { ...attempt, sourceMessageId: messageId }
          : attempt,
      ),
    }));
    return { threadId, snapshot };
  },
  cancelAttempt: (attemptId) =>
    update((value) => {
      const attempt = value.attempts.find((item) => item.id === attemptId);
      if (!attempt) throw new Error("Attempt not found");
      const finishedAt = Date.now();
      return {
        ...value,
        nodes: value.nodes.map((node) =>
          node.id === attempt.taskId ? { ...node, status: "cancelled" } : node,
        ),
        attempts: value.attempts.map((item) =>
          item.id === attemptId
            ? {
                ...item,
                status: "cancelled",
                summary: "Mock Worker was cancelled",
                finishedAt,
                durationMs: Math.max(0, finishedAt - (item.startedAt ?? item.createdAt)),
                events: [
                  ...item.events,
                  {
                    kind: "attempt/cancel-requested",
                    occurredAt: finishedAt,
                    detail: "Cancellation requested",
                  },
                  {
                    kind: "attempt/cancelled",
                    occurredAt: finishedAt,
                    detail: "Mock Worker was cancelled",
                  },
                ],
              }
            : item,
        ),
      };
    }),
  resolveGate: (nodeId, approved) =>
    update((value) => ({
      ...value,
      nodes: value.nodes.map((node) =>
        node.id === nodeId ? { ...node, status: approved ? "approved" : "rejected" } : node,
      ),
    })),
  resetWorkflows: () =>
    update((value) => {
      const nodeThreadIds = new Set(value.nodes.map((node) => node.threadId).filter(Boolean));
      const nodeIds = new Set(value.nodes.map((node) => node.id));
      return {
        ...value,
        goals: [],
        nodes: [],
        threads: value.threads.filter((thread) => !nodeThreadIds.has(thread.id)),
        messages: value.messages.filter((message) => !nodeThreadIds.has(message.threadId)),
        attempts: value.attempts.filter(
          (attempt) => !attempt.taskId || !nodeIds.has(attempt.taskId),
        ),
        bindings: value.bindings.filter((binding) => !nodeThreadIds.has(binding.threadId)),
      };
    }),
  importSkill: (path, enabled) =>
    update((value) => {
      const name = path.replaceAll("\\", "/").split("/").at(-2) || `skill-${nextId++}`;
      return {
        ...value,
        skills: [
          ...value.skills,
          {
            id: name,
            name,
            description: "Imported Agent Skill",
            path,
            enabled,
          },
        ],
      };
    }),
  installBundledSkill: (skillId) =>
    update((value) => ({
      ...value,
      skills: upsertById(value.skills, {
        id: skillId,
        name: skillId,
        description:
          skillId === "onboarding"
            ? "Turn setup requests into an observable Goal and Workflow."
            : "Install, authenticate, verify, and troubleshoot the official Channel CLI.",
        path: `bundled:${skillId}/SKILL.md`,
        enabled: true,
      }),
    })),
  setSkillEnabled: (skillId, enabled) =>
    update((value) => ({
      ...value,
      skills: value.skills.map((skill) => (skill.id === skillId ? { ...skill, enabled } : skill)),
    })),
  removeSkill: (skillId) =>
    update((value) => ({
      ...value,
      skills: value.skills.filter((skill) => skill.id !== skillId),
    })),
  upsertTool: (input) =>
    update((value) => ({
      ...value,
      tools: upsertById(value.tools, {
        ...input,
        available: input.enabled,
        detail: input.transport === "http" ? "Streamable HTTP MCP server" : "stdio MCP server",
        capabilities: value.tools.find((tool) => tool.id === input.id)?.capabilities ?? [],
      }),
    })),
  removeTool: (toolId) =>
    update((value) => ({
      ...value,
      tools: value.tools.filter((tool) => tool.id !== toolId),
    })),
  upsertModel: (input) =>
    update((value) => ({
      ...value,
      models: upsertById(value.models, {
        ...input,
        recommended: value.models.find((model) => model.id === input.id)?.recommended ?? false,
        description: value.models.find((model) => model.id === input.id)?.description ?? "",
      }),
    })),
  removeModel: (modelId) =>
    update((value) => ({
      ...value,
      models: value.models.filter((model) => model.id !== modelId),
    })),
  upsertAgent: (input) =>
    update((value) => ({
      ...value,
      agents: upsertById(value.agents, {
        ...input,
        available: input.enabled && input.driver !== "ovule",
        detail: input.enabled ? `${input.driver} AgentDriver` : "Disabled",
      }),
    })),
  removeAgent: (agentId) =>
    update((value) => ({
      ...value,
      agents: value.agents.filter((agent) => agent.id !== agentId),
    })),
  createProject: (name) =>
    update((value) => ({
      ...value,
      projects: [
        ...value.projects,
        {
          id: `project-${nextId++}`,
          name,
          sortOrder: value.projects.length,
          createdAt: Date.now(),
        },
      ],
    })),
  renameProject: (projectId, name) =>
    update((value) => ({
      ...value,
      projects: value.projects.map((project) =>
        project.id === projectId ? { ...project, name } : project,
      ),
    })),
  moveThreadToProject: (threadId, projectId) =>
    update((value) => ({
      ...value,
      threads: value.threads.map((thread) =>
        thread.id === threadId ? { ...thread, projectId } : thread,
      ),
    })),
  bindWorkspace: (input) =>
    update((value) => {
      const id = `binding-${nextId++}`;
      const existing = value.bindings.filter((binding) => binding.threadId === input.threadId);
      const binding = {
        id,
        threadId: input.threadId,
        hostId: input.endpointId ?? "local",
        kind: input.kind,
        endpointId: input.endpointId,
        resourceId: input.resourceId,
        root: input.root,
        alias: input.alias,
        sortOrder: existing.length,
        trust: "restricted" as const,
      };
      return {
        ...value,
        bindings: [...value.bindings, binding],
        threads: value.threads.map((thread) =>
          thread.id === input.threadId
            ? {
                ...thread,
                workspaceBindingIds: [...thread.workspaceBindingIds, id],
              }
            : thread,
        ),
      };
    }),
  unbindWorkspace: (bindingId) =>
    update((value) => {
      const removed = value.bindings.find((binding) => binding.id === bindingId);
      return {
        ...value,
        bindings: value.bindings.filter((binding) => binding.id !== bindingId),
        threads: value.threads.map((thread) =>
          removed && thread.id === removed.threadId
            ? {
                ...thread,
                workspaceBindingIds: thread.workspaceBindingIds.filter((id) => id !== bindingId),
              }
            : thread,
        ),
      };
    }),
  unbindRemoteHost: (threadId, endpointId) =>
    update((value) => {
      const removed = new Set(
        value.bindings
          .filter((binding) => binding.threadId === threadId && binding.hostId === endpointId)
          .map((binding) => binding.id),
      );
      return {
        ...value,
        bindings: value.bindings.filter((binding) => !removed.has(binding.id)),
        threads: value.threads.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                hostId: thread.hostId === endpointId ? "local" : thread.hostId,
                workspaceBindingIds: thread.workspaceBindingIds.filter((id) => !removed.has(id)),
              }
            : thread,
        ),
      };
    }),
  removeRemoteHost: async (endpointId) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return update((value) => {
      const removed = new Set(
        value.bindings
          .filter((binding) => binding.hostId === endpointId)
          .map((binding) => binding.id),
      );
      return {
        ...value,
        endpoints: value.endpoints.filter((endpoint) => endpoint.id !== endpointId),
        hosts: value.hosts.filter((host) => host.id !== endpointId),
        bindings: value.bindings.filter((binding) => !removed.has(binding.id)),
        threads: value.threads.map((thread) => ({
          ...thread,
          hostId: thread.hostId === endpointId ? "local" : thread.hostId,
          workspaceBindingIds: thread.workspaceBindingIds.filter((id) => !removed.has(id)),
        })),
      };
    });
  },
  configureHostSpice: (endpointId, websocketUrl) =>
    update((value) => ({
      ...value,
      endpoints: value.endpoints.map((endpoint) =>
        endpoint.id === endpointId ? { ...endpoint, spiceWebsocketUrl: websocketUrl } : endpoint,
      ),
    })),
  resetLinkHosts: () =>
    update((value) => {
      mockPairToken = `host-token-${Date.now()}`;
      mockHostHasPairedDevice = false;
      mockHostHasWorkspace = false;
      mockHostWorkspaceIds = [];
      mockHostAgentIds = [];
      const removedHosts = new Set(
        value.endpoints
          .filter((endpoint) => endpoint.transport === "tunnel")
          .map((endpoint) => endpoint.id),
      );
      const removedBindings = new Set(
        value.bindings
          .filter((binding) => removedHosts.has(binding.hostId))
          .map((binding) => binding.id),
      );
      return {
        ...value,
        endpoints: value.endpoints.filter((endpoint) => !removedHosts.has(endpoint.id)),
        hosts: value.hosts.filter((host) => !removedHosts.has(host.id)),
        bindings: value.bindings.filter((binding) => !removedBindings.has(binding.id)),
        threads: value.threads.map((thread) => ({
          ...thread,
          hostId: removedHosts.has(thread.hostId) ? "local" : thread.hostId,
          workspaceBindingIds: thread.workspaceBindingIds.filter((id) => !removedBindings.has(id)),
        })),
      };
    }),
  setThreadWorkspaceBindings: (threadId, bindingIds) =>
    update((value) => ({
      ...value,
      threads: value.threads.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              workspaceBindingIds: [
                ...thread.workspaceBindingIds.filter((id) =>
                  value.bindings.some(
                    (binding) => binding.id === id && binding.hostId !== thread.hostId,
                  ),
                ),
                ...bindingIds,
              ],
            }
          : thread,
      ),
    })),
  registerEndpoint: async (input) => {
    const existing = mock.endpoints.find(
      (endpoint) => endpoint.transport === input.transport && endpoint.host === input.host,
    );
    const endpointId = existing?.id ?? `endpoint-${nextId++}`;
    const snapshot = await update((value) => ({
      ...value,
      endpoints: upsertById(value.endpoints, {
        id: endpointId,
        displayName: input.displayName,
        transport: input.transport,
        host: input.host,
        port: input.port,
        user: input.user,
        authKind: input.authKind,
        hostFingerprint: input.hostFingerprint,
        remoteId:
          input.transport === "tunnel" && input.host ? JSON.parse(input.host).id : undefined,
        agentIds: input.agentIds ?? [],
        workspaces: input.workspaces ?? [],
      }),
      hosts: upsertById(value.hosts, {
        id: endpointId,
        displayName: input.displayName,
        kind: "remote",
        connector: input.transport,
        status: "available",
        agentIds: input.agentIds ?? [],
      }),
    }));
    return { endpointId, snapshot };
  },
  testSshEndpoint: async (_input, root) => ({
    reachable: true,
    detail: `Connected; remote root ${root} is available`,
  }),
  discoverSshHost: async () => ({
    ready: true,
    host: "192.168.1.10",
    port: 22,
    user: "developer",
    fingerprint: "SHA256:mock-host-key",
    root: "/home/developer",
    alias: "this-computer",
    detail: "Local OpenSSH is ready.",
  }),
  shareWorkspaceLink: async (root, alias) => {
    mockHostHasWorkspace = true;
    return {
      requiresReset: false,
      endpointAddrJson: JSON.stringify({ id: "mock-link-host", addrs: [] }),
      endpointId: "mock-link-host",
      shareId: mockPairToken,
      root,
      alias,
      pending: [],
      devices: mockHostHasPairedDevice
        ? [
            {
              clientId: "mock-paired-device",
              name: "Design Laptop",
              online: true,
              workspaceIds: mockHostWorkspaceIds,
              agentIds: mockHostAgentIds,
            },
          ]
        : [],
      workspaces: [{ shareId: "mock-share", root, alias }],
      agents: [
        { id: "ovule", available: true },
        { id: "codex", available: true },
        { id: "sample", available: true },
      ],
    };
  },
  desktopPermissions: async () => ({
    managed: false,
    screenRecording: false,
    accessibility: false,
    bundleId: null,
    expectedBundleId: "io.ovule.desktop",
  }),
  requestDesktopPermission: async () => {
    throw new Error("System permissions are unavailable in preview");
  },
  hostPowerStatus: async () => ({
    keepAwake: mockHostKeepAwake,
    active: mockHostKeepAwake,
    supported: true,
  }),
  setHostKeepAwake: async (enabled) => {
    mockHostKeepAwake = enabled;
    return { keepAwake: enabled, active: enabled, supported: true };
  },
  shareHostLink: async () => ({
    requiresReset: false,
    endpointAddrJson: JSON.stringify({ id: "mock-link-host", addrs: [] }),
    endpointId: "mock-link-host",
    shareId: mockPairToken,
    root: "",
    alias: "This Host",
    pending: [],
    devices: mockHostHasPairedDevice
      ? [
          {
            clientId: "mock-paired-device",
            name: "Design Laptop",
            online: true,
            workspaceIds: mockHostWorkspaceIds,
            agentIds: mockHostAgentIds,
          },
        ]
      : [],
    workspaces: mockHostHasWorkspace
      ? [
          {
            shareId: "mock-share",
            root: "D:\\Ovule\\remote",
            alias: "project",
          },
        ]
      : [],
    agents: [
      { id: "ovule", available: true },
      { id: "codex", available: true },
      { id: "sample", available: true },
    ],
  }),
  repairLocalHostAccess: async () => {
    mockHostHasPairedDevice = false;
    mockPairToken = `host-token-${Date.now()}`;
    return mockWorkspaceApi.shareHostLink();
  },
  resetLocalHostLinkIdentity: async () => {
    mockHostHasPairedDevice = false;
    mockHostHasWorkspace = false;
    mockPairToken = `host-identity-${Date.now()}`;
    return mockWorkspaceApi.shareHostLink();
  },
  regenerateHostLink: async () => {
    mockPairToken = `host-token-${Date.now()}`;
    return mockWorkspaceApi.shareHostLink();
  },
  shareCurrentWorkspaceLink: async () => ({
    requiresReset: false,
    endpointAddrJson: JSON.stringify({ id: "mock-link-host", addrs: [] }),
    endpointId: "mock-link-host",
    shareId: "mock-share",
    root: "C:\\workspace",
    alias: "workspace",
    pending: [],
    devices: [],
    workspaces: [{ shareId: "mock-share", root: "C:\\workspace", alias: "workspace" }],
    agents: [
      { id: "ovule", available: true },
      { id: "codex", available: true },
      { id: "sample", available: true },
    ],
  }),
  setWorkspaceLinkAccess: async ({ workspaceIds, agentIds }) => {
    mockHostWorkspaceIds = workspaceIds;
    mockHostAgentIds = agentIds;
    return true;
  },
  submitWorkspaceLinkPairing: async () => "Pairing approved by the Host.",
  revokeWorkspaceLink: async () => true,
  testWorkspaceLink: async (endpointAddrJson) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const endpointId = (JSON.parse(endpointAddrJson) as { id?: string }).id;
    if (endpointId === "legacy-link-host") {
      return {
        connected: false,
        clientId: "mock-link-client",
        detail: "Host protocol is stale",
        agentIds: [],
        workspaces: [],
        capabilities: [],
      };
    }
    return {
      connected: true,
      clientId: "mock-link-client",
      detail: "Connected securely with Ovule Link.",
      root: "D:\\Ovule\\remote",
      agentIds: ["ovule", "codex", "sample"],
      workspaces: [
        {
          shareId: "mock-share",
          root: "D:\\Ovule\\remote",
          alias: "project",
        },
      ],
      capabilities: ["desktop.control"],
    };
  },
};

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const existing = items.some((value) => value.id === item.id);
  return existing ? items.map((value) => (value.id === item.id ? item : value)) : [...items, item];
}

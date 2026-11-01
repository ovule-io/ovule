export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ExtensionDescriptor {
  id: string;
  apiVersion: 1;
  capabilities: string[];
  handlers: {
    agents: string[];
    modelProviders: string[];
    channels: string[];
  };
}

export interface ExtensionContribution {
  id: string;
}

export interface AgentContribution extends ExtensionContribution {
  label: string;
  executableCandidates: string[];
  toolchain?: string;
  mcpConfig?: boolean;
  requiredEnvironment?: string[];
}

export interface ModelContribution extends ExtensionContribution {
  label: string;
  provider: string;
  remoteId: string;
  agents: string[];
  recommended?: boolean;
  description?: string;
}

export interface ExtensionSkillContribution extends ExtensionContribution {
  path: `${string}.md`;
}

export interface CapabilityContribution {
  id: string;
  label: string;
  description: string;
}

export interface ComputerUseContribution extends ExtensionContribution {
  label: string;
  provider: string;
  backend: "native-crd" | "mcp-stdio";
  toolchain?: string;
  args?: string[];
  capabilities: string[];
}

export interface ToolchainArchiveArtifact {
  url: `https://${string}`;
  sha256: string;
  format: "zip" | "tar.gz";
  size: number;
  maxExtractedBytes: number;
  stripComponents?: number;
}

export type ToolchainProvider =
  | { type: "external" }
  | {
      type: "npm";
      package: string;
      version: string;
      integrity: string;
      registry: `https://${string}`;
      allowScripts?: boolean;
    }
  | {
      type: "archive";
      version: string;
      artifacts: Record<string, ToolchainArchiveArtifact>;
    };

export interface ToolchainContribution extends ExtensionContribution {
  label: string;
  kind: string;
  onboarding?: boolean;
  executable: string;
  candidates: string[];
  versionArgs?: string[];
  locations?: Record<string, string[]>;
  requiredToolchainIds?: string[];
  provider: ToolchainProvider;
}

export interface FileEditorContribution extends ExtensionContribution {
  label: string;
  extensions: string[];
  mode: "read-only" | "editable";
  threadPresentation?: "link" | "card";
  tag: `${string}-${string}`;
  module: `${string}.mjs` | `${string}.js`;
  style?: `${string}.css`;
}

export type UiContribution = { type: "iframe" } | { type: "isolated"; tag: `${string}-${string}` };

export type MessageBlockContribution = {
  kind: string;
  capability?: string;
  agentInstructions: string;
  example: JsonValue;
} & (
  | { ui: UiContribution; tag?: never; module?: never; style?: never; hostRenderer?: never }
  | {
      ui?: never;
      tag: `${string}-${string}`;
      module: `${string}.mjs` | `${string}.js`;
      style?: `${string}.css`;
      hostRenderer?: never;
    }
  | {
      ui?: never;
      hostRenderer: "channel-setup" | "human-handoff";
      tag?: never;
      module?: never;
      style?: never;
    }
);

export interface SlashCommandContribution {
  id: string;
  label: string;
  description: string;
  handler: "channel.setup" | "connectivity.setup";
  target: string;
  skills: string[];
  workflow: `${string}.md`;
  statusBlock: string;
  fallback: {
    title: string;
    intent: string;
    response: string;
    nodes: Array<{
      id: string;
      kind: "task" | "gate";
      title: string;
      dependsOn: string[];
      agent?: string | null;
      host?: string | null;
      workspaces?: string[];
    }>;
  };
}

export interface ExtensionActionContribution {
  id: string;
  handler:
    | "channel.status"
    | "channel.registration.start"
    | "connectivity.status"
    | "connectivity.login"
    | "connectivity.accounts"
    | "connectivity.create"
    | "connectivity.open"
    | "connectivity.cancel";
  target: string;
  reuseExisting?: boolean;
}

export interface ExtensionContributions {
  agents?: AgentContribution[];
  channels?: ExtensionContribution[];
  skills?: ExtensionSkillContribution[];
  models?: ModelContribution[];
  capabilities?: CapabilityContribution[];
  messageBlocks?: MessageBlockContribution[];
  slashCommands?: SlashCommandContribution[];
  actions?: ExtensionActionContribution[];
  computerUse?: ComputerUseContribution[];
  toolchains?: ToolchainContribution[];
  fileEditors?: FileEditorContribution[];
  onboarding?: OnboardingContribution[];
}

export interface OnboardingContribution {
  tag?: string;
  id: string;
  label: string;
  description: string;
  icon: string;
  agentIds?: string[];
  modelProvider?: string;
  fields?: Array<{
    id: string;
    /** Legacy display hint; UI markup belongs to the isolated bundle. */
    label?: string;
    kind: "secret" | "text";
    required?: boolean;
    placeholder?: string;
  }>;
  actions: Array<{
    id: string;
    /** Legacy display hint; UI markup belongs to the isolated bundle. */
    label?: string;
    handler:
      | "toolchain.install"
      | "connectivity.configure"
      | "connectivity.test"
      | "connectivity.disable"
      | "authorization.launch"
      | "authorization.stdin"
      | "model-provider.configure"
      | "model-provider.pull";
    toolchains?: string[];
    toolchain?: string;
    args?: string[];
    field?: string;
    keyField?: string;
    provider?: string;
    credentialReference?: string;
    endpoint?: string;
    authorization?: {
      initialize: JsonValue;
      afterInitialize: JsonValue[];
      authorizationResponseId: number;
      urlPointer: string;
      completionMethod: string;
      successPointer: string;
    };
  }>;
  links?: Array<{ label?: string; url: string }>;
  status: {
    handler: "command.probe" | "secret.configured" | "connectivity.configured";
    toolchain?: string;
    args?: string[];
    credentialReference?: string;
    readyDetail: string;
    missingDetail: string;
  };
}

export interface ExtensionManifest {
  ui?: { entry: `${string}.js` };
  schemaVersion: 1;
  id: string;
  private: true;
  version: string;
  type: "module";
  apiVersion: 1;
  runtime?: { kind: "javascript"; entry: `${string}.mjs` } | { kind: "utility"; service: string };
  contributes: ExtensionContributions;
  permissions: Record<string, JsonValue>;
}

export interface HostOperation {
  id: string;
  kind: string;
  input: JsonValue;
}

export interface ExtensionEvent {
  kind: string;
  payload: JsonValue;
}

export interface MessageBlockEvent extends ExtensionEvent {
  kind: "message.block";
  payload: { id: string; kind: string; data: JsonValue };
}

export interface ExtensionResult {
  state: JsonValue;
  events: ExtensionEvent[];
  operations: HostOperation[];
}

export interface SpawnPlan {
  executableCandidates: string[];
  args: string[];
  cwd: "workspace" | "temporary";
  environment: Array<{ name: string; value: string }>;
  stdin: "null" | "jsonl-rpc";
  output?: "final-message" | "claude-json" | "plain";
  finalMessage?: boolean;
}

export interface AgentAdapter {
  prepare(input: JsonValue): SpawnPlan;
  onStdout(state: JsonValue, frame: Uint8Array | string): ExtensionResult;
  onStderr(state: JsonValue, frame: Uint8Array | string): ExtensionResult;
  onExit(state: JsonValue, exit: JsonValue): ExtensionResult;
}

export interface ModelProviderPlan {
  provider: string;
  apiBase: string;
  credentialReference: string;
  model: string;
}

export interface ModelProviderAdapter {
  prepare(input: JsonValue): ModelProviderPlan;
}

export interface ChannelAdapter {
  setup(input: JsonValue): JsonValue;
  connect(input: JsonValue): ExtensionResult;
  onTransportEvent(state: JsonValue, event: JsonValue): ExtensionResult;
  deliver(state: JsonValue, request: JsonValue): ExtensionResult;
  onTimer(state: JsonValue, timer: JsonValue): ExtensionResult;
  shutdown(state: JsonValue): ExtensionResult;
}

export interface ExtensionDefinition {
  id: string;
  apiVersion: 1;
  capabilities: string[];
  agents?: Record<string, AgentAdapter>;
  modelProviders?: Record<string, ModelProviderAdapter>;
  channels?: Record<string, ChannelAdapter>;
}

export interface ExtensionModule {
  describe(): ExtensionDescriptor;
  prepareAgent(id: string, input: JsonValue): SpawnPlan;
  onAgentStdout(id: string, state: JsonValue, frame: Uint8Array | string): ExtensionResult;
  onAgentStderr(id: string, state: JsonValue, frame: Uint8Array | string): ExtensionResult;
  onAgentExit(id: string, state: JsonValue, exit: JsonValue): ExtensionResult;
  prepareModelProvider(id: string, input: JsonValue): ModelProviderPlan;
  setupChannel(id: string, input: JsonValue): JsonValue;
  connectChannel(id: string, input: JsonValue): ExtensionResult;
  onChannelTransportEvent(id: string, state: JsonValue, event: JsonValue): ExtensionResult;
  deliverChannel(id: string, state: JsonValue, request: JsonValue): ExtensionResult;
  onChannelTimer(id: string, state: JsonValue, timer: JsonValue): ExtensionResult;
  shutdownChannel(id: string, state: JsonValue): ExtensionResult;
}

export function defineAgent<T extends AgentAdapter>(adapter: T): Readonly<T>;
export function defineChannel<T extends ChannelAdapter>(adapter: T): Readonly<T>;
export function defineModelProvider<T extends ModelProviderAdapter>(adapter: T): Readonly<T>;
export function defineExtension(definition: ExtensionDefinition): Readonly<ExtensionModule>;
export function validateManifest(
  manifest: ExtensionManifest,
  descriptor?: ExtensionDescriptor,
): true;
export function decodeUtf8(frame: Uint8Array | string): string;
export function parseJsonObject(frame: Uint8Array | string): Record<string, JsonValue>;
export function result(
  state: JsonValue,
  events?: ExtensionEvent[],
  operations?: HostOperation[],
): ExtensionResult;
export function messageBlock(id: string, kind: string, data: JsonValue): MessageBlockEvent;

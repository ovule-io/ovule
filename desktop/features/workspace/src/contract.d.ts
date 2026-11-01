import type { OvuleApi } from "@ovule/shell-api";
export type WorkspaceApi = OvuleApi["workspace"] &
  OvuleApi["extensions"] &
  OvuleApi["setup"] &
  OvuleApi["workflow"] &
  OvuleApi["message"] &
  OvuleApi["content"] &
  OvuleApi["terminal"] &
  OvuleApi["settings"];

export type AgentOutputEvent = {
  attemptId: string;
  sequence: number;
  delta: string;
  revision: number;
};

export type TerminalOutputEvent = {
  runId: string;
  ownerId?: string;
  sequence: number;
  stream: "stdout" | "stderr";
  delta: string;
};

export type ToolchainChangedEvent = {
  id: string;
  status: "installing" | "succeeded" | "failed";
  error?: string;
};

export type OllamaModelChangedEvent = {
  model: string;
  status: string;
  detail: string;
  error?: string;
};

export type BrowserUseRequest = {
  threadId?: string;
  navigation?: "allow" | "emit";
  target?: string;
  placement?: "thread" | "workbench";
};

export type OfficeUseRequest = { target: string };

export type HumanHandoffRequest = {
  id: string;
  title: string;
  instructions: string;
  protocol: "spice" | "browser";
  target?: string;
  gatewayUrl?: string;
  appshotUrl?: string;
  appshotAlt?: string;
};

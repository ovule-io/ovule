import type {
  AgentOutputEvent,
  BrowserUseRequest,
  HumanHandoffRequest,
  OfficeUseRequest,
  OllamaModelChangedEvent,
  TerminalOutputEvent,
  ToolchainChangedEvent,
  WorkspaceApi,
} from "./contract";

export interface WorkspaceService {
  api(): Promise<WorkspaceApi>;
  observeWorkspace(listener: () => void): () => void;
  observeAgentOutput(listener: (event: AgentOutputEvent) => void): () => void;
  observeTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void;
  observeBrowserUse(listener: (request: BrowserUseRequest) => void): () => void;
  observeHumanHandoff(listener: (request: HumanHandoffRequest) => void): () => void;
  observeOfficeUse(listener: (request: OfficeUseRequest) => void): () => void;
  observeToolchainChanged(listener: (event: ToolchainChangedEvent) => void): () => void;
  observeOllamaModelChanged(listener: (event: OllamaModelChangedEvent) => void): () => void;
  requestBrowserUse(
    target?: string,
    placement?: "thread" | "workbench",
    navigation?: "allow" | "emit",
  ): void;
  requestHumanHandoff(request: HumanHandoffRequest): void;
  requestOfficeUse(target: string): void;
}

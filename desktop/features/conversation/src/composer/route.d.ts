import type { ReactNode } from "react";
import type {
  AgentView,
  SkillView,
  ThreadView,
  WorkspaceBindingView,
  HostView,
  HostWorkspaceResource,
  RemoteEndpointView,
} from "@ovule/shell-api";
import type { MessageImageDraft } from "./message-draft";
import type { ViewData } from "./view-data";
import type { ComposerAttachment } from "./composer";
import type { WorkspaceOperation } from "./operations";
export interface RouteRuntime {
  MessageComposer: (props: {
    thread?: ThreadView;
    skills: SkillView[];
    messageText: string;
    setMessageText(value: string): void;
    messageImages: MessageImageDraft[];
    attachmentError?: string;
    addPastedImages(files: File[]): Promise<void>;
    removeMessageImage(id: string): void;
    sendingMessage: boolean;
    sendMessage(): Promise<void>;
    running?: boolean;
    stopping?: boolean;
    stopMessage?(): Promise<void>;
    workspacePath: string;
    clearWorkspace(): void;
    choosingWorkspace: boolean;
    chooseWorkspace(): Promise<string | undefined>;
    workspaceBindings: WorkspaceBindingView[];
    agents: AgentView[];
    hosts: HostView[];
    remoteHosts: RemoteEndpointView[];
    openHosts(): void;
    setWorkspaceBindings(bindingIds: string[]): Promise<void>;
    addLocalWorkspace(): Promise<void>;
    addRemoteWorkspace(
      endpoint: RemoteEndpointView,
      resource: HostWorkspaceResource,
    ): Promise<void>;
    draftAgentId: string;
    setDraftAgentId(value: string): void;
    selectAgent(agentId: string): void;
    workflowNodeThread?: boolean;
    hasMessages?: boolean;
  }) => ReactNode;
  useMessageDraft: (
    arg0: ViewData | undefined,
    arg1: ThreadView | undefined,
    arg2: (operation: WorkspaceOperation) => Promise<boolean>,
    arg3: (id: string) => void,
    arg4: string,
    arg5?: string,
    arg6?: string,
    arg7?: () => void,
    arg8?: (threadId: string) => Promise<void>,
  ) => MessageDraft;
}
export type MessageDraft = {
  messageText: string;
  setMessageText(value: string): void;
  messageImages: ComposerAttachment[];
  attachmentError?: string;
  addPastedImages(files: File[]): Promise<void>;
  removeMessageImage(id: string): void;
  sendingMessage: boolean;
  sendMessage(): Promise<void>;
};

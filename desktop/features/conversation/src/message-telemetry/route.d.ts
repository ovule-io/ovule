import type { ComponentType, ReactNode } from "react";
import type {
  AgentView,
  AttemptView,
  ModelView,
  ThreadMessageView,
  ThreadView,
} from "@ovule/shell-api";
export type MessageTelemetryRuntime = {
  surface: string;
  documentUrl: string;
  language: string;
  timezone: string;
  online: boolean;
  visibility: DocumentVisibilityState;
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
};
export interface RouteRuntime {
  MessageTelemetryDialog: (arg0: {
    contextMessages?: ThreadMessageView[];
    message?: ThreadMessageView;
    attempt?: AttemptView;
    thread?: ThreadView;
    agent?: AgentView;
    model?: ModelView;
    snapshotRevision: bigint;
    runtime?: MessageTelemetryRuntime;
    onOpenChange(open: boolean): void;
  }) => ReactNode;
  captureMessageTelemetryRuntime: (arg0?: string) => MessageTelemetryRuntime;
  GlobalDialogHost: ComponentType;
}

import type { FrameworkViewProps } from "@ovule/framework/view";
import type { ComponentType, RefObject } from "react";

export type ConversationLayoutViewProps = FrameworkViewProps & {
  artifactBodyRef: RefObject<HTMLDivElement | null>;
  hidden?: boolean;
};

export type ConversationLayoutViewTokenValue = ComponentType<ConversationLayoutViewProps>;

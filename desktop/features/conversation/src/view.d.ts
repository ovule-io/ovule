import type { ComponentType, RefObject } from "react";

export type ConversationViewProps = {
  artifactBodyRef: RefObject<HTMLDivElement | null>;
};

export type ConversationViewTokenValue = ComponentType<ConversationViewProps>;

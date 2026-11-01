import type { ComponentType, RefObject } from "react";

export type WorkbenchViewProps = {
  threadId?: string;
  bodyRef: RefObject<HTMLDivElement | null>;
};

export type WorkbenchViewTokenValue = ComponentType<WorkbenchViewProps>;

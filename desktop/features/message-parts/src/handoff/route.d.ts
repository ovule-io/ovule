import type { HumanHandoffRequest } from "@ovule/workspace/contract";
export interface RouteRuntime {
  encodeHumanHandoff: (arg0: HumanHandoffRequest) => string;
}

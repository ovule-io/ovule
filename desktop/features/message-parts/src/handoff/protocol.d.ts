import type { HumanHandoffRequest } from "@ovule/workspace/contract";
export type HumanHandoffProtocol = HumanHandoffRequest["protocol"];
export interface HandoffProtocolService {
  parseHumanHandoff(value: unknown): HumanHandoffRequest | undefined;
  encodeHumanHandoff(request: HumanHandoffRequest): string;
}

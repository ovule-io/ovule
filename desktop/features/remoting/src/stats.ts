import { turnServerLabel } from "./ice";
import type { NetworkStats } from "./model";

/** Interval metrics: throughput is not available capacity, RTT is not input latency. */
export class StatsSampler {
  private previous = new Map<
    string,
    {
      bytes: number;
      time: number;
      received: number;
      lost: number;
      frames: number;
      decode: number;
      jitterDelay: number;
      jitterCount: number;
    }
  >();
  sample(reports: RTCStatsReport): NetworkStats {
    const result: NetworkStats = {};
    reports.forEach((report) => {
      if (report.type === "transport" && report.selectedCandidatePairId) {
        const pair = reports.get(report.selectedCandidatePairId);
        if (pair?.currentRoundTripTime !== undefined)
          result.latencyMs = pair.currentRoundTripTime * 1000;
        const candidate = reports.get(pair?.remoteCandidateId);
        const local = reports.get(pair?.localCandidateId);
        if (
          pair &&
          (local?.candidateType === "relay" ||
            candidate?.candidateType === "relay" ||
            (local?.candidateType && candidate?.candidateType))
        ) {
          result.route =
            candidate?.candidateType === "relay" || local?.candidateType === "relay"
              ? "relay"
              : "direct";
          // URLs are useful for provider verification; never display TURN credentials.
          const relay =
            local?.candidateType === "relay"
              ? local
              : candidate?.candidateType === "relay"
                ? candidate
                : undefined;
          const url = turnServerLabel(relay?.url);
          result.routeDetail = [
            local?.candidateType,
            "↔",
            candidate?.candidateType,
            local?.protocol,
            relay?.relayProtocol,
            url,
          ]
            .filter(Boolean)
            .join(" · ");
        }
      }
      if (report.type !== "inbound-rtp" || report.kind !== "video") return;
      result.jitterMs = report.jitter === undefined ? undefined : report.jitter * 1000;
      result.framesPerSecond = report.framesPerSecond;
      result.framesDropped = report.framesDropped;
      result.codec = reports.get(report.codecId)?.mimeType;
      const current = {
        bytes: report.bytesReceived ?? 0,
        time: report.timestamp,
        received: report.packetsReceived ?? 0,
        lost: report.packetsLost ?? 0,
        frames: report.framesDecoded ?? 0,
        decode: report.totalDecodeTime ?? 0,
        jitterDelay: report.jitterBufferDelay ?? 0,
        jitterCount: report.jitterBufferEmittedCount ?? 0,
      };
      const previous = this.previous.get(report.id);
      if (previous && current.time > previous.time && current.bytes >= previous.bytes) {
        result.bandwidthKbps =
          ((current.bytes - previous.bytes) * 8) / (current.time - previous.time);
        const received = Math.max(0, current.received - previous.received);
        const lost = Math.max(0, current.lost - previous.lost);
        if (received + lost > 0) result.packetLossPercent = (lost / (received + lost)) * 100;
        if (current.frames > previous.frames)
          result.decodeMs =
            ((current.decode - previous.decode) * 1000) / (current.frames - previous.frames);
        if (current.jitterCount > previous.jitterCount)
          result.jitterBufferMs =
            ((current.jitterDelay - previous.jitterDelay) * 1000) /
            (current.jitterCount - previous.jitterCount);
      }
      this.previous.set(report.id, current);
    });
    return result;
  }
}

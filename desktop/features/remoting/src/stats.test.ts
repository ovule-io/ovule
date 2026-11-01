import { expect, test } from "bun:test";
import { StatsSampler } from "./stats";
const reports = (bytes: number, received: number, lost: number, timestamp: number) =>
  new Map([
    ["transport", { type: "transport", selectedCandidatePairId: "selected" }],
    ["unselected", { type: "candidate-pair", state: "succeeded", currentRoundTripTime: 9 }],
    [
      "selected",
      {
        type: "candidate-pair",
        currentRoundTripTime: 0.02,
        remoteCandidateId: "relay",
      },
    ],
    ["relay", { type: "remote-candidate", candidateType: "relay" }],
    [
      "video",
      {
        id: "video",
        type: "inbound-rtp",
        kind: "video",
        bytesReceived: bytes,
        packetsReceived: received,
        packetsLost: lost,
        timestamp,
      },
    ],
  ] as [string, object][]) as unknown as RTCStatsReport;
test("stats select the active route and calculate interval loss and throughput", () => {
  const sampler = new StatsSampler();
  expect(sampler.sample(reports(1000, 100, 10, 1000)).bandwidthKbps).toBeUndefined();
  const current = sampler.sample(reports(3000, 200, 10, 2000));
  expect(current.latencyMs).toBe(20);
  expect(current.route).toBe("relay");
  expect(current.packetLossPercent).toBe(0);
  expect(current.bandwidthKbps).toBe(16);
});

test("missing candidate reports never imply a direct connection", () => {
  const reports = new Map([
    ["transport", { type: "transport", selectedCandidatePairId: "selected" }],
    [
      "selected",
      { type: "candidate-pair", localCandidateId: "absent", remoteCandidateId: "absent" },
    ],
  ]) as unknown as RTCStatsReport;
  expect(new StatsSampler().sample(reports).route).toBeUndefined();
});
test("selected local TURN candidate identifies Cloudflare and relay protocol", () => {
  const report = reports(0, 0, 0, 1000);
  const entries = report as unknown as Map<string, object>;
  entries.set("selected", {
    type: "candidate-pair",
    localCandidateId: "local",
    remoteCandidateId: "remote",
  });
  entries.set("local", {
    candidateType: "relay",
    protocol: "udp",
    relayProtocol: "tls",
    url: "turns:turn.cloudflare.com:5349?transport=tcp&token=secret",
  });
  entries.set("remote", { candidateType: "host" });
  const sample = new StatsSampler().sample(report);
  expect(sample.route).toBe("relay");
  expect(sample.routeDetail).toContain("Cloudflare (turn.cloudflare.com)");
  expect(sample.routeDetail).toContain("tls");
  expect(sample.routeDetail).not.toContain("secret");
  entries.set("local", { candidateType: "host", protocol: "udp" });
  expect(new StatsSampler().sample(report).route).toBe("direct");
});

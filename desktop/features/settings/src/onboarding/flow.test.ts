import { describe, expect, test } from "bun:test";
import type { OnboardingStatus } from "@ovule/shell-api";
import { onboardingReadiness } from "./flow";

const status = {
  agents: [
    { id: "ovule", driver: "ovule", available: false },
    { id: "ovule-2", driver: "ovule", available: false },
    { id: "codex", driver: "codex", available: true },
  ],
  models: [{ id: "deepseek-flash", available: true }],
  setups: [{ agentIds: ["codex"], status: { authenticated: true } }],
} as OnboardingStatus;

describe("onboarding readiness", () => {
  test("Codex completes without a provider or model selection", () => {
    expect(onboardingReadiness({ ...status, models: [] }, ["codex"], "codex", {}).complete).toBe(
      true,
    );
  });
  test("Codex installation alone does not replace extension sign-in", () => {
    const unsigned = {
      ...status,
      setups: [
        {
          ...status.setups[0],
          status: { ...status.setups[0].status, authenticated: false },
        },
      ],
    };
    expect(onboardingReadiness(unsigned, ["codex"], "codex", {}).pendingAgents).toEqual(["codex"]);
  });
  test("a newly configured Ovule model can complete before its profile is saved", () => {
    expect(
      onboardingReadiness(status, ["ovule"], "ovule", {
        ovule: "deepseek-flash",
      }).complete,
    ).toBe(true);
  });
  test("reports the other profile instead of silently disabling Continue", () => {
    const result = onboardingReadiness(status, ["ovule", "ovule-2"], "ovule", {
      ovule: "deepseek-flash",
    });
    expect(result.pendingProfiles).toEqual(["ovule-2"]);
    expect(result.complete).toBe(false);
    expect(
      onboardingReadiness(status, ["ovule", "ovule-2"], "ovule", {
        ovule: "deepseek-flash",
        "ovule-2": "deepseek-flash",
      }).complete,
    ).toBe(true);
  });
  test("unavailable models and unknown/default agents cannot complete", () => {
    expect(
      onboardingReadiness(
        { ...status, models: [{ ...status.models[0], available: false }] },
        ["ovule"],
        "ovule",
        { ovule: "deepseek-flash" },
      ).complete,
    ).toBe(false);
    expect(onboardingReadiness(status, ["unknown"], "unknown", {}).complete).toBe(false);
    expect(onboardingReadiness(status, ["codex"], "ovule", {}).complete).toBe(false);
  });
});

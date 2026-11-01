import { describe, expect, test } from "bun:test";
import {
  decodeHumanHandoff,
  encodeHumanHandoff,
  handoffLaunchUrl,
  parseHumanHandoff,
} from "./protocol-codec";

const request = {
  id: "login-1",
  title: "Complete sign-in",
  instructions: "Finish MFA and continue.",
  protocol: "spice" as const,
  target: "spice+tls://desktop.example.com:5900",
  gatewayUrl: "https://desktop.example.com/session/1",
  appshotUrl: "https://desktop.example.com/session/1/appshot.png",
};

describe("human handoff model", () => {
  test("round trips a validated handoff", () => {
    expect(decodeHumanHandoff(encodeHumanHandoff(request))).toEqual({
      ...request,
      target: "spice+tls://desktop.example.com:5900",
    });
    expect(handoffLaunchUrl(request)).toBe(request.gatewayUrl);
  });

  test("rejects credentials and secret query parameters", () => {
    expect(
      parseHumanHandoff({
        ...request,
        target: "spice://user:pass@example.com",
      }),
    ).toBeUndefined();
    expect(
      parseHumanHandoff({
        ...request,
        target: "spice://example.com?ticket=secret",
      }),
    ).toBeUndefined();
    expect(parseHumanHandoff({ ...request, gatewayUrl: "http://example.com" })).toBeUndefined();
    expect(
      parseHumanHandoff({
        ...request,
        gatewayUrl: "https://example.com?access_token=secret",
      }),
    ).toBeUndefined();
    expect(
      parseHumanHandoff({
        ...request,
        appshotUrl: "https://example.com/image?X-Amz-Signature=x",
      }),
    ).toBeUndefined();
  });
});

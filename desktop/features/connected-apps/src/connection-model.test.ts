import { describe, expect, test } from "bun:test";
import {
  connectedAppToolId,
  connectedAppNameError,
  connectionEndpointError,
  credentialEnvironmentError,
} from "./connection-model";

describe("connected app model", () => {
  test("builds stable non-secret tool ids", () => {
    expect(connectedAppToolId("pipedream", "gmail", "https://example.com/mcp")).toBe(
      connectedAppToolId("pipedream", "gmail", "https://example.com/mcp"),
    );
    expect(connectedAppToolId("pipedream", "gmail", "https://example.com/mcp")).toMatch(
      /^app-pipedream-gmail-[a-z0-9]+$/,
    );
  });

  test("normalizes arbitrary app names into valid stable IDs", () => {
    expect(
      connectedAppToolId("custom", "Acme CRM / Production", "https://example.com/mcp"),
    ).toMatch(/^app-custom-acme-crm-production-[a-z0-9]+$/);
    expect(connectedAppNameError("Acme CRM")).toBeUndefined();
    expect(connectedAppNameError(" ")).toBe("connections.invalidAppName");
  });

  test("requires a secure endpoint without embedded credentials", () => {
    expect(connectionEndpointError("http://example.com/mcp")).toBe("connections.httpsOnly");
    expect(connectionEndpointError("https://user:secret@example.com/mcp")).toBe(
      "connections.invalidEndpoint",
    );
    expect(connectionEndpointError("https://example.com/mcp?access_token=secret")).toBe(
      "connections.secretInUrl",
    );
    expect(connectionEndpointError("https://example.com/mcp?tenant=acme")).toBeUndefined();
  });

  test("accepts only environment variable names, not pasted credentials", () => {
    expect(credentialEnvironmentError("PIPEDREAM_ACCESS_TOKEN")).toBeUndefined();
    expect(credentialEnvironmentError("_LOCAL_TOKEN_2")).toBeUndefined();
    expect(credentialEnvironmentError("")).toBeUndefined();
    expect(credentialEnvironmentError("pd_live_secret-value")).toBe(
      "connections.invalidCredentialEnv",
    );
  });
});

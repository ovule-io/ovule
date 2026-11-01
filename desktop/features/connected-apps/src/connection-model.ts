export const connectedAppProviders = [
  {
    id: "activepieces",
    get label() {
      return "Activepieces (self-hosted OSS)";
    },
    docsUrl: "https://www.activepieces.com/mcp",
    endpointPlaceholder: "https://your-activepieces.example/mcp",
    credentialPlaceholder: "ACTIVEPIECES_ACCESS_TOKEN",
  },
  {
    id: "nango",
    get label() {
      return "Nango (self-hostable)";
    },
    docsUrl: "https://nango.dev/docs/implementation-guides/use-cases/tool-calling",
    endpointPlaceholder: "https://your-nango.example/mcp",
    credentialPlaceholder: "NANGO_SECRET_KEY",
  },
  {
    id: "pipedream",
    get label() {
      return "Pipedream Connect";
    },
    docsUrl: "https://pipedream.com/docs/connect/mcp/",
    endpointPlaceholder: "https://remote.mcp.pipedream.net/...",
    credentialPlaceholder: "PIPEDREAM_ACCESS_TOKEN",
  },
  {
    id: "composio",
    get label() {
      return "Composio";
    },
    docsUrl: "https://docs.composio.dev/docs/mcp-overview",
    endpointPlaceholder: "https://mcp.composio.dev/...",
    credentialPlaceholder: "COMPOSIO_API_KEY",
  },
  {
    id: "custom",
    get label() {
      return "Custom MCP";
    },
    docsUrl: "https://modelcontextprotocol.io/specification/2025-06-18/basic/transports",
    endpointPlaceholder: "https://example.com/mcp",
    credentialPlaceholder: "MCP_ACCESS_TOKEN",
  },
] as const;

export const connectedApps = [
  { id: "gmail", label: "Gmail" },
  { id: "slack", label: "Slack" },
  { id: "github", label: "GitHub" },
  { id: "google-calendar", label: "Google Calendar" },
  { id: "google-drive", label: "Google Drive" },
  { id: "notion", label: "Notion" },
  { id: "linear", label: "Linear" },
  { id: "jira", label: "Jira" },
  { id: "salesforce", label: "Salesforce" },
  { id: "custom", label: "Other / custom" },
] as const;

export type ConnectedAppProviderId = (typeof connectedAppProviders)[number]["id"];
export type ConnectedAppId = (typeof connectedApps)[number]["id"];

export function connectedAppToolId(
  provider: ConnectedAppProviderId,
  app: string,
  endpoint: string,
): string {
  let hash = 0x811c9dc5;
  for (const character of endpoint.trim()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  const appSlug =
    app
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replaceAll(/^-+|-+$/g, "")
      .slice(0, 48) || "custom";
  return `app-${provider}-${appSlug}-${(hash >>> 0).toString(36)}`;
}

export function connectedAppNameError(value: string): string | undefined {
  const name = value.trim();
  return name && name.length <= 80 ? undefined : "connections.invalidAppName";
}

export function connectionEndpointError(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return "connections.httpsOnly";
    if (!url.hostname || url.username || url.password) return "connections.invalidEndpoint";
    const secretKeys = ["token", "api_key", "apikey", "access_token", "secret"];
    if ([...url.searchParams.keys()].some((key) => secretKeys.includes(key.toLowerCase()))) {
      return "connections.secretInUrl";
    }
    return undefined;
  } catch {
    return "connections.invalidEndpoint";
  }
}

export function credentialEnvironmentError(value: string): string | undefined {
  const name = value.trim();
  if (!name) return undefined;
  return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)
    ? undefined
    : "connections.invalidCredentialEnv";
}

export function relayOptions(opts) {
  const transport = opts["turn-transport"] ?? "all";
  if (!["all", "udp", "tcp", "tls"].includes(transport))
    throw new Error("--turn-transport must be all, udp, tcp or tls");
  const setup = Boolean(opts["cloudflare-setup"]);
  const credentials = opts["cloudflare-credentials"];
  if (setup && credentials)
    throw new Error("Choose --cloudflare-setup or --cloudflare-credentials PATH");
  if ((setup || credentials || transport !== "all") && !opts["require-relay"])
    throw new Error(
      "Cloudflare setup, credentials and transport selection require --require-relay",
    );
  if (
    opts["require-relay"] &&
    (!opts["connection-only"] || (!setup && !credentials) || opts["host-owned-turn-fixture"])
  )
    throw new Error(
      "Relay verification requires --connection-only and either --cloudflare-setup or --cloudflare-credentials PATH, without the fake TURN fixture",
    );
  return { setup, credentials, transport };
}

export function selectTurnTransport(servers, transport) {
  if (transport === "all") return servers;
  return servers
    .map((server) => ({
      ...server,
      urls: server.urls.filter((url) =>
        transport === "tls"
          ? url.startsWith("turns:") && /:443(?:\?|$)/.test(url)
          : transport === "tcp"
            ? url.startsWith("turn:") && url.includes("transport=tcp")
            : url.startsWith("turn:") && !url.includes("transport=tcp"),
      ),
    }))
    .filter((server) => server.urls.length);
}

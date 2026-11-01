# Cloudflare connection service

Run `/cloudflare` in a conversation on the Host whose desktop you want to access.
The command opens the extension's setup card directly, without invoking an Agent
or requiring a model configuration.

## Setup

1. Sign in from the card. Ovule prepares managed Node.js and the pinned official
   `cf 1.0.0-beta.12` CLI. Browser PKCE authorization opens in the Workbench; use
   the system-browser action if embedded Turnstile checks fail. Keep Ovule running
   on this Host so the same local callback can complete.
2. Authorization uses the dedicated `ovule-connectivity` profile with account/user
   reads and `calls.write`. Choose a billing account and enable connectivity.
   Managed relay traffic may incur charges; no custom OAuth app or copied API
   token is required.
3. The trusted Host creates a TURN Key through the CLI and stores it encrypted.
   Long-lived secrets and raw API responses do not enter cards, conversations,
   model context, logs or pair links. If persistence fails, retry secure saving;
   the process retains the pending Key instead of creating another one.
4. Pair the Client normally and open the desktop. Saved configuration proves
   persistence, not a working media route. Reconnect existing sessions to use a
   changed provider configuration.

Leaving the card does not revoke authorization. Cancel an active login from the
card; authorization has a ten-minute deadline. CLI OAuth credentials require system
secure storage and fail rather than falling back to plaintext. Windows requires
the CLI keyring backend; Linux requires a system secret service/secret-tool.

Temporary ICE credentials are obtained per session and expire within 24 hours.
In-place refresh and a team-managed broker are not implemented; long sessions need
reconnection. The Client does not configure its own cloud token.

## Provider boundary

`native/` owns the trusted official-CLI integration, fixed API domains, long-lived
credential schema and temporary ICE generation. Application composition registers
its `IceConfigProvider`; remoting depends only on that port and generic ICE data.
The native module is compiled with the application. Installing a frontend extension
does not load arbitrary native code into the Host.

## Verification

Use Node.js 22.22 or newer from the repository root:

```powershell
node desktop/smoke/remote-control-e2e.mjs --package-root dist/<candidate> --connection-only --require-relay --cloudflare-setup --keep-run-root
```

The test launches an isolated Host and opens setup. After manual login, account
selection and enablement, it launches a separate Client, pairs and starts the
desktop. Authorization waits up to 600 seconds; change that with
`--setup-timeout-seconds`. The real user profile is not used. Retain the printed
run root for private diagnostics. Its encrypted
`host-data/secrets/provider-cloudflare-turn.dpapi` can be reused only with the
appropriate platform identity; Windows requires the same system user.

After setup, test each Client-to-TURN transport separately:

```powershell
node desktop/smoke/remote-control-e2e.mjs --package-root dist/<candidate> --connection-only --require-relay --cloudflare-credentials "<run-root>/host-data/secrets/provider-cloudflare-turn.dpapi" --turn-transport udp
# Repeat with --turn-transport tcp and --turn-transport tls (TLS port 443).
```

Default `all` uses every returned URL. The switch affects only the Client; Host
policy stays unchanged. Require a selected relay candidate, decoded video, actual
keyboard/Unicode input and Stop cleanup. A saved card or connected data channel is
insufficient. Diagnostics report ICE state, candidate counts, pair state, error
codes and decoded frames without temporary credentials.

No relay candidates suggest credential or TURN-entry problems. Candidates without
a working pair suggest relay-to-peer reachability problems. Connected ICE with zero
frames suggests capture/codec problems. Inspect the actual selected route in the
status bar; automatic mode can still prefer direct connectivity. TURN-only mode
can verify relay use on the same Wi-Fi.

This uses real public relay traffic and does not automatically revoke a manually
created TURN Key. It does not simulate two real NATs or replace separate-device,
enterprise-firewall, real system IME and WAN acceptance. Fixture tests cover slash
registration, card rendering, authorization boundaries, cancellation, persistence
retry and redaction without creating cloud resources.

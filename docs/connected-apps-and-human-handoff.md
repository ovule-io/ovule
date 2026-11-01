# Connected apps and human handoff

Status: first production-oriented vertical slice implemented on 2026-10-01;
Ovule Link Remote Control and Agent-bound connected apps updated on
2026-10-02.

This document defines the current product and security boundary for two related
capabilities: giving an Agent access to an external application through MCP, and
returning control to a person when a visual or sensitive step must not be
automated.

## Connected apps

Manage fills the complete framework left panel and defaults to Connected apps;
Hosts is another section in the same sidebar. Gmail, Slack, GitHub, Google
Calendar, Google Drive, Notion, Linear, Jira, and Salesforce are shortcuts;
**Other / custom** accepts any application name. They are discovery shortcuts,
not an allowlist.

The ordinary product flow is deliberately account-oriented: choose an app,
connect an account in the browser, grant it to Agents, then ask an Agent to use
it. Users should not need to know what MCP transport is, find an endpoint, or
manage an environment variable. The current development build does not yet
bundle the provider project, OAuth callback, encrypted OAuth credential store,
or refresh/revoke lifecycle required to make that flow real. The UI says so and
opens the selected provider guidance in the visible Workbench Browser. It keeps
the existing manual transport form under **Advanced: connect an MCP
server** rather than presenting it as normal account setup.

Pipedream and Composio are optional managed adapters, not Ovule runtime
dependencies. The target provider strategy is deliberately layered:

1. implement direct OAuth for the small set of first-party apps that dominate
   ordinary use (initially Gmail/Google, Slack, and GitHub), using Ovule's
   encrypted Host credential store and browser callback;
2. implement the MCP OAuth 2.1/PKCE client flow for application vendors that
   publish a standards-compliant remote MCP server;
3. offer self-hosted connector runtimes for the long tail, with Activepieces as
   the default open-source option and Nango as a source-available product-
   integration option;
4. keep Pipedream Connect and Composio as installable managed choices rather
   than forcing either service on every user.

Activepieces has an MIT-licensed core, self-hosting, and an MCP server on its
free/self-hosted path. Nango is self-hostable under Elastic License 2.0 and is
more directly shaped around embedded account connections, but is source-
available rather than OSI-open-source. n8n remains useful for a user's own
automation server, but its Sustainable Use License and paid embedding boundary
make it a poor default dependency for an embedded Ovule product surface.
None of these removes the need for Ovule to own the one-button account UX,
credential lifecycle, least-privilege grants, and revoke status.

For developers and administrators, a manual connection is stored as an ordinary
enabled Streamable HTTP MCP Tool; there is no second integration registry or
provider-specific Agent runtime.

The data flow is:

1. A provider project or organization administrator provisions the app and
   issues its HTTPS Streamable HTTP MCP server URL. This is not the app's normal
   website URL and is not something an end user should guess.
2. Ovule validates that the endpoint is HTTPS and contains neither embedded
   credentials nor token-like query parameters.
3. The user supplies an environment-variable **name**, never the bearer value.
4. The user selects one or more enabled Agents. `upsertTool` persists the
   endpoint, provider/app label, and credential reference in the existing Tool
   catalog, then adds that Tool ID to each selected Agent profile.
5. Only selected ACP Agents receive the HTTP MCP server through their ACP MCP configuration.
   Ovule native DeepSeek/Ollama turns connect with the official `rmcp`
   Streamable HTTP client.
6. The Host reads the named environment variable only when establishing the MCP
   connection and injects it as an `Authorization: Bearer ...` header.

Connection IDs are derived from provider, application, and endpoint. They never
contain the credential value. The Connected apps list owns only IDs beginning
with `app-`, so removing a connection cannot accidentally delete an unrelated
HTTP MCP Tool. Removal also detaches the Tool ID from every Agent profile before
deleting the Tool.

There is no separate “run connection” button. After account authorization is complete,
the user asks an authorized Agent to act in the named application, for example
“summarize unread Gmail messages” or “create a Linear issue from this thread.”
Ovule injects the connection into that Agent's MCP runtime context and the
Agent chooses the MCP operation required by the request. The surface explains
this trigger path next to the connection form.

Activepieces and Nango are now listed before managed services in the Advanced
provider selector. Pipedream documents an OAuth MCP endpoint at
`https://mcp.pipedream.net/v2`; Composio Connect documents
`https://connect.composio.dev/mcp` with a consumer API-key header. These are
provider protocol entry points, not ready-to-paste account URLs. Ovule's
current HTTP MCP runtime supports only an optional `Authorization: Bearer`
value read from a named environment variable, so it cannot honestly claim
one-click compatibility with Pipedream OAuth discovery or Composio's custom
header yet. `rmcp` has an OAuth/PKCE client feature available, but enabling it is
only one part of the work: Ovule still needs a browser callback, encrypted
credential and state persistence, refresh/revoke handling, and provider-project
configuration. Until that slice lands, local validation of Connected apps uses
an administrator-issued bearer-compatible MCP server in the Advanced section.

## Human handoff message block

The built-in host registry (`io.ovule.host`) declares the trusted
`human-handoff` Message Block renderer and the `human-handoff` / `appshot`
capabilities. An Agent emits a block when login, MFA, CAPTCHA, approval, payment,
or another sensitive visual step needs the user.

The block payload is deliberately small:

```json
{
  "id": "handoff-login",
  "title": "Complete sign-in",
  "instructions": "Finish MFA, then choose Done, continue.",
  "protocol": "spice",
  "target": "spice+tls://desktop.example.com:5900",
  "gatewayUrl": "https://desktop.example.com/session/handoff-login",
  "appshotUrl": "https://desktop.example.com/session/handoff-login/preview.png",
  "appshotAlt": "Sign-in screen"
}
```

`protocol` is `spice` or `browser`. Session targets accept only `https:`,
`spice:`, and `spice+tls:`. Username/password URL fields and common secret,
token, ticket, cookie, credential, session, or signature query parameters are
rejected for the target, gateway, and Appshot. Expired or malformed requests
render as invalid rather than opening a destination.

The Thread renderer shows the handoff card and optional Appshot. Choosing Take
control emits a typed request to the root workbench, which opens an independent
Handoff pane. The pane shows instructions, protocol, endpoint, Appshot, and the
trust warning before the user acts. An HTTPS gateway opens through the existing
Workbench Browser path; a direct SPICE endpoint can be copied for a compatible
client.

When the user chooses Done, continue, Ovule sends this durable Thread message:

`Human handoff completed (<id>). Continue from the verified user-controlled step.`

The Agent must wait for that later message and must not infer success merely
because it emitted the block or because a gateway was opened.

## Remote Control and SPICE boundary

The ordinary Remote Host flow is now Ovule-native: Ovule runs on the Host,
advertises Remote Control through Ovule Link, and a paired Client opens the
desktop directly. No SPICE or WebSocket bridge URL is required. The encrypted
Link connection carries identity, authorization, lease state, CRD SDP/ICE
signaling, input, clipboard, and control messages. Desktop media travels over
CRD's WebRTC transport; the Client automatically reconnects with bounded
exponential backoff.

The Host implementation:

- advertises `desktop.control` when Tuffite's native remoting
  capability is compiled and available;
- creates a fresh CRD Host session for each opened pane;
- relays CRD SDP and ICE messages through the authorized Link connection;
- streams the captured physical desktop as WebRTC video;
- injects pointer movement, clicks, drags, scrolling, text, and key chords;
- writes bounded text clipboard content; and
- accepts those operations only from a paired device.

The Link Client uses a standard `RTCPeerConnection`, renders the received video
track directly, maps input into Host display coordinates, pushes clipboard text,
and reports latency, jitter, estimated bandwidth, and packet loss from WebRTC
stats. Closing the pane stops the Host session; reopening creates a new session
instead of trying to reuse an ended label.

The handoff contract also retains these protocol-neutral and SPICE pieces:

- typed `spice:` / `spice+tls:` endpoints;
- secret-free URL validation;
- Appshot context;
- HTTPS gateway handoff;
- workbench lifecycle and Thread resume message;
- an optional Host-level, credential-free SPICE WebSocket URL for development;
- an embedded `spice-client` renderer with framebuffer display, keyboard/mouse
  forwarding, clipboard integration, Ctrl+Alt+Del, manual reconnect, and bounded
  exponential automatic reconnect.

Ovule Link itself does start with the Host application. Client reachability
polling is sequential to avoid overlapping iroh endpoints and tolerates two
transient handshake failures before changing a previously reachable Host to
Offline; the intermediate state is Reconnecting. This makes Client and Host
status converge without treating one relay/discovery hiccup as a directionally
different online state. Remote Control remains capability-gated: an older Host
can still be online for Workspaces and Agents without advertising the CRD
Remote Control capability, in which case both devices must be updated and
restarted.

The embedded Client speaks SPICE over WebSocket, not native SPICE TCP. The
manual URL lives under **Advanced: manual SPICE bridge** solely for development
and integration testing. Plain `ws://` is restricted to loopback; remote
bridges must use `wss://`. WebSocket URLs cannot contain usernames, passwords,
query parameters, or fragments.

The Host record deliberately stores no SPICE ticket or password. A native SPICE
server, native TCP/TLS transport, secure ticket injection/rotation, certificate
pinning, audio, USB redirection, adaptive video streaming, and explicit
return-to-Agent input arbitration remain future work. Ovule Link Remote
Control uses CRD WebRTC rather than image polling.
A Human handoff carrying only a direct `spice:` target remains copy-only unless
the Host also has a separately configured WebSocket bridge; an HTTPS gateway
continues to use the Workbench Browser.

## Terminal streaming relationship

The bounded Terminal now emits incremental stdout/stderr events on
`ovule:terminal-output`. Each event carries run ID, owning Terminal tab ID,
monotonic sequence, stream, and delta. The owning xterm view renders deltas
immediately, while the final bounded output remains the durable Workspace
snapshot. Streaming fragments never serialize or commit the entire Workspace.

This line-oriented event path is appropriate for bounded one-shot commands. It
does not replace the planned PTY/ConPTY plus DataPipe transport needed for
interactive, high-rate, reconnectable terminal sessions and human takeover.


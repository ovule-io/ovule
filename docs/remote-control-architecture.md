# Remote Control

Remote Control is a Host-owned desktop capability. Its current implementation is
an internal MVP; implementation and loopback tests do not establish WAN performance
or parity with RDP/SPICE. Run acceptance tests against the actual native package.

## Layers and ownership

```text
Remote panel -> SessionController -> InputRouter / StatsSampler
  -> remoting ShellAPI -> Rust client actor -> Host directory / Link transport
  -> HostSessions -> DesktopBackend -> Tuffite CRD / WebRTC
Media: browser video <-> WebRTC <-> native capture/encoder
```

`services/remoting` owns domain models, ports, client actors and Host leases.
The application composes adapters; the domain does not discover a service locator
or select the first Workspace as remote identity. A session binds one Host transport
and remote handle. Local renderer handles and remote handles are distinct.

## Control protocol and lifecycle

Link uses ALPN `ovule/link`, named methods and separately negotiated capabilities
such as `desktop.control`, `desktop.pointer.latest`, `desktop.clipboard.text` and
`computer-use.mcp`. Discover native support after pairing, lazily, so an unready
native service is not cached as permanently unsupported during construction.

`start` returns a local handle immediately and moves network/native work to a
background actor. Shared connections are keyed by Host/device identity and
credential configuration; directory entries hold weak references. Every Host
operation rechecks device ownership. Revocation invalidates sessions, including a
pairing-state recheck when an asynchronous native start completes.

| Limit | Current contract |
| --- | --- |
| Sessions per Host | 4 device-owned sessions |
| Control queue | 64 entries; Stop has an independent wake signal |
| RPC/client/native budgets | 12 / 10 / 5 seconds |
| Host lease / handshake | 20 / 30 seconds |
| Renderer snapshot / grace | 5 / 90 seconds |
| Unacknowledged signaling | 256 items; overflow fails explicitly |

Late native starts are stopped after their creator times out. Renderer snapshots
renew leases and acknowledge/recover missed events; Rust pushes
`ovule:remote-control` updates. Native signaling still requires bounded polling
inside the Host adapter; it is not fully event-driven. Remote Control budgets do
not apply to ordinary Workspace transfers or commands.

Unknown named methods fail only their request. Prefer optional fields and new
capability-negotiated methods over a single global protocol integer. Pair links
contain Host identity, routing information and an invitation, not passwords or a
compatibility decision. The local authorization file's `schema_version` describes
persistence independently of wire capabilities.

## Input and pointer geometry

Keep CRD initialization channels separate from input:

| Channel | Payload | Delivery |
| --- | --- | --- |
| `input-sequenced` | Keys, text, buttons, wheel, drag movement | Reliable, ordered |
| `pointer-latest` | Hover without buttons | Unordered, no retransmission, latest wins |

Frames contain a little-endian u64 sequence followed by CRD EventMessage protobuf.
The native dispatcher rejects stale hover without dropping reliable key/button
events merely because a newer hover arrived first. The hover channel rejects keys,
buttons and wheel. Reliable queues are bounded to 128 messages / 256 KiB; an
individual message is at most 64 KiB. Overload closes the session and releases
native input instead of growing an unbounded backlog.

Map each event through the live video content rectangle, including contain
letterboxing and a narrow edge-snap region. Do not infer remote coordinates from
Client devicePixelRatio or encoder dimensions. Fractional input maps into the Host
capture source's origin and extent; macOS display bounds and Windows normalized
DesktopFrame coordinates account for nonzero origins and scaling. A session pins
its source; an explicit screen ID must match. Legacy integer coordinates are not
proof of correct mapping after encoder downscaling.

Before initial geometry arrives, reject positions while allowing necessary button
releases. Release held input on focus/capture loss, hidden pages, disconnect and
native teardown. Raw model key actions require explicit pressed/released direction;
backend acceptance does not prove focus or shortcut execution. Clipboard text has
its own bounded control path, capped at 1 MiB.

## Media, ICE and recovery

Video goes directly to the native browser video path, never through React state,
JSON or Link. Quality presets request target frame rate and bitrate; capture,
codec support, congestion and decoding determine actual output. Codec advertisement
is not proof that a hardware encoder is enabled in the selected Framework build.

The receiving Host owns `IceConfigProvider`, generates one session configuration,
and sends it to the paired Client over encrypted Link. Clients cannot supply relay
servers. Keep long-lived secrets on the Host; never place them in UI state, pair
links or diagnostics. See [relay deployment](remote-control-relay-deployment.md)
for the generic TURN REST provider and optional Cloudflare implementation.

After a five-second disconnect grace, recovery may create up to two new session
revisions. This does not implement in-place ICE restart, credential refresh or
seamless network migration. Statistics failures do not end an otherwise working
media session. Unknown route/latency values stay unknown.

## Repair boundaries

**Repair this Host** resets incoming pairings/grants owned by the receiving device
and stops their sessions. It preserves Workspace files, SSH and unrelated saved
Remote Hosts. **Reset Link connections** acts on the current Client's connections.
Resetting a Host Link identity rotates its key/invitation and requires new pairings;
it is a separate action from repairing unreadable authorization state.

Do not delete encrypted identities to work around a Keychain error. See
[credential recovery](local-development.md#diagnostics-and-recovery).

## Acceptance

Use `desktop/smoke/remote-control-e2e.mjs` with independent Host/Client processes.
Check pairing, decoded frames, text/IME, clicks at corners/center and scaled edges,
dragging, disconnect releases, Stop, revocation and reconnection. Synthetic IME
events do not replace a real system input method. Test mixed scaling, nonzero
monitor origins and encoder downscaling on the actual target platforms.

Compare performance with fixed machines, capture resolution, display scaling,
network shaping and interactions. Record actual capture/encode/decode FPS, CPU/GPU,
bitrate, freezes and input-to-present p50/p95/p99 for LAN, delayed/lossy links and
TURN. Media RTT is not input-to-present latency. Check multiple sessions, background
operation, crashes and orphan cleanup. Do not claim cross-platform or WAN acceptance
from a local two-process smoke test.

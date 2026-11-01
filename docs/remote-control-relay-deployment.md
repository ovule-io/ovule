# Remote Control relay deployment

Ovule Remote Control keeps ICE policy on the receiving Host. The Client cannot submit STUN or TURN servers. A Host generates one session-scoped configuration, starts native CRD with it, and returns the same configuration to the paired Client over encrypted Ovule Link. The ordinary Remote Control UI never exposes relay URLs, usernames, passwords, or the TURN REST shared secret.

Without a TURN policy the Host advertises three public STUN servers and WebRTC prefers a direct route. Symmetric NAT, CGNAT, enterprise firewalls, and UDP-restricted networks still require a reachable relay.

## coturn / eturnal policy

Configure TURN REST authentication on the relay. For coturn the relevant shape is:

```text
use-auth-secret
static-auth-secret=<at-least-32-random-bytes>
realm=relay.example.com
fingerprint
listening-port=3478
tls-listening-port=443
cert=/run/secrets/turn-cert.pem
pkey=/run/secrets/turn-key.pem
no-multicast-peers
no-loopback-peers
```

Expose UDP/TCP 3478 and TURNS/TCP 443. Allocate a public relay address range and restrict peer ranges according to the deployment network. Relay logs and metrics must never include credentials or media payloads.

## Host provisioning

Provision these variables only on the receiving Host process:

| Variable | Required | Meaning |
| --- | --- | --- |
| `OVULE_TURN_URLS` | for relay | Comma-separated `turn:` / `turns:` URLs; include UDP, TCP and TLS fallbacks |
| `OVULE_TURN_SHARED_SECRET_FILE` | recommended | Path to a protected file containing the coturn/eturnal REST shared secret |
| `OVULE_TURN_SHARED_SECRET` | container fallback | Inline secret; do not combine with the file setting |
| `OVULE_TURN_USERNAME_PREFIX` | optional | Alphanumeric deployment namespace, default `ovule` |
| `OVULE_TURN_TTL_SECONDS` | optional | Credential lifetime from 600 to 86400 seconds, default 86400 |
| `OVULE_STUN_URLS` | optional | Comma-separated `stun:` override; defaults to redundant public STUN endpoints |

Prefer `OVULE_TURN_SHARED_SECRET_FILE` with an ACL readable only by the Ovule service identity. Do not place the shared secret in application manifests, pair links, Workspace state, logs, shell history, or Client configuration.

Example non-secret Host configuration:

```powershell
$env:OVULE_TURN_URLS = "turn:relay.example.com:3478?transport=udp,turn:relay.example.com:3478?transport=tcp,turns:relay.example.com:443?transport=tcp"
$env:OVULE_TURN_SHARED_SECRET_FILE = "C:\ProgramData\Ovule\secrets\turn-rest-secret"
```

At session start the Host creates a TURN REST username containing the expiry, deployment prefix, paired device identity, and random session ID. The credential is `base64(HMAC-SHA1(shared_secret, username))`, as expected by coturn/eturnal REST authentication. The shared secret remains on the Host; only the short-lived username and credential cross encrypted Link and enter Client WebRTC memory. Tuffite builds redact both TURN username and password from Chromium remoting ICE logs behind `TUFFITE_IN_CHROMIUM`; release validation rejects a candidate if the fixture secret or an unredacted password appears.

The current credential lifetime must cover the complete session because native in-place ICE restart and credential rotation are not yet implemented. New and reconnected sessions always receive new credentials. For long-running managed deployments, keep the default 24-hour upper bound until ICE restart is available.

## Enterprise firewall validation

For a deterministic enterprise-network test, deploy coturn on a public VM with a DNS name and trusted TLS certificate. In addition to UDP/TCP 3478 and TURNS/TCP 443, configure a small explicit relay allocation range for the test, for example:

```text
min-port=49160
max-port=49200
external-ip=<public-ip>
```

Allow that relay range through the VM firewall. Launch the receiving Ovule Host from a PowerShell session that contains the Host-only variables:

```powershell
$env:OVULE_TURN_URLS = "turn:relay.example.com:3478?transport=udp,turn:relay.example.com:3478?transport=tcp,turns:relay.example.com:443?transport=tcp"
$env:OVULE_TURN_SHARED_SECRET_FILE = "C:\ProgramData\Ovule\secrets\turn-rest-secret"
& "C:\path\to\ovule.exe"
```

Test from a separately paired Client on the restricted network. Use these stages to distinguish policy problems:

1. Allow UDP and verify a relay candidate can be gathered.
2. Block outbound UDP and allow TCP 3478; reconnect and verify TURN/TCP.
3. Allow only TLS/TCP 443 plus normal HTTPS; reconnect and verify TURNS/TCP.
4. Confirm the Remote Desktop status becomes Connected and that Host logs report a relay route without exposing username/password.

If no relay candidate appears, check DNS, Host clock, REST secret equality, certificate chain, 3478/443 reachability, and the relay allocation range. If a relay candidate appears but ICE still fails, the enterprise firewall may be blocking the returned relay allocation port or TLS interception may not trust the certificate chain.

## Cloudflare Realtime TURN

Cloudflare Realtime TURN generates temporary ICE credentials through its credential API:

```text
POST https://rtc.live.cloudflare.com/v1/turn/keys/<TURN_KEY_ID>/credentials/generate-ice-servers
Authorization: Bearer <TURN_KEY_API_TOKEN>
{"ttl": 86400}
```

Use the `urls`, `username`, and `credential` returned by that API exactly as issued. Do not use the API token or TURN key as a coturn REST shared secret.

Cloudflare support is implemented by the optional
[Cloudflare connectivity extension](../desktop/extensions/cloudflare-connectivity/README.md).
Its trusted native module implements `IceConfigProvider`; the remoting domain sees
only the generic port and ICE model. The module is currently compiled with the
application: installing frontend code does not load arbitrary native providers.

Configure the receiving Host with `/cloudflare`; the extension handles official CLI
authorization, account selection, encrypted TURN-key storage and per-session
credential generation. Client devices need only pairing. Saved configuration and
a successful status refresh do not prove that media used TURN.

The generic TURN REST environment variables are for coturn/eturnal; do not put a
Cloudflare API token in `OVULE_TURN_SHARED_SECRET`. Review current account billing
and traffic limits before enabling a managed relay. Long sessions need reconnect
because in-place credential refresh is not implemented.

## Operations

Monitor direct/relay route ratio, allocation failures, RTT, loss, regional bandwidth, authentication failures, and expired allocations. A production deployment should provide at least two relay regions and multiple URLs per region. WebRTC still prefers direct candidates; provisioning TURN does not force every session through the relay.

If no relay candidate is gathered, verify the REST shared secret, Host clock, URL/transport reachability, certificate chain, and relay port allocation range. If a relay candidate exists but cannot connect, verify that both Client and Host networks can reach the selected UDP/TCP/TLS transport.

## Verify the selected route

The desktop status bar reports the selected ICE candidate pair as direct, TURN or
unknown, with available candidate types and protocol details. Configured servers
are shown separately. A configured Cloudflare provider is not proof that the
selected candidate used Cloudflare; identify the provider only when route evidence
supports it.

Switch connection mode from automatic to TURN-only to rebuild the session with
Client `iceTransportPolicy: relay`. This restricts WebRTC media/input candidates,
not the Host Link control route. Missing relay candidates must fail explicitly.
First test automatic mode, then TURN-only video and input on the same network;
repeat on separate networks and restricted UDP/TCP/TLS routes.

For the packaged Cloudflare setup and relay-only smoke commands, use the extension
README. Require a selected relay pair, decoded frames, keyboard/Unicode input and
Stop cleanup. Synthetic composition events do not replace a real system IME;
check insertion at the caret, navigation, backspace, selection and modifiers.
Single-device relay tests do not replace two-device NAT, firewall, network-change
or weak-network acceptance. Keep run logs private and redact credentials.

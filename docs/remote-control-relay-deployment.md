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

The current Ovule Host provider intentionally accepts a TURN REST shared secret and derives per-device/session credentials itself. It does not yet consume Cloudflare's generated credential response, so Cloudflare TURN cannot currently be configured directly through `OVULE_TURN_SHARED_SECRET[_FILE]`. Supporting it requires a Host-side ICE provider that calls the Cloudflare credential API and keeps the API token on the Host. Until that provider exists, use coturn/eturnal for end-to-end Ovule testing.

Cloudflare's official TURN documentation states that managed TURN is free when used with its Realtime SFU and otherwise charges for outbound TURN traffic; current public product pricing also advertises an included monthly allowance on some plans. Treat the account dashboard and billing page as authoritative rather than assuming the relay is universally free.

Official references:

- <https://developers.cloudflare.com/realtime/turn/>
- <https://developers.cloudflare.com/realtime/turn/generate-credentials/>
- <https://developers.cloudflare.com/realtime/turn/faq/>

## Operations

Monitor direct/relay route ratio, allocation failures, RTT, loss, regional bandwidth, authentication failures, and expired allocations. A production deployment should provide at least two relay regions and multiple URLs per region. WebRTC still prefers direct candidates; provisioning TURN does not force every session through the relay.

If no relay candidate is gathered, verify the REST shared secret, Host clock, URL/transport reachability, certificate chain, and relay port allocation range. If a relay candidate exists but cannot connect, verify that both Client and Host networks can reach the selected UDP/TCP/TLS transport.

## 验证桌面实际选路

远程桌面底部的“连接路径”显示选中 ICE candidate pair 的实际路径：直连或
TURN。悬停查看两端候选类型、可用的协议与中继域名；只有选中候选提供域名时才
标识 Cloudflare。Host 配置的 TURN 服务单独列出，配置成功不代表本次连接使用了
中继，也不代表服务已通过连通性验证。未知候选不显示为直连。

工具栏“连接模式”可选“自动选择”或“仅 TURN 中继”。切换会重建会话；后者为
Client 设置 WebRTC `iceTransportPolicy: relay`，使媒体和输入必须使用 TURN
候选，没有 TURN 时明确失败。它不会改变 Remote Host 的 Link 控制通道选路。
同一 Wi-Fi/VPN 下也能验证 TURN，连接成功后仍应确认底部为 TURN。若 Host 只配置
Cloudflare TURN，此时即可确认通过该服务；缺少选中候选 URL 时不会凭配置冒认。

人工验收：先自动连接并观察路径，再切换仅 TURN 并确认连接成功、视频和输入正常；
最后用不同网络（例如一端手机热点）重复。仅 TURN 成功证明中继路径可用，不替代
实际跨 NAT、网络切换和弱网验证。

中文输入验收：在本机切换中文输入法，远端输入 `yuancheng` 应只得到“远程”；
点击已有文本中间后再次输入，应插入光标处。再检查英文、方向键、退格、拖选和
Ctrl/Cmd 快捷键。新增原生 smoke 会检查首个非 composing 的 `y` keydown、重复
final input 事件及点击后插入，但合成 composition 事件仍不能代替真实系统输入法。

### 2026-10-20 本机回归

已通过 41 项 remoting/本地化测试、8 项消息卡片交互测试、TypeScript/ESLint、
前端生产构建，以及最终 `dist/ovule-remoting-validation` 的两组原生 smoke。
双实例桌面覆盖首帧与重连、9 点坐标、拖动、原生键盘、断线释放，以及点击已有
文本中间后插入 `abc远程def`（无首字母、无重复提交）。Cloudflare 卡片覆盖内容
高度、保存说明、刷新/错误重试、语言切换，使用拦截动作，不创建真实云资源。
另已通过实际路径显示、未配置 TURN 时强制中继明确失败、切回自动模式恢复连接。
真实系统中文输入法、真实 Cloudflare TURN 和跨 NAT/双机验证仍按上方矩阵验收。

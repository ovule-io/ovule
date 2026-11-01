# Cloudflare connection service

在希望被控制的 Host 上安装新 Ovule 后，在对话输入 **`/cloudflare`**。

1. 插件自己的 Web Component 显示当前 Host 的配置卡片。点击“登录 Cloudflare”。
2. 应用自动准备受管理的 Node.js 和固定 **cf 1.0.0-beta.12**。官方 CLI 使用浏览器 PKCE 模式，自动在 Workbench 打开授权页面（可从卡片重新打开），本机 CLI 接收回调；在页面完成授权。如果 Workbench 中 Turnstile 校验反复失败，点击“在系统浏览器继续授权”，复用同一次登录及回调；保持此 Host 的 Ovule 打开。不用注册 Ovule OAuth 应用，也不用复制 API token。
3. 授权范围限于账户/用户读取和 `calls.write`，使用专用 `ovule-connectivity` profile。选择计费账户后点击“在此账户启用连接服务”。Cloudflare 可能收取中继流量费用。
4. Host 服务通过官方 CLI 创建 TURN Key，直接存入加密 SecretStore。API 响应和长期密钥不进入卡片、对话、模型、日志或配对链接。保存失败时，本次创建的 Key 在进程内保留，卡片“重试安全保存”不会重复创建。
5. 其他设备继续使用已有配对打开桌面。直连可用时优先直连；否则 WebRTC ICE 可选 TURN。配置成功只证明配置已保存，实际画面和输入仍需双机验证。

`/cloudflare` 直接展示卡片，不调用 Agent，也不要求先配置模型。离开卡片不撤销 Cloudflare 授权；正在进行的授权可通过卡片取消，授权操作最长 10 分钟。CLI OAuth 凭据强制使用系统安全存储，无法使用时明确失败，不回退明文；Windows 需要官方 CLI 的 keyring backend，Linux 需要可用的系统 secret service/secret-tool。onboarding 不再显示 Cloudflare；配置入口统一为 `/cloudflare`。

TURN 临时凭据每次桌面会话获取，最长有效期 24 小时；目前不支持原位刷新，超长会话需要重连。团队托管 broker 尚未实现。

## Provider boundary

`native/` 是此插件的受信任 native 模块：官方 CLI、Cloudflare API 固定域名、长期凭据 schema 和临时 ICE 凭据生成均在这里。应用组合入口注册插件提供的 `IceConfigProvider`；remoting 核心只依赖这个通用接口和 ICE 数据模型，不认识 Cloudflare、不读取它的 SecretStore，也不依赖 HTTP 客户端。native 模块目前随应用编译；仅安装前端扩展不能装载任意 native 代码。

## Verification

### Windows 单机真实 TURN 验证

使用 Node.js 22.22 或更高版本，在仓库根目录运行：

```powershell
node desktop/smoke/remote-control-e2e.mjs --package-root dist/ovule-dev --connection-only --require-relay --cloudflare-setup --keep-run-root
```

脚本启动隔离数据目录的 Host，打开 `/cloudflare` 卡片。用户在 Host 中登录、
选择账户并启用连接服务后，自动启动独立 Client、完成测试配对并建立桌面。
授权等待默认 600 秒，可通过 `--setup-timeout-seconds` 调整。
原有用户配置不参与测试。`--keep-run-root` 保留终端输出的目录，便于复测；
其中 `host-data/secrets/provider-cloudflare-turn.dpapi` 是加密配置。
Windows 复用该文件需要同一个系统用户。

已配置后可分别限制 Client 到 TURN 的传输方式：

```powershell
node desktop/smoke/remote-control-e2e.mjs --package-root dist/ovule-dev --connection-only --require-relay --cloudflare-credentials "<run-root>/host-data/secrets/provider-cloudflare-turn.dpapi" --turn-transport udp
# 再分别使用 --turn-transport tcp 和 --turn-transport tls（TLS 443）
```

默认 `all` 使用服务下发的全部 URL。传输限制只作用于 Client；Host 仍使用其正常
ICE 策略。验收要求选中 `relay` candidate、收到并解码视频、真实键盘/Unicode
输入以及 Stop 清理；不能用“卡片已保存”或数据通道建立代替。
失败时输出 ICE 状态、候选类型计数、candidate-pair 状态、错误码和解码帧数，
不输出临时 ICE 凭据。无 relay 候选优先排查凭据和 TURN 入口；有 relay 候选但
pair 未成功则排查中继到对端的路径；ICE 成功但零帧则排查采集/编解码。

此测试会实际经过公网 TURN，可在一台设备上排除同网直连的干扰；它不模拟两个
真实 NAT、企业代理或异地链路，也不替代最终双机跨网验收。测试会使用真实中继
流量；手动启用创建的 Cloudflare TURN Key 不会由本机临时目录清理自动撤销。

覆盖真实候选包的 slash 注册、无 Agent 调度、独立组件、账户选择和安全文本渲染；CLI fixture 覆盖固定参数、账户授权边界、错误脱敏、取消、保存重试。这些测试不执行真实 Cloudflare 授权或创建资源。家庭跨 NAT 的首帧、输入和 selected relay route 仍需真实设备验收。

配置卡片的“已保存”仅表示当前 Host 已安全保存管理配置。每次新建远程桌面会话时，
Host 自动向 Cloudflare 获取临时 ICE 凭据并提供给已配对的 Client；Client 无需再
配置 Token。已建立的桌面需要重连以使用新配置。卡片“刷新状态”不测试媒体路径。

自动模式优先使用可用直连，必要时使用 TURN；在桌面底部查看实际路径。使用
“仅 TURN 中继”模式可以在同一 Wi-Fi 下验证中继。新卡片明确区分保存状态和
桌面连通性，并由内容决定高度，不再保留统一的 280px 占位。

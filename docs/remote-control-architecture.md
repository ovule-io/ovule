# Remote Control

目标：以 RDP / SPICE 的交互体验为性能参照，建立可测量、可替换的 Host 级桌面控制能力。当前仍是内部 MVP，wire contract 已重置为无全局代号的稳定接口；完成实现不等于已经证明跨平台或跨网络的性能超越。

## 分层与依赖方向

```text
LinkRemoteControlPanel（呈现、坐标转换、键盘/IME、配置）
  -> SessionController（浏览器连接与恢复、会话 generation）
       -> InputRouter（有界队列、输入释放、通道顺序）
       -> StatsSampler（浏览器 WebRTC 指标）
       -> RemoteControlService port / native ShellAPI adapter
            -> ovule.remoteControl（立即返回的命令映射）
                 -> RemoteControlService（后台会话 actor、renderer 租约）
                      -> HostDirectory port
                           -> DesktopHostDirectory（已保存的 Host 与凭据）
                      -> ControlTransport port
                           -> TunnelTransport（稳定 Link 方法与能力协商）
                                -> HostSessions（设备所有权、租约、容量）
                                     -> DesktopBackend port
                                          -> Tuffite native adapter
                                               -> CRD / WebRTC

媒体：浏览器 <================ WebRTC ================> CRD
```

`src/remote_control/model.rs` 和 `ports.rs` 不依赖 Tuffite、生成的 ShellAPI、Workspace 或具体网络实现。`client.rs` 与 `host.rs` 同样只依赖这些端口。`src/architecture_tests.rs` 固化这条规则。

`WorkspaceService` 不再创建远控 runtime、缓存远控 transport 或同步等待远控 RPC。工作区持久化数据只由 `workspace/control_adapter.rs` 转换成 Host 连接。桌面控制不再选取“第一个 Workspace”作为路由身份。

Composition root 在 `bootstrap.rs` 显式注入目录与事件适配器；没有 Service Locator。原生截图和 Computer Use 继续复用 Tuffite adapter，与交互会话共用底层原生能力。

## 会话与控制协议

- Host Link 使用稳定 ALPN `ovule/link`。原生能力名为 `crd-webrtc`，应用通过 `desktop.control`、`desktop.pointer.latest`、`desktop.clipboard.text` 和 `computer-use.mcp` 等独立 capability 协商功能。
- 原生能力在已配对的 Hello 中惰性发现，避免在应用构造期调用尚未就绪的原生服务，并把瞬时失败缓存成“不支持”。
- `start` 只创建本地句柄并启动后台任务，不在应用共享命令 worker 等待凭据 IO、网络或原生操作。
- 一个客户端 session actor 固定绑定一个 Host transport 和一个远端 session；本地句柄与远端句柄不混用。
- 同一 Host 和设备身份的并发会话共享 Link 连接。目录只保留弱引用；最后一个会话释放后连接可回收，凭据轮换会改变缓存键，凭据不会在每次 RPC 时读取或解密。
- 控制命令经过 64 项有界队列；Stop 使用独立的唤醒信号。实时输入完全走 DataChannel，不退回 Link RPC。
- 远控 Link RPC 有 12 秒 deadline，客户端会话操作预算 10 秒，原生调用预算 5 秒；创建者超时后迟到的原生 Start 结果会被主动 Stop。远控预算不会套用到一般工作区文件传输和命令执行。
- Host 维护最多 4 个设备所有的会话。每个操作验证 owner；关闭幂等，撤权和清理配对使关联会话失效。异步 Start 完成后再次检查配对状态，覆盖撤权竞争。
- Host 租约为 20 秒，握手预算为 30 秒；250ms 回收任务检查撤权、租约和握手状态。renderer 每 5 秒读取本地快照续租，应用侧提供 90 秒宽限以容纳 Chromium 后台定时器降频；窗口崩溃后后台 actor 会停止远端会话。
- Rust actor 接收异步 Host watch 更新，向 renderer 推送 `ovule:remote-control` 事件。Host watch 最多约一秒返回一次；握手阶段内部约 40ms 查询原生信令，稳定态降到约一秒。
- 原生接口当前仍是取信令/读状态，因此 Host watch 是有界异步订阅适配，并非原生事件推送。renderer 不再做 40ms RPC 轮询；5 秒快照负责 ACK、续租与丢失事件补偿。
- 未确认信令最多保留 256 项，落后超过容量会明确失败，不静默丢弃 SDP。

## Link 演进模型

Link 不使用一个全局整数决定整台 Host 是否兼容。请求 envelope 使用稳定的命名方法，例如 `host.hello`、`host.pair`、`workspace.read`、`process.spawn`、`desktop.start` 和 `computer_use.capture`；响应 payload 也使用显式的语义标签。Rust enum 名称、授权文件 schema 和网络方法互不作为彼此的版本来源。

新增功能优先采用以下顺序：

1. 在现有方法中增加有默认值的可选字段；旧接收方忽略未知字段。
2. 增加新的命名方法，并通过 `host.hello` 的 capability 宣告可用性。
3. 只有语义真正不兼容时才增加新的方法或 capability 名称，让旧功能继续可用。

未知方法只让当前请求返回 `unsupported Link method`，不会让配对失效，也不会阻断文件、进程或其他已知能力。Pair link 只携带 Host identity、可拨号地址和一次邀请标识，不携带协议号、用户名、密码或功能判断。这样桌面控制、Workspace、Agent 与 Computer Use 可以独立演进。

## 输入协议与背压

CRD 的标准 `event` / `control` 通道保留用于原生协议初始化。用户输入使用两个按交付语义命名的通道：

| 通道 | 传递内容 | 交付规则 |
| --- | --- | --- |
| `input-sequenced` | 键盘、文本、按钮、滚轮、拖拽移动 | 可靠、有序 |
| `pointer-latest` | 无按钮的悬停移动 | 无序、不重传、latest-wins |

每条输入消息为 `uint64 little-endian sequence + CRD EventMessage protobuf`。原生 `SequencedInputDispatcher` 共享序号状态，拒绝过时悬停包；可靠键/按钮事件不会因为较新的悬停包先到而被丢弃。pointer 通道拒绝按键、按钮和滚轮注入。

客户端每帧合并移动；可靠队列最多 128 条 / 256KiB，单消息最多 64KiB，发送高水位 16KiB；悬停通道高水位 256 字节。过载会结束会话并触发原生输入释放，不无限积压。每个 InputRouter 只属于一个连接，关闭后删除待发消息并移除 drain 回调。

UI 坐标先按 `<video object-fit="contain">` 的实际可见画面映射，再把外围 10px 热区吸附到远端精确边缘，使 Windows 自动隐藏任务栏等边缘交互可达。按钮按下先进入可靠通道，随后才做 best-effort pointer capture；capture 丢失会显式释放按钮。浏览器原生 `requestAnimationFrame` / `cancelAnimationFrame` 通过词法 wrapper 调用，避免被 `InputRouter` 方法接收者污染而触发 `Illegal invocation`。

Controller presentation 使用固定的 48px action toolbar、`minmax(0, 1fr)` frame viewport 和 36px status bar。`ResizeObserver + video metadata` 从 viewport 的实时宽高计算最大 contain 尺寸，使 `<video>` 元素本身等于实际可见帧，而不是让动态状态文字参与高度或命中区域计算。底部左侧在固定高度内直接显示 FPS、Latency、Jitter、Receive rate、Loss 及数值，右侧能力保持 icon + tooltip；数值变化只产生横向内容更新，不改变视频几何。顶部连接状态使用 success/warning/danger token。Hosts 不再暴露 manual SPICE bridge 或 SSH Advanced UI，Remote Control 只由 `desktop.control` capability 启用。

键盘失焦、窗口失焦、页面隐藏时释放按键与按钮；连接关闭也由原生 InputEventTracker 兜底释放。剪贴板文本独立通过控制服务传输，上限 1MiB。

## 媒体策略与扩展点

- 视频进入原生 `<video>`，不会经过 React state、JSON 或 Link。
- 原生采集继续使用变化区域检测、Windows DirectX / macOS SCK 和专用 runner；输入 boost 的周期跟随目标帧率，连续输入唤醒合并，窗口缩短到 100ms。
- 画质档位选择目标帧率和码率上限；WebRTC 继续负责拥塞控制。120fps 是请求目标，实际帧率由采集、编码器、网络和解码能力决定。
- ICE policy 由接收 Host 的 `IceConfigProvider` 独占。Client 的 start request 只包含鉴权、屏幕和画质目标，不能提交网络服务器。Host 生成一份 STUN/TURN 配置，用它启动 native CRD，并通过加密 Link 把同一份配置返回 Client WebRTC。普通 UI 不显示 relay URL 或凭据。没有部署 TURN 时默认使用多个公共 STUN；自托管 Host 使用 TURN REST shared secret 为每个 paired device/session 生成有期限的 HMAC-SHA1 凭据。shared secret 不离开 Host，优先从受保护文件读取。部署方法见 [remote-control-relay-deployment.md](remote-control-relay-deployment.md)。
- Client 记录两侧候选类型和不含凭据的 gathering error code：失败时区分“STUN 未产生公共候选”“直连候选失败、Host deployment 需要 TURN”“TURN 未产生 relay candidate”和“relay candidate 仍不可达”。STUN 不能保证穿透对称 NAT、企业防火墙或 UDP 受限网络，生产部署仍需可用 relay。
- 断连允许 5 秒恢复宽限；失败后以新 session/generation 进行最多两次重建。当前不声称实现了原位 ICE restart 或会话跨网络无缝迁移。
- 原生 codec 广告来自 CRD encoder factory；实际编码器由 WebRTC 协商及构建/硬件支持决定，不把固定 codec 列表当作硬件加速证据。
- 均衡、节能和高响应档优先协商 H264（CRD 只有发现硬件编码支持才会提供该格式），否则依次回退到共同支持的 VP8 / VP9 / AV1；高清晰度档优先 VP9 / AV1。最终以实际 SDP 和运行统计为准。
- 当前 checkout 的 Chromium `remoting_options.gni` 将实验性 `remoting_enable_h264` 固定为 false，并注明上游已知问题。本次保留该默认值，因此默认候选实际可用的编码器仍是 VP8 / VP9 / AV1；H264 协商规则是扩展入口，不能作为已经启用硬件编码的证据。

后续新增 codec、屏幕选择、只读访问或 transport 时，扩展端口和能力模型，保持 UI、会话生命周期与具体实现之间的依赖方向。多客户端共享采集应在确认重复采集成为瓶颈后引入，编码/拥塞控制仍按订阅者隔离。

## 本地授权数据与修复

Host 授权文件使用独立的 `schema_version`，当前为 1。它只描述本地持久化格式，不参与 Link 握手或功能协商。缺少 schema 的历史文件会迁移并保留邀请、已配对设备、Workspace/Agent grants 和 shares；历史 `protocol_major` 字段会被忽略并在重写时移除。

只有文件无法读取/解码、schema 来自未来版本或设备 identity 自相矛盾时，Host 才进入显式修复状态。Hosts 页的 **Repair this Host** 只重置当前接收设备拥有的 incoming pairings 和 grants，并终止相关远控会话；它不删除 Workspace 文件、不清除 SSH，也不修改客户端保存的其他 Remote Hosts。**Reset Link connections** 只处理当前客户端保存的连接，不能修复错误消息中指向的另一台 Host。

若旧包进程仍持有相同 Iroh identity，它可能继续响应旧 `desktop.start` schema。**Reset this Host Link identity** 会停止当前 endpoint、清空 incoming pairings/grants、旋转 Host private key 和 invitation，并重新启动为全新 endpoint；Workspace 文件和 SSH Hosts 保留。所有设备必须使用新的 pair link。Tuffite 在最后一个窗口关闭时立即退出 browser loop，确保 browser 根进程及 renderer/GPU/utility 子进程不会继续托管旧 Host。

## 性能验收

客户端统计使用选中的 ICE candidate pair；视频接收速率、丢包率、解码耗时和 jitter buffer 时延使用采样区间差分。未知值保持未知。统计失败不会终止正常媒体会话。

功能基线使用 `remote-control-e2e.mjs` 的独立 Host / Client 应用，覆盖配对、真实解码、中文输入、拖拽、断连释放和异步 Stop。生命周期与输入拥塞用确定性 Rust / Bun 测试覆盖。

性能比较必须固定同一主机、分辨率、显示缩放、网络整形和交互场景，并对 RDP、SPICE、Ovule 记录：

| 场景 | 指标 |
| --- | --- |
| 1080p / 4K；静止、滚动、拖拽 | CPU/GPU、实际接收速率、捕获/编码/解码帧率 |
| LAN、50/150ms RTT、1%/3% 丢包、TURN | input-to-present p50/p95/p99、冻结率、丢帧 |
| 1 / 4 会话，后台 10 分钟 | 会话/线程/内存稳定性、空信令 RPC 数、凭据读取次数 |
| 断网、崩溃、撤权、快速重连 | 恢复时间、按键释放时间、孤儿会话数量 |

媒体 RTT 不等于 input-to-present；双进程 loopback smoke 也不证明 WAN 性能。未完成这套对照数据前，不宣称达到或超越 RDP / SPICE。

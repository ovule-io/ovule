import { CRD_POINTER_CHANNEL_LABEL, CRD_POINTER_CHANNEL_OPTIONS } from "./crd-wire";
import { hasTurnServer, IceDiagnostics, turnServerLabel } from "./ice";
import { InputRouter } from "./input";
import { StatsSampler } from "./stats";
import type {
  ConnectionOptions,
  ControlApi,
  ControlUpdate,
  InputEvent,
  SessionView,
} from "./model";
import type { RemoteControlService } from "./remoting";

/** Owns one UI session, including replacement connections. No React dependencies. */
export class SessionController {
  private disposed = false;
  private generation = 0;
  private retries = 0;
  private cleanup?: () => void;
  private input?: InputRouter;
  private clipboard?: (text: string) => Promise<void>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private view: SessionView = { status: "connecting" };
  constructor(
    private service: RemoteControlService,
    private endpoint: string,
    private options: ConnectionOptions,
    private video: HTMLVideoElement,
    private changed: (view: SessionView) => void,
  ) {}

  start(): void {
    if (this.disposed) return;
    void this.connect().catch((cause) => this.publish({ status: "error", error: String(cause) }));
  }
  send(input: InputEvent): void {
    if (this.view.status === "connected") this.input?.send(input);
  }
  releaseAll(): void {
    this.input?.releaseAll();
  }
  async pushClipboard(text: string): Promise<void> {
    if (!this.clipboard || this.view.status !== "connected")
      throw new Error("Remote desktop is not connected");
    await this.clipboard(text);
  }
  close(): void {
    this.disposed = true;
    ++this.generation;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.cleanup?.();
    this.cleanup = undefined;
  }
  private publish(next: Partial<SessionView>): void {
    this.view = { ...this.view, ...next };
    if (!this.disposed) this.changed(this.view);
  }
  private async connect(): Promise<void> {
    const generation = ++this.generation;
    const current = () => !this.disposed && generation === this.generation;
    this.publish({
      status: this.retries ? "reconnecting" : "connecting",
      error: undefined,
      network: undefined,
    });
    const peer = new RTCPeerConnection({
      bundlePolicy: "max-bundle",
      iceTransportPolicy: this.options.iceTransportPolicy ?? "all",
    });
    const iceDiagnostics = new IceDiagnostics();
    // CRD uses its standard event/control channels to complete channel negotiation.
    const bootstrap = peer.createDataChannel("event");
    const reliable = peer.createDataChannel("input-sequenced", {
      ordered: true,
    });
    const pointer = peer.createDataChannel(CRD_POINTER_CHANNEL_LABEL, CRD_POINTER_CHANNEL_OPTIONS);
    const incoming: RTCDataChannel[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let api: ControlApi | undefined;
    let id: bigint | undefined;
    let after = 0n;
    let off = () => {};
    let failed = false;
    let signalQueue = Promise.resolve();
    let localDescriptionSent = false;
    let iceConfigured = false;
    let turnStatus: "configured" | "unavailable" | "missing" | undefined;
    let turnServers: string | undefined;
    let pendingIce: RTCIceCandidate[] = [];
    const pendingRemoteIce: RTCIceCandidateInit[] = [];
    let disconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;
    let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
    const later = (action: () => void, delay: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (current()) action();
      }, delay);
      timers.add(timer);
      return timer;
    };
    const input = new InputRouter(reliable, pointer, (cause) => fail(cause));
    this.input = input;
    const cleanup = () => {
      off();
      timers.forEach(clearTimeout);
      timers.clear();
      input.releaseAll();
      input.close();
      if (this.input === input) this.input = undefined;
      this.clipboard = undefined;
      bootstrap.close();
      reliable.close();
      pointer.close();
      incoming.forEach((channel) => channel.close());
      peer.close();
      if (this.video.srcObject) this.video.srcObject = null;
      if (id !== undefined && api) void api.stop(id).catch(() => {});
    };
    this.cleanup = cleanup;
    const fail = (cause: unknown) => {
      if (!current() || failed) return;
      failed = true;
      ++this.generation;
      cleanup();
      const error = cause instanceof Error ? cause.message : String(cause);
      if (this.retries++ < 2) {
        this.publish({ status: "reconnecting", error });
        this.retryTimer = setTimeout(() => {
          if (!this.disposed) this.start();
        }, this.retries * 1500);
      } else this.publish({ status: "error", error });
    };
    const connected = () => {
      if (
        current() &&
        peer.connectionState === "connected" &&
        reliable.readyState === "open" &&
        this.video.readyState >= 2
      ) {
        this.publish({ status: "connected", error: undefined });
        if (handshakeTimer) clearTimeout(handshakeTimer);
        handshakeTimer = undefined;
        stableTimer ??= later(() => {
          this.retries = 0;
        }, 30000);
      }
    };
    reliable.onopen = connected;
    reliable.onerror = () => fail(new Error("Remote input channel failed"));
    reliable.onclose = () => {
      if (current()) fail(new Error("Remote input channel closed"));
    };
    peer.ondatachannel = ({ channel }) => {
      channel.binaryType = "arraybuffer";
      incoming.push(channel);
    };
    peer.ontrack = ({ receiver, track, streams }) => {
      if (!current()) return;
      // Small target rather than forcing zero buffering on every network.
      const lowLatency = receiver as RTCRtpReceiver & {
        jitterBufferTarget?: number;
        playoutDelayHint?: number;
      };
      try {
        const targetMs = this.options.targetFramerate >= 90 ? 0 : 15;
        lowLatency.jitterBufferTarget = targetMs;
        lowLatency.playoutDelayHint = targetMs / 1000;
      } catch {
        /* Optional browser control. */
      }
      this.video.srcObject = streams[0] ?? new MediaStream([track]);
      void this.video.play().then(connected).catch(fail);
    };
    const sendIce = async (candidate: RTCIceCandidate) => {
      if (!current() || !api || id === undefined) return;
      await api.signal(id, {
        sequence: 0n,
        candidates: [
          {
            mid: candidate.sdpMid ?? "0",
            mLineIndex: candidate.sdpMLineIndex ?? 0,
            candidate: candidate.candidate,
          },
        ],
      });
    };
    peer.onicecandidate = ({ candidate }) => {
      if (!candidate || !current()) return;
      iceDiagnostics.recordCandidate("client", candidate.candidate);
      if (!localDescriptionSent) {
        if (pendingIce.length >= 64) fail(new Error("Too many ICE candidates"));
        else pendingIce.push(candidate);
      } else void sendIce(candidate).catch(fail);
    };
    peer.onicecandidateerror = (event) => {
      iceDiagnostics.recordGatheringError(event.errorCode);
    };
    peer.onconnectionstatechange = () => {
      if (!current()) return;
      if (peer.connectionState === "connected") {
        if (disconnectTimer) clearTimeout(disconnectTimer);
        disconnectTimer = undefined;
        connected();
      } else if (peer.connectionState === "disconnected") {
        input.releaseAll();
        this.publish({ status: "reconnecting" });
        disconnectTimer ??= later(() => fail(new Error("Remote desktop recovery timed out")), 5000);
      } else if (peer.connectionState === "failed") {
        fail(
          new Error(
            iceDiagnostics.failureMessage(
              "WebRTC ICE failed",
              peer.connectionState,
              Boolean(peer.remoteDescription),
            ),
          ),
        );
      }
    };
    const consume = (update: ControlUpdate) => {
      if (!current() || id?.toString() !== update.sessionId) return;
      if (update.iceServers && !iceConfigured) {
        iceDiagnostics.setProviderWarning(update.error ?? undefined);
        const servers = update.iceServers.map((server) => ({
          urls: server.urls,
          username: server.username ?? undefined,
          credential: server.credential ?? undefined,
        }));
        if (this.options.iceTransportPolicy === "relay" && !hasTurnServer(servers)) {
          fail(
            new Error(
              update.error
                ? `TURN-only mode: relay service unavailable: ${update.error}`
                : "TURN-only mode requires a Host TURN relay configuration",
            ),
          );
          return;
        }
        turnStatus = update.error
          ? "unavailable"
          : hasTurnServer(servers)
            ? "configured"
            : "missing";
        turnServers = [
          ...new Set(
            servers
              .flatMap((server) =>
                (typeof server.urls === "string" ? [server.urls] : server.urls).map(
                  turnServerLabel,
                ),
              )
              .filter(Boolean),
          ),
        ].join(", ");
        peer.setConfiguration({
          iceTransportPolicy: this.options.iceTransportPolicy ?? "all",
          iceServers: servers,
          bundlePolicy: "max-bundle",
        });
        iceDiagnostics.setServers(servers);
        iceConfigured = true;
      }
      if (update.state === "failed" || update.state === "stopped") {
        fail(new Error(update.error ?? "Remote desktop session ended"));
        return;
      }
      signalQueue = signalQueue
        .then(async () => {
          for (const signal of update.signals) {
            if (!current() || signal.sequence <= after) continue;
            if (!iceConfigured) throw new Error("Host did not provide an ICE configuration");
            if (signal.description) {
              const type = signal.description.type;
              if (type !== "offer" && type !== "answer")
                throw new Error("Unsupported remote SDP type");
              await peer.setRemoteDescription({
                type,
                sdp: signal.description.sdp,
              });
              if (!current()) return;
              for (const candidate of pendingRemoteIce.splice(0)) {
                if (!current()) return;
                await peer.addIceCandidate(candidate);
              }
              if (type === "offer") {
                localDescriptionSent = false;
                this.preferCodecs(peer);
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                if (!current() || !api || id === undefined) return;
                await api.signal(id, {
                  sequence: 0n,
                  description: { type: answer.type, sdp: answer.sdp ?? "" },
                  candidates: [],
                });
                localDescriptionSent = true;
                for (const candidate of pendingIce) await sendIce(candidate);
                pendingIce = [];
              }
            }
            for (const candidate of signal.candidates) {
              if (!current()) return;
              iceDiagnostics.recordCandidate("host", candidate.candidate);
              const ice = {
                sdpMid: candidate.mid,
                sdpMLineIndex: candidate.mLineIndex,
                candidate: candidate.candidate,
              };
              if (peer.remoteDescription) await peer.addIceCandidate(ice);
              else {
                if (pendingRemoteIce.length >= 64)
                  throw new Error("Too many ICE candidates before SDP");
                pendingRemoteIce.push(ice);
              }
            }
            after = signal.sequence;
          }
        })
        .catch(fail);
    };
    const sample = new StatsSampler();
    const stats = async () => {
      try {
        const reports = await peer.getStats();
        if (current())
          this.publish({ network: { ...sample.sample(reports), turnStatus, turnServers } });
      } catch {
        /* Diagnostics do not terminate a working media session. */
      }
      if (current()) later(() => void stats(), document.hidden ? 5000 : 1000);
    };
    const heartbeat = async () => {
      try {
        if (api && id !== undefined) consume(await api.snapshot(id, after));
      } catch (cause) {
        fail(cause);
      }
      if (current()) later(() => void heartbeat(), 5000);
    };
    try {
      api = await this.service.api();
      if (!current()) return;
      off = this.service.observe(consume);
      id = await api.start(this.endpoint, {
        authKey: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
        maxBitrateKbps: this.options.maxBitrateKbps,
        targetFramerate: this.options.targetFramerate,
        screenId: this.options.screenId,
      });
      if (!current()) {
        await api.stop(id);
        return;
      }
      const boundId = id,
        boundApi = api;
      this.clipboard = async (text) => {
        if (current()) await boundApi.clipboard(boundId, text);
      };
      handshakeTimer = later(
        () =>
          fail(
            new Error(
              iceDiagnostics.failureMessage(
                "Remote desktop handshake or first frame timed out",
                peer.connectionState,
                Boolean(peer.remoteDescription),
              ),
            ),
          ),
        // Allow the native startup budget (40s), then media negotiation/first frame.
        60000,
      );
      void heartbeat();
      void stats();
    } catch (cause) {
      fail(cause);
    }
  }

  private preferCodecs(peer: RTCPeerConnection): void {
    const available = RTCRtpReceiver.getCapabilities("video")?.codecs;
    if (!available) return;
    // CRD advertises H264 only when its native hardware encoder is available.
    // The SDP intersection still decides what both peers can actually use.
    const order = this.options.preferDetail
      ? ["video/vp9", "video/av1", "video/h264", "video/vp8"]
      : ["video/h264", "video/vp8", "video/vp9", "video/av1"];
    const priority = (mime: string) => {
      const rank = order.indexOf(mime.toLowerCase());
      return rank < 0 ? order.length : rank;
    };
    const codecs = [...available].sort((a, b) => priority(a.mimeType) - priority(b.mimeType));
    for (const transceiver of peer.getTransceivers()) {
      if (transceiver.receiver.track.kind === "video") transceiver.setCodecPreferences(codecs);
    }
  }
}

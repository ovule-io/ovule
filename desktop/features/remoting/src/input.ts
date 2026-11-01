import { encodeCrdEventMessage } from "./crd-wire";
import type { InputEvent } from "./model";

type Channel = Pick<
  RTCDataChannel,
  | "readyState"
  | "bufferedAmount"
  | "send"
  | "bufferedAmountLowThreshold"
  | "addEventListener"
  | "removeEventListener"
>;
const HIGH_WATER = 16 * 1024;
const MAX_PENDING_BYTES = 256 * 1024;

/** Owned by one session. Never forwards queued input into another connection. */
export class InputRouter {
  private sequence = 0n;
  private closed = false;
  private pending: ArrayBuffer[] = [];
  private pendingBytes = 0;
  private move?: InputEvent;
  private frame?: number;
  private pressed = new Set<number>();
  private buttons = new Set<"left" | "middle" | "right" | "back" | "forward">();
  private point: {
    x: number;
    y: number;
    fractionalX?: number;
    fractionalY?: number;
  } = { x: 0, y: 0 };
  constructor(
    private reliable: Channel,
    private pointer: Channel,
    private failed: (cause: unknown) => void,
    // Browser functions require their native receiver in Chromium. Keep them
    // behind lexical wrappers because calling a parameter property as
    // `this.schedule()` would otherwise bind InputRouter as the receiver.
    private schedule: (callback: FrameRequestCallback) => number = (callback) =>
      requestAnimationFrame(callback),
    private cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {
    reliable.bufferedAmountLowThreshold = HIGH_WATER / 2;
    pointer.bufferedAmountLowThreshold = 0;
    reliable.addEventListener("bufferedamountlow", this.flush);
    pointer.addEventListener("bufferedamountlow", this.flushMove);
  }
  send(input: InputEvent): void {
    if (this.closed || this.reliable.readyState !== "open") return;
    if (input.kind === "mouse") {
      if (input.x !== undefined || input.y !== undefined) {
        this.point = {
          x: input.x ?? this.point.x,
          y: input.y ?? this.point.y,
          fractionalX: input.fractionalX,
          fractionalY: input.fractionalY,
        };
      }
      if (input.button && input.buttonDown !== undefined) {
        if (input.buttonDown) this.buttons.add(input.button);
        else this.buttons.delete(input.button);
      }
      if (
        input.buttonDown === undefined &&
        input.button === undefined &&
        input.wheelDeltaX === undefined &&
        input.wheelDeltaY === undefined
      ) {
        this.move = input;
        if (this.frame === undefined)
          this.frame = this.schedule(() => {
            this.frame = undefined;
            this.flushMove();
          });
        return;
      }
      this.move = undefined; // Discrete events already include the authoritative position.
    }
    if (input.kind === "key") {
      if (input.pressed) this.pressed.add(input.usbKeycode);
      else this.pressed.delete(input.usbKeycode);
    }
    const packet = this.packet(input);
    if (!packet) return;
    if (
      packet.byteLength > 64 * 1024 ||
      this.pending.length >= 128 ||
      this.pendingBytes + packet.byteLength > MAX_PENDING_BYTES
    ) {
      this.close();
      this.failed(new Error("Remote input is congested or exceeds the message limit"));
      return;
    }
    this.pending.push(packet);
    this.pendingBytes += packet.byteLength;
    this.flush();
  }
  private packet(input: InputEvent): ArrayBuffer | undefined {
    const payload = encodeCrdEventMessage(input);
    if (!payload) return;
    const packet = new Uint8Array(8 + payload.byteLength);
    new DataView(packet.buffer).setBigUint64(0, ++this.sequence, true);
    packet.set(payload, 8);
    return packet.buffer;
  }
  private flush = (): void => {
    if (this.closed || this.reliable.readyState !== "open") return;
    try {
      while (this.pending.length && this.reliable.bufferedAmount <= HIGH_WATER) {
        const packet = this.pending.shift()!;
        this.pendingBytes -= packet.byteLength;
        this.reliable.send(packet);
      }
      this.flushMove();
    } catch (cause) {
      this.close();
      this.failed(cause);
    }
  };
  private flushMove = (): void => {
    if (this.closed || !this.move) return;
    // Drag motion shares the reliable channel with button edges. Hover motion
    // can be discarded/reordered and uses the independently sequenced channel.
    const channel =
      this.buttons.size || this.pointer.readyState !== "open" ? this.reliable : this.pointer;
    if (
      channel.readyState !== "open" ||
      channel.bufferedAmount > (channel === this.pointer ? 256 : HIGH_WATER) ||
      this.pending.length
    )
      return;
    const move = this.move;
    this.move = undefined;
    const packet = this.packet(move);
    if (packet) {
      try {
        channel.send(packet);
      } catch (cause) {
        this.close();
        this.failed(cause);
      }
    }
  };
  releaseAll(): void {
    for (const usbKeycode of [...this.pressed])
      this.send({ kind: "key", usbKeycode, pressed: false });
    for (const button of [...this.buttons])
      this.send({ kind: "mouse", ...this.point, button, buttonDown: false });
    this.move = undefined;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.frame !== undefined) this.cancel(this.frame);
    this.reliable.removeEventListener("bufferedamountlow", this.flush);
    this.pointer.removeEventListener("bufferedamountlow", this.flushMove);
    this.pending = [];
    this.pendingBytes = 0;
    this.move = undefined;
    this.pressed.clear();
    this.buttons.clear();
  }
}

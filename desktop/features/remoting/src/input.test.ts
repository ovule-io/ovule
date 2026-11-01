import { describe, expect, test } from "bun:test";
import { InputRouter } from "./input";
import { encodeCrdEventMessage } from "./crd-wire";

class Channel extends EventTarget {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sent: ArrayBuffer[] = [];
  send(value: ArrayBuffer) {
    this.sent.push(value);
  }
}
function harness() {
  const reliable = new Channel(),
    pointer = new Channel();
  const frames: FrameRequestCallback[] = [];
  const failures: unknown[] = [];
  const router = new InputRouter(
    reliable as unknown as RTCDataChannel,
    pointer as unknown as RTCDataChannel,
    (error) => failures.push(error),
    (callback) => {
      frames.push(callback);
      return frames.length;
    },
    () => {},
  );
  return {
    reliable,
    pointer,
    router,
    failures,
    frame: () => frames.shift()?.(0),
  };
}
describe("session-owned input scheduling", () => {
  test("hover is latest-wins and drag shares reliable ordering with button edges", () => {
    const h = harness();
    h.router.send({ kind: "mouse", x: 1, y: 1 });
    h.router.send({ kind: "mouse", x: 2, y: 2 });
    h.frame();
    expect(h.pointer.sent).toHaveLength(1);
    h.router.send({
      kind: "mouse",
      x: 2,
      y: 2,
      button: "left",
      buttonDown: true,
    });
    h.router.send({ kind: "mouse", x: 3, y: 3 });
    h.frame();
    h.router.send({
      kind: "mouse",
      x: 4,
      y: 4,
      button: "left",
      buttonDown: false,
    });
    expect(h.reliable.sent.map((packet) => new DataView(packet).getBigUint64(0, true))).toEqual([
      2n,
      3n,
      4n,
    ]);
  });
  test("close drops all old buffered input even after a channel drain", () => {
    const h = harness();
    h.reliable.bufferedAmount = 100000;
    h.router.send({ kind: "key", usbKeycode: 4, pressed: true });
    h.router.close();
    h.reliable.bufferedAmount = 0;
    h.reliable.dispatchEvent(new Event("bufferedamountlow"));
    h.router.send({ kind: "key", usbKeycode: 4, pressed: false });
    expect(h.reliable.sent).toHaveLength(0);
  });
  test("reliable congestion is bounded and reported instead of accumulating indefinitely", () => {
    const h = harness();
    h.reliable.bufferedAmount = 100000;
    for (let i = 0; i < 200; i++) h.router.send({ kind: "key", usbKeycode: 4, pressed: true });
    expect(h.failures).toHaveLength(1);
    h.reliable.bufferedAmount = 0;
    h.reliable.dispatchEvent(new Event("bufferedamountlow"));
    expect(h.reliable.sent).toHaveLength(0);
  });
  test("blur releases tracked keys and buttons on the same channel", () => {
    const h = harness();
    h.router.send({ kind: "key", usbKeycode: 0x700e1, pressed: true });
    h.router.send({
      kind: "mouse",
      x: 3,
      y: 4,
      button: "left",
      buttonDown: true,
    });
    h.router.releaseAll();
    h.router.releaseAll();
    expect(h.reliable.sent).toHaveLength(4);
  });

  test("release retains fractional position and clears it after legacy pixel input", () => {
    const h = harness();
    const point = { x: 1440, y: 270, fractionalX: 0.75, fractionalY: 0.25 };
    h.router.send({ kind: "mouse", ...point, button: "left", buttonDown: true });
    h.router.releaseAll();
    expect(new Uint8Array(h.reliable.sent[1].slice(8))).toEqual(
      encodeCrdEventMessage({ kind: "mouse", ...point, button: "left", buttonDown: false })!,
    );
    h.router.send({ kind: "mouse", x: 40, y: 50, button: "left", buttonDown: true });
    h.router.releaseAll();
    expect(new Uint8Array(h.reliable.sent[3].slice(8))).toEqual(
      encodeCrdEventMessage({ kind: "mouse", x: 40, y: 50, button: "left", buttonDown: false })!,
    );
  });
});

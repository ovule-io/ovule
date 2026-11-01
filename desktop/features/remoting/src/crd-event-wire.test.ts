import { describe, expect, test } from "bun:test";

import {
  CRD_POINTER_CHANNEL_LABEL,
  CRD_POINTER_CHANNEL_OPTIONS,
  encodeCrdEventMessage,
} from "./crd-wire";

const bytes = (value: Uint8Array | undefined) => Array.from(value ?? []);

describe("CRD event channel wire format", () => {
  test("uses a non-blocking pointer-move channel", () => {
    expect(CRD_POINTER_CHANNEL_LABEL).toBe("pointer-latest");
    expect(CRD_POINTER_CHANNEL_OPTIONS).toEqual({
      ordered: false,
      maxRetransmits: 0,
    });
  });

  test("encodes USB HID key events as EventMessage.key_event", () => {
    expect(bytes(encodeCrdEventMessage({ kind: "key", pressed: true, usbKeycode: 4 }))).toEqual([
      0x1a, 0x04, 0x10, 0x01, 0x18, 0x04,
    ]);
  });

  test("encodes UTF-8 text events for IME commits", () => {
    expect(bytes(encodeCrdEventMessage({ kind: "text", text: "中文" }))).toEqual([
      0x2a, 0x08, 0x0a, 0x06, 0xe4, 0xb8, 0xad, 0xe6, 0x96, 0x87,
    ]);
  });

  test("combines pointer position and button state in one mouse event", () => {
    expect(
      bytes(
        encodeCrdEventMessage({
          kind: "mouse",
          x: 10,
          y: 20,
          button: "left",
          buttonDown: true,
        }),
      ),
    ).toEqual([0x22, 0x08, 0x08, 0x0a, 0x10, 0x14, 0x28, 0x01, 0x30, 0x01]);
  });

  test("encodes session-scoped fractional coordinates in CRD field 13", () => {
    expect(
      bytes(
        encodeCrdEventMessage({
          kind: "mouse",
          x: 10,
          y: 20,
          fractionalX: 0.75,
          fractionalY: 0.25,
        }),
      ),
    ).toEqual([
      0x22, 0x10, 0x08, 0x0a, 0x10, 0x14, 0x6a, 0x0a, 0x0d, 0x00, 0x00, 0x40, 0x3f, 0x15, 0x00,
      0x00, 0x80, 0x3e,
    ]);
  });

  test("rejects incomplete or invalid fractional coordinates", () => {
    for (const point of [
      { fractionalX: 0.5 },
      { fractionalX: NaN, fractionalY: 0.5 },
      { fractionalX: Infinity, fractionalY: 0.5 },
      { fractionalX: -0.1, fractionalY: 0.5 },
      { fractionalX: 0.5, fractionalY: 1.1 },
    ])
      expect(encodeCrdEventMessage({ kind: "mouse", x: 10, y: 20, ...point })).toBeUndefined();
  });
});

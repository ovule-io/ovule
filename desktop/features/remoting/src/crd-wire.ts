import type { InputEvent } from "./model";

const textEncoder = new TextEncoder();

export const CRD_POINTER_CHANNEL_LABEL = "pointer-latest";
export const CRD_POINTER_CHANNEL_OPTIONS: RTCDataChannelInit = {
  ordered: false,
  maxRetransmits: 0,
};

export function encodeCrdEventMessage(input: InputEvent): Uint8Array | undefined {
  if (input.kind === "key" && input.pressed !== undefined && input.usbKeycode !== undefined) {
    return message(3, [fieldVarint(2, input.pressed ? 1 : 0), fieldVarint(3, input.usbKeycode)]);
  }
  if (input.kind === "text" && input.text) {
    return message(5, [fieldBytes(1, textEncoder.encode(input.text))]);
  }
  if (input.kind !== "mouse") return undefined;

  if (input.fractionalX !== undefined || input.fractionalY !== undefined) {
    if (
      !Number.isFinite(input.fractionalX) ||
      !Number.isFinite(input.fractionalY) ||
      input.fractionalX! < 0 ||
      input.fractionalX! > 1 ||
      input.fractionalY! < 0 ||
      input.fractionalY! > 1
    )
      return undefined;
  }

  const fields: Uint8Array[] = [];
  if (input.x !== undefined) fields.push(fieldVarint(1, input.x));
  if (input.y !== undefined) fields.push(fieldVarint(2, input.y));
  if (input.fractionalX !== undefined && input.fractionalY !== undefined) {
    // CRD MouseEvent.fractional_coordinate (13). The authenticated Ovule
    // session fixes the capture source, so screen_id is intentionally omitted.
    fields.push(message(13, [fieldFloat(1, input.fractionalX), fieldFloat(2, input.fractionalY)]));
  }
  if (input.button !== undefined || input.buttonDown !== undefined) {
    const button = mouseButton(input.button);
    if (button === undefined || input.buttonDown === undefined) return undefined;
    fields.push(fieldVarint(5, button), fieldVarint(6, input.buttonDown ? 1 : 0));
  }
  if (input.wheelDeltaX !== undefined) fields.push(fieldFloat(7, input.wheelDeltaX));
  if (input.wheelDeltaY !== undefined) fields.push(fieldFloat(8, input.wheelDeltaY));
  if (input.wheelTicksX !== undefined) fields.push(fieldFloat(9, input.wheelTicksX));
  if (input.wheelTicksY !== undefined) fields.push(fieldFloat(10, input.wheelTicksY));
  return fields.length ? message(4, fields) : undefined;
}

function message(field: number, fields: Uint8Array[]): Uint8Array {
  return fieldBytes(field, concat(fields));
}

function fieldVarint(field: number, value: number): Uint8Array {
  return concat([varint(field << 3), varint(value)]);
}

function fieldBytes(field: number, value: Uint8Array): Uint8Array {
  return concat([varint((field << 3) | 2), varint(value.byteLength), value]);
}

function fieldFloat(field: number, value: number): Uint8Array {
  const bytes = new Uint8Array(5);
  bytes[0] = (field << 3) | 5;
  new DataView(bytes.buffer).setFloat32(1, value, true);
  return bytes;
}

function varint(value: number): Uint8Array {
  let remaining = BigInt.asUintN(64, BigInt(value));
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Uint8Array.from(bytes);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function mouseButton(value?: string): number | undefined {
  return {
    left: 1,
    middle: 2,
    right: 3,
    back: 4,
    forward: 5,
  }[value ?? ""];
}

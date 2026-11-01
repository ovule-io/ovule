import { afterEach, expect, test } from "bun:test";
import { requestRoot } from "./explorer-platform";

const original = {
  window: Object.getOwnPropertyDescriptor(globalThis, "window"),
  location: Object.getOwnPropertyDescriptor(globalThis, "location"),
  tuffite: Object.getOwnPropertyDescriptor(globalThis, "tuffite"),
};
afterEach(() => {
  for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function fixture(
  send: (bridge: EventTarget, request: { requestId: string }, options: unknown) => void,
) {
  const bridge = new EventTarget();
  Object.assign(bridge, {
    postMessage(request: { requestId: string }, options: unknown) {
      send(bridge, request, options);
    },
  });
  Object.defineProperty(globalThis, "tuffite", { configurable: true, value: bridge });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setTimeout, clearTimeout },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin: "https://app.example" },
  });
}
test("root requests accept standard MessageEvent replies and void postMessage", async () => {
  fixture((bridge, request, options) => {
    expect(options).toEqual({ targetOrigin: "https://app.example" });
    queueMicrotask(() => {
      bridge.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://untrusted.example",
          data: { type: "app-response", requestId: request.requestId, result: "wrong origin" },
        }),
      );
      bridge.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://app.example",
          data: { type: "app-response", requestId: "unrelated", result: "wrong request" },
        }),
      );
      bridge.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://app.example",
          data: { type: "app-response", requestId: request.requestId, result: "draft" },
        }),
      );
    });
  });
  expect(await requestRoot("thread.select", { threadId: "" })).toBe("draft");
});
test("root transport errors reject immediately rather than leaving a timed out request", async () => {
  fixture(() => {
    throw new Error("closed window");
  });
  await expect(requestRoot("thread.select", {})).rejects.toThrow("closed window");
});
test("root command failures are returned through the standard response envelope", async () => {
  fixture((bridge, request) =>
    queueMicrotask(() =>
      bridge.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://app.example",
          data: { type: "app-response", requestId: request.requestId, error: "missing Thread" },
        }),
      ),
    ),
  );
  await expect(requestRoot("thread.select", {})).rejects.toThrow("missing Thread");
});

import { expect, test } from "bun:test";
import { recoverExplorerTransfer, requireExplorerTransfer } from "./explorer-transfer";
import type { ExplorerElement, ExplorerTransfer } from "@ovule/shell/explorer";

class Transfer extends EventTarget implements ExplorerTransfer {
  state: ExplorerTransfer["state"] = "pending";
  onstatechange = null;
  closeCalls = 0;
  closeOperation: () => Promise<void> = async () => this.update("closed");
  update(state: ExplorerTransfer["state"]) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
  close() {
    this.closeCalls++;
    return this.closeOperation();
  }
}
const busy = () => new DOMException("Native transaction is busy", "InvalidStateError");
const source = (attach: () => Promise<void>, connected = true) =>
  ({ isConnected: connected, attach }) as unknown as ExplorerElement;

test("unsupported runtimes are rejected before creating a transfer destination", () => {
  expect(() => requireExplorerTransfer({} as ExplorerElement)).toThrow(DOMException);
  expect(() =>
    requireExplorerTransfer({
      attach() {},
      detach() {},
    } as unknown as ExplorerElement),
  ).not.toThrow();
});

test("recovery observes a committed child when its notification follows rejected RPCs", async () => {
  const transfer = new Transfer();
  transfer.closeOperation = async () => {
    setTimeout(() => transfer.update("transferred"), 0);
    throw busy();
  };
  expect(
    await recoverExplorerTransfer(
      source(async () => {
        throw busy();
      }),
      transfer,
    ),
  ).toBe(true);
  expect(transfer.state).toBe("transferred");
  expect(transfer.closeCalls).toBe(1);
});

test("recovery does not miss rollback notifications delivered before the busy response", async () => {
  const transfer = new Transfer();
  let attempts = 0;
  transfer.closeOperation = async () => {
    await Promise.resolve();
    transfer.update("attaching");
    transfer.update("pending");
    throw busy();
  };
  expect(
    await recoverExplorerTransfer(
      source(async () => {
        if (++attempts === 1) throw busy();
        transfer.update("transferred");
      }),
      transfer,
    ),
  ).toBe(false);
  expect(attempts).toBe(2);
  expect(transfer.closeCalls).toBe(1);
});

test("recovery closes abandoned resources when the empty source has been removed", async () => {
  const transfer = new Transfer();
  expect(
    await recoverExplorerTransfer(
      source(async () => {
        throw new Error("Must not attach");
      }, false),
      transfer,
    ),
  ).toBe(false);
  expect(transfer.state).toBe("closed");
  expect(transfer.closeCalls).toBe(1);
});

test("failed rollback releases a pending page instead of retaining an unreachable handle", async () => {
  const transfer = new Transfer();
  const failure = new DOMException("Source frame disappeared", "AbortError");
  await expect(
    recoverExplorerTransfer(
      source(async () => {
        throw failure;
      }),
      transfer,
    ),
  ).rejects.toBe(failure);
  expect(transfer.state).toBe("closed");
});

test("rollback passes the native ownership handle without extracting a token", async () => {
  const transfer = new Transfer();
  let received: unknown;
  const element = {
    isConnected: true,
    attach: async (handle: unknown) => {
      received = handle;
    },
  } as unknown as ExplorerElement;
  expect(await recoverExplorerTransfer(element, transfer)).toBe(false);
  expect(received).toBe(transfer);
});

test("promotion waits for native creation without waiting for page loadstop", async () => {
  const { detachExplorerWhenReady } = await import("./explorer-transfer");
  let reads = 0;
  let detaches = 0;
  const transfer = new Transfer();
  const state = {
    url: "https://example.test/loading",
    title: "Loading",
    canGoBack: false,
    canGoForward: false,
  };
  const element = {
    isConnected: true,
    dataset: {},
    getNavigationState: async () => {
      if (++reads === 1) throw new TypeError("Explorer is not attached");
      return state;
    },
    detach: async () => {
      if (++detaches === 1)
        throw new DOMException("Explorer is not available to detach", "InvalidStateError");
      return transfer;
    },
  } as unknown as ExplorerElement;
  expect(await detachExplorerWhenReady(element, { retryDelayMs: 0 })).toEqual({ state, transfer });
  expect(reads).toBe(3);
  expect(detaches).toBe(2);
});

test("promotion stops when its source is replaced and never retries unknown failures", async () => {
  const { detachExplorerWhenReady } = await import("./explorer-transfer");
  let reads = 0;
  const element = {
    isConnected: true,
    dataset: {},
    getNavigationState: async () => {
      reads++;
      throw new TypeError("Explorer is not attached");
    },
  } as unknown as ExplorerElement;
  await expect(
    detachExplorerWhenReady(element, { retryDelayMs: 0, isCurrent: () => reads === 0 }),
  ).rejects.toThrow("closed before transfer");
  const error = new Error("Unexpected native failure");
  element.getNavigationState = async () => {
    throw error;
  };
  await expect(detachExplorerWhenReady(element)).rejects.toBe(error);
  element.getNavigationState = async () => {
    throw new TypeError("Explorer is not attached");
  };
  await expect(detachExplorerWhenReady(element, { timeoutMs: 0 })).rejects.toThrow(
    "did not become ready",
  );
});

test("promotion waits for a file preview grant before touching the native guest", async () => {
  const { detachExplorerWhenReady } = await import("./explorer-transfer");
  let reads = 0;
  const element = {
    isConnected: true,
    dataset: { previewPending: "true" },
    getNavigationState: async () => {
      reads++;
      return { url: "file:///image.svg" };
    },
    detach: async () => new Transfer(),
  } as unknown as ExplorerElement;
  const operation = detachExplorerWhenReady(element, { retryDelayMs: 0 });
  expect(reads).toBe(0);
  element.dataset.previewPending = "false";
  await operation;
  expect(reads).toBe(1);
});

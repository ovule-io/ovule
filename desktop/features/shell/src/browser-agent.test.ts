import { expect, test } from "bun:test";
import type { ExplorerElement } from "./explorer";
import { createBrowserAgent, receiveBrowserAgent } from "./browser-agent";

function surface() {
  const target = new EventTarget() as ExplorerElement;
  Object.assign(target, {
    isConnected: true,
    getNavigationState: async () => ({ documentId: "document-1", url: "https://fixture.test" }),
    capturePreview: async () => "data:image/png;base64,AQID",
    executeJavaScript: async () => ({ text: "same live page" }),
  });
  return target;
}
const metadata = { attemptId: "attempt-test", partition: "memory:agent-test", userControl: false };

test("native receiver replaces the source without closing the Attempt", async () => {
  let closed = 0,
    destinationClosed = 0;
  const agent = createBrowserAgent(metadata, () => closed++);
  const source = surface(),
    destination = surface();
  const removeSource = agent.bind(source, () => {});
  await agent.beginTransfer();
  agent.bind(destination, () => destinationClosed++);
  removeSource();
  agent.finishTransfer();
  expect(closed).toBe(0);
  expect(await agent.call({ action: "snapshot" })).toEqual({ text: "same live page" });
  agent.toggleControl();
  await expect(agent.call({ action: "click", ref: "1:0" })).rejects.toThrow("User has control");
  expect(await agent.call({ action: "screenshot" })).toMatchObject({ isError: false });
  agent.close();
  agent.close();
  expect(closed).toBe(1);
  expect(destinationClosed).toBe(1);
});

test("independent-window port carries tools, control and Attempt cleanup", async () => {
  const parent = createBrowserAgent(metadata, () => {});
  parent.bind(surface(), () => {});
  await parent.beginTransfer();
  const transfer = parent.prepareWindow();
  let windowClosed = 0;
  const receiver = receiveBrowserAgent(
    transfer.port,
    transfer.metadata,
    surface(),
    () => windowClosed++,
  );
  transfer.commit();
  parent.finishTransfer();
  expect(await parent.call({ action: "snapshot" })).toEqual({ text: "same live page" });
  receiver.toggleControl();
  let failure = "";
  try {
    await parent.call({ action: "type", ref: "1:0", text: "blocked" });
  } catch (error) {
    failure = String(error);
  }
  expect(failure).toContain("User has control");
  const done = new Promise<void>((resolve) =>
    receiver.subscribe(() => {
      if (receiver.status() === "closed") resolve();
    }),
  );
  parent.close();
  await done;
  expect(windowClosed).toBe(1);
});

test("failed promotion restores the source and requires fresh refs", async () => {
  const agent = createBrowserAgent(metadata, () => {}),
    source = surface();
  agent.bind(source, () => {});
  await agent.call({ action: "snapshot" });
  await agent.beginTransfer();
  await expect(agent.call({ action: "screenshot" })).rejects.toThrow("moving");
  const transfer = agent.prepareWindow();
  transfer.cancel();
  agent.activate(source);
  agent.finishTransfer();
  await expect(agent.call({ action: "click", ref: "1:0" })).rejects.toThrow("fresh snapshot");
  expect(await agent.call({ action: "snapshot" })).toEqual({ text: "same live page" });
  agent.close();
});

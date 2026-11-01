import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { installExplorerEscape } from "./explorer-escape";
import type { ExplorerElement } from "@ovule/shell/explorer";

function fixture() {
  const element = new EventTarget() as ExplorerElement;
  const document = new EventTarget();
  let currentDocument = "document";
  const context = { document };
  element.executeJavaScript = async (script) => await runInNewContext(script, context);
  element.getNavigationState = async () => ({ documentId: currentDocument }) as never;
  const commit = (documentId = "document") => {
    currentDocument = documentId;
    element.dispatchEvent(new CustomEvent("loadcommit", { detail: { documentId } }));
  };
  const key = (value = "Escape", composing = false) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: value, isComposing: composing });
    document.dispatchEvent(event);
    return event;
  };
  return { element, commit, key };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("Escape inside a guest document cancels the overlay, but composition and other keys do not", async () => {
  const value = fixture();
  let closed = 0;
  const dispose = installExplorerEscape(value.element, () => closed++, 1);
  value.commit();
  value.key("Enter");
  value.key("Escape", true);
  await settle();
  expect(closed).toBe(0);
  expect(value.key().defaultPrevented).toBe(true);
  await settle();
  expect(closed).toBe(1);
  dispose();
});

test("promotion removes the overlay shortcut and a failed transfer can restore it", async () => {
  const value = fixture();
  let closed = 0;
  const dispose = installExplorerEscape(value.element, () => closed++, 1);
  value.commit();
  await dispose.pause();
  expect(value.key().defaultPrevented).toBe(false);
  dispose.resume();
  await settle();
  value.key();
  await settle();
  expect(closed).toBe(1);
  dispose();
});

test("navigation replaces the listener and teardown cannot close a later overlay", async () => {
  const value = fixture();
  let closed = 0;
  const dispose = installExplorerEscape(value.element, () => closed++, 1);
  value.commit("first");
  value.commit("second");
  dispose();
  await settle();
  expect(value.key().defaultPrevented).toBe(false);
  await settle();
  expect(closed).toBe(0);
});

test("an already attached Agent page gets Escape without waiting for another navigation", async () => {
  const value = fixture();
  let closed = 0;
  const dispose = installExplorerEscape(value.element, () => closed++, 1);
  await settle();
  value.key();
  await settle();
  expect(closed).toBe(1);
  dispose();
});

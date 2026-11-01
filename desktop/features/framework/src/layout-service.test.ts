import { expect, test } from "bun:test";
import { createFrameworkLayoutService } from "./layout-service";

test("workbench opens at 360px regardless of previous panel or window resizing", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const layout = createFrameworkLayoutService(storage);
  expect(layout.current().workbenchWidth).toBe(360);
  layout.setWorkbenchWidth(1200);
  expect(layout.current().workbenchWidth).toBe(1200);
  expect(createFrameworkLayoutService(storage).current().workbenchWidth).toBe(360);
  layout.openWorkbench();
  expect(layout.current().workbenchWidth).toBe(360);
  layout.setWorkbenchWidth(900);
  layout.openWorkbench();
  expect(layout.current().workbenchWidth).toBe(900);
  layout.closeWorkbench();
  layout.openWorkbench();
  expect(layout.current().workbenchWidth).toBe(360);
  layout.setWorkbenchWidth(200);
  expect(layout.current().workbenchWidth).toBe(320);
});

test("every opening path shares one serialized resize and a close during opening is honored", async () => {
  const transitions: boolean[] = [];
  let release: (() => void) | undefined;
  const layout = createFrameworkLayoutService(undefined, async (open, commit) => {
    transitions.push(open);
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    commit();
  });
  layout.openWorkbench();
  layout.openWorkbench();
  expect(transitions).toEqual([true]);
  expect(layout.current().workbenchOpen).toBe(false);
  expect(layout.current().workbenchTransitioning).toBe(true);
  layout.closeWorkbench();
  release?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(transitions).toEqual([true, false]);
  release?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(layout.current().workbenchOpen).toBe(false);
  expect(layout.current().workbenchTransitioning).toBe(false);
});

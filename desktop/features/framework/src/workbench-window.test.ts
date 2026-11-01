import { expect, test } from "bun:test";
import { createWorkbenchWindow } from "./workbench-window";
import type { WindowApi, WindowInfo } from "@ovule/shell/window";

function fixture(width = 900, x = 100) {
  let current: WindowInfo = {
    id: 1n,
    maximized: false,
    minimized: false,
    fullscreen: false,
    bounds: { x, y: 80, width, height: 700 },
  };
  const calls: unknown[] = [];
  const api = {
    current: async () => current,
    setBounds: async (bounds) => {
      calls.push(bounds);
      current = { ...current, bounds };
      return current;
    },
  } as WindowApi;
  return {
    api,
    calls,
    current: () => current,
    screen: { availWidth: 1920, availLeft: 0 } as Screen,
  };
}

test("opening adds the panel without taking conversation width and repeated toggles restore width", async () => {
  const f = fixture();
  const resize = createWorkbenchWindow();
  for (let i = 0; i < 2; i++) {
    await resize(f.api, true, 460, f.screen);
    expect(f.current().bounds).toMatchObject({ x: 100, y: 80, width: 1364 });
    await resize(f.api, false, 460, f.screen);
    expect(f.current().bounds?.width).toBe(900);
  }
});

test("opening at a screen edge retains position and conversation width", async () => {
  const f = fixture(1700, 200);
  const resize = createWorkbenchWindow();
  await resize(f.api, true, 460, f.screen);
  expect(f.current().bounds).toMatchObject({ x: 200, width: 2164 });
  await resize(f.api, false, 460, f.screen);
  expect(f.current().bounds?.width).toBe(1700);
});

test("native minimum includes the open workbench and is lowered before hiding", async () => {
  const f = fixture(576);
  const minimums: number[] = [];
  f.api.setConstraints = async (constraints) => {
    minimums.push(constraints.minWidth);
    return f.current();
  };
  const resize = createWorkbenchWindow();
  await resize(f.api, true, 360, f.screen);
  expect(minimums).toEqual([900]);
  expect(f.current().bounds?.width).toBe(940);
  await resize(f.api, false, 360, f.screen);
  expect(minimums).toEqual([900, 576]);
  expect(f.current().bounds?.width).toBe(576);
});

test("negative display coordinates are retained and maximized windows are left alone", async () => {
  const f = fixture(900, -1400);
  const resize = createWorkbenchWindow();
  await resize(f.api, true, 460, { availWidth: 1920, availLeft: -1920 } as Screen);
  expect(f.current().bounds?.x).toBe(-1400);
  f.current().maximized = true;
  await resize(f.api, false, 460, f.screen);
  expect(f.calls).toHaveLength(1);
});

test("closing removes the current panel width after a separator drag", async () => {
  const f = fixture();
  const resize = createWorkbenchWindow();
  await resize(f.api, true, 460, f.screen);
  await resize(f.api, false, 600, f.screen);
  expect(f.current().bounds?.width).toBe(760);
  await resize(f.api, true, 600, f.screen);
  expect(f.current().bounds?.width).toBe(1364);
});

test("hiding a workbench opened elsewhere removes its current width", async () => {
  const f = fixture(1364);
  await createWorkbenchWindow()(f.api, false, 460, f.screen);
  expect(f.current().bounds?.width).toBe(900);
});

test("hiding keeps the Bootstrap small-breakpoint native minimum", async () => {
  const f = fixture(940);
  await createWorkbenchWindow()(f.api, false, 500, f.screen);
  expect(f.current().bounds).toMatchObject({ x: 100, y: 80, width: 576 });
});

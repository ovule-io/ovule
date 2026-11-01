import { describe, expect, test } from "bun:test";
import { remotePointFromClient, remotePointerFromClient } from "./pointer";

describe("remote pointer geometry", () => {
  const bounds = { left: 100, top: 50, width: 1000, height: 700 };

  test("maps the center of an object-contained frame", () => {
    expect(remotePointFromClient(600, 400, bounds, 1600, 900)).toEqual({
      x: 800,
      y: 450,
    });
  });

  test("snaps the visible frame hot zones to remote desktop edges", () => {
    expect(remotePointFromClient(104, 400, bounds, 1600, 900).x).toBe(0);
    expect(remotePointFromClient(1096, 400, bounds, 1600, 900).x).toBe(1599);
    expect(remotePointFromClient(600, 741, bounds, 1600, 900).y).toBe(899);
  });

  test("letterbox areas still target the nearest remote edge", () => {
    expect(remotePointFromClient(600, 50, bounds, 1600, 900).y).toBe(0);
    expect(remotePointFromClient(600, 750, bounds, 1600, 900).y).toBe(899);
  });

  test("keeps Retina video pixels independent of Client display scaling", () => {
    const frame = { left: 240, top: 80, width: 900, height: 600 };
    expect(remotePointFromClient(690, 380, frame, 3000, 2000)).toEqual({
      x: 1500,
      y: 1000,
    });
    expect(remotePointFromClient(465, 230, frame, 3000, 2000)).toEqual({
      x: 750,
      y: 500,
    });
  });

  test("recomputes origin and scale when Workbench expands or moves the video", () => {
    const collapsed = { left: 800, top: 120, width: 600, height: 400 };
    const expanded = { left: 60, top: 40, width: 1200, height: 800 };
    expect(remotePointFromClient(950, 220, collapsed, 3000, 2000)).toEqual({
      x: 750,
      y: 500,
    });
    expect(remotePointFromClient(360, 240, expanded, 3000, 2000)).toEqual({
      x: 750,
      y: 500,
    });
  });

  test("maps a portrait Host frame inside a wide expanded Workbench", () => {
    const wide = { left: 100, top: 40, width: 1200, height: 800 };
    expect(remotePointFromClient(700, 440, wide, 1200, 1920)).toEqual({
      x: 600,
      y: 960,
    });
    expect(remotePointFromClient(575, 240, wide, 1200, 1920)).toEqual({
      x: 300,
      y: 480,
    });
  });

  test("keeps fractional input stable when a 4K Host video is downscaled", () => {
    const frame = { left: 100, top: 50, width: 960, height: 540 };
    const full = remotePointerFromClient(820, 185, frame, 3840, 2160);
    const reduced = remotePointerFromClient(820, 185, frame, 1920, 1080);
    expect(full).toEqual({ x: 2880, y: 540, fractionalX: 0.75, fractionalY: 0.25 });
    expect(reduced).toEqual({ x: 1440, y: 270, fractionalX: 0.75, fractionalY: 0.25 });
  });

  test("sends exact fractional edges after expansion and letterboxing", () => {
    const frame = { left: 100, top: 50, width: 1000, height: 700 };
    const left = remotePointerFromClient(104, 50, frame, 3840, 2160);
    const right = remotePointerFromClient(1096, 750, frame, 1920, 1080);
    expect([left.fractionalX, left.fractionalY]).toEqual([0, 0]);
    expect([right.fractionalX, right.fractionalY]).toEqual([1, 1]);
  });
});

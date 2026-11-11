import { describe, expect, it } from "vitest";
import {
  AVATAR_EDGE,
  INITIAL_CROP,
  MAX_ZOOM,
  MIN_ZOOM,
  clampCrop,
  outputEdge,
  sourceRect,
  zoomCrop,
  type SourceRect,
} from "./avatarCrop";

const PORTRAIT = { w: 3024, h: 4032 };
const LANDSCAPE = { w: 4032, h: 3024 };
const SMALL = { w: 200, h: 150 };

function expectRect(actual: SourceRect, expected: SourceRect) {
  expect(actual.sx).toBeCloseTo(expected.sx, 6);
  expect(actual.sy).toBeCloseTo(expected.sy, 6);
  expect(actual.side).toBeCloseTo(expected.side, 6);
}

describe("sourceRect", () => {
  it("takes the centred square of a portrait at the starting zoom", () => {
    const rect = sourceRect(PORTRAIT.w, PORTRAIT.h, INITIAL_CROP);
    expectRect(rect, { sx: 0, sy: 504, side: 3024 });
    expect(outputEdge(rect.side)).toBe(AVATAR_EDGE);
  });

  it("takes the top of a portrait dragged as far down as it goes", () => {
    const state = clampCrop({ zoom: 1, x: 0, y: 9999 }, PORTRAIT.w, PORTRAIT.h);
    expect(state).toEqual({ zoom: 1, x: 0, y: 48 });
    expectRect(sourceRect(PORTRAIT.w, PORTRAIT.h, state), { sx: 0, sy: 0, side: 3024 });
  });

  it("takes the bottom-right corner of a landscape zoomed in and dragged up and left", () => {
    const state = clampCrop({ zoom: 2, x: -9999, y: -9999 }, LANDSCAPE.w, LANDSCAPE.h);
    expect(state.x).toBeCloseTo(-240, 6);
    expect(state.y).toBeCloseTo(-144, 6);
    expectRect(sourceRect(LANDSCAPE.w, LANDSCAPE.h, state), {
      sx: 2520,
      sy: 1512,
      side: 1512,
    });
  });

  it("keeps a picture smaller than the saved size at its own size", () => {
    const rect = sourceRect(SMALL.w, SMALL.h, INITIAL_CROP);
    expectRect(rect, { sx: 25, sy: 0, side: 150 });
    expect(outputEdge(rect.side)).toBe(150);

    const zoomed = sourceRect(SMALL.w, SMALL.h, { zoom: 2, x: 0, y: 0 });
    expectRect(zoomed, { sx: 62.5, sy: 37.5, side: 75 });
    expect(outputEdge(zoomed.side)).toBe(75);
  });

  it("never reaches outside the picture once clamped", () => {
    const states = [
      { zoom: 1, x: 500, y: -500 },
      { zoom: 1.37, x: -80, y: 210 },
      { zoom: 2.5, x: 9999, y: 9999 },
      { zoom: 4, x: -9999, y: 12 },
      { zoom: 9, x: 3, y: -3 },
      { zoom: 0.2, x: 40, y: 40 },
    ];
    for (const { w, h } of [PORTRAIT, LANDSCAPE, SMALL]) {
      for (const raw of states) {
        const state = clampCrop(raw, w, h);
        expect(state.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
        expect(state.zoom).toBeLessThanOrEqual(MAX_ZOOM);
        const { sx, sy, side } = sourceRect(w, h, state);
        expect(sx).toBeGreaterThanOrEqual(-1e-9);
        expect(sy).toBeGreaterThanOrEqual(-1e-9);
        expect(sx + side).toBeLessThanOrEqual(w + 1e-9);
        expect(sy + side).toBeLessThanOrEqual(h + 1e-9);
      }
    }
  });
});

describe("zoomCrop", () => {
  it("keeps the point in the middle of the frame in place", () => {
    const before = clampCrop({ zoom: 1.5, x: 30, y: -20 }, PORTRAIT.w, PORTRAIT.h);
    const after = zoomCrop(before, 2.5, PORTRAIT.w, PORTRAIT.h);
    const centre = (r: SourceRect) => [r.sx + r.side / 2, r.sy + r.side / 2];
    const [bx, by] = centre(sourceRect(PORTRAIT.w, PORTRAIT.h, before));
    const [ax, ay] = centre(sourceRect(PORTRAIT.w, PORTRAIT.h, after));
    expect(ax).toBeCloseTo(bx, 6);
    expect(ay).toBeCloseTo(by, 6);
  });

  it("pulls an edge back in when zooming out would show past it", () => {
    const zoomedIn = clampCrop({ zoom: 4, x: 9999, y: 0 }, LANDSCAPE.w, LANDSCAPE.h);
    const out = zoomCrop(zoomedIn, 1, LANDSCAPE.w, LANDSCAPE.h);
    expect(sourceRect(LANDSCAPE.w, LANDSCAPE.h, out).sx).toBeCloseTo(0, 6);
  });
});

/** Longest edge of a saved profile photo; matches the avatar compression size in uploadImage. */
export const AVATAR_EDGE = 400;
/** On-screen edge of the square crop frame, in CSS pixels. */
export const VIEWPORT = 288;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/**
 * Zoom is relative to the scale at which the picture's shorter side just
 * fills the frame. x and y run from the frame's centre to the picture's
 * centre, in frame pixels, so a positive x shows more of the picture's left.
 */
export type CropState = { zoom: number; x: number; y: number };

export type SourceRect = { sx: number; sy: number; side: number };

export const INITIAL_CROP: CropState = { zoom: 1, x: 0, y: 0 };

/** Frame pixels per source pixel at the given zoom. */
export function displayScale(w: number, h: number, viewport: number, zoom: number): number {
  return (viewport / Math.min(w, h)) * zoom;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Keeps the zoom in range and the picture covering the whole frame. */
export function clampCrop(state: CropState, w: number, h: number, viewport: number): CropState {
  const zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
  const s = displayScale(w, h, viewport, zoom);
  const maxX = (w * s - viewport) / 2;
  const maxY = (h * s - viewport) / 2;
  return { zoom, x: clamp(state.x, -maxX, maxX), y: clamp(state.y, -maxY, maxY) };
}

/** Zooms about the frame's centre, so the point in the middle stays put. */
export function zoomCrop(
  state: CropState,
  nextZoom: number,
  w: number,
  h: number,
  viewport: number,
): CropState {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const ratio = zoom / state.zoom;
  return clampCrop({ zoom, x: state.x * ratio, y: state.y * ratio }, w, h, viewport);
}

/** The square of the source picture, in source pixels, that the frame shows. */
export function sourceRect(w: number, h: number, viewport: number, state: CropState): SourceRect {
  const s = displayScale(w, h, viewport, state.zoom);
  return {
    sx: w / 2 - (viewport / 2 + state.x) / s,
    sy: h / 2 - (viewport / 2 + state.y) / s,
    side: viewport / s,
  };
}

/** A picture smaller than the saved size is kept at its own size, never enlarged. */
export function outputEdge(side: number): number {
  return Math.max(1, Math.min(AVATAR_EDGE, Math.round(side)));
}

/**
 * Draws the framed square to a JPEG. Browsers apply a photo's rotation flag
 * when decoding into an <img>, and the canvas output carries no flag, so the
 * saved square is upright and is not rotated again on compression.
 */
export async function renderCrop(
  img: HTMLImageElement,
  state: CropState,
  viewport: number,
): Promise<File> {
  const { sx, sy, side } = sourceRect(img.naturalWidth, img.naturalHeight, viewport, state);
  const edge = outputEdge(side);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, edge, edge);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("Canvas produced no image");
  return new File([blob], "avatar.jpg", { type: "image/jpeg" });
}

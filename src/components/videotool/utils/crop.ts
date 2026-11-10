import type { CropRect } from "../types";

export type CropHandle = "tl" | "tr" | "bl" | "br";

/** "9:16" → 9 / 16. */
export function aspectValue(aspect: string): number {
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
}

/** The largest box of the ratio that fits the frame, centred. */
export function fitAspect(frame: { w: number; h: number }, aspect: string): CropRect {
  const r = aspectValue(aspect);
  const w = Math.min(frame.w, frame.h * r);
  const h = w / r;
  return { x: Math.round((frame.w - w) / 2), y: Math.round((frame.h - h) / 2), w: Math.round(w), h: Math.round(h) };
}

/**
 * Resizes `start` by dragging a corner by (dx, dy) image pixels while keeping
 * its ratio. The opposite corner stays put and the box stays inside the frame.
 */
export function resizeLocked(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  frame: { w: number; h: number },
  ratio: number,
  min = 20,
): CropRect {
  const fromLeft = handle === "tl" || handle === "bl";
  const fromTop = handle === "tl" || handle === "tr";
  const anchorX = fromLeft ? start.x + start.w : start.x;
  const anchorY = fromTop ? start.y + start.h : start.y;
  const roomX = fromLeft ? anchorX : frame.w - anchorX;
  const roomY = fromTop ? anchorY : frame.h - anchorY;
  const maxW = Math.min(roomX, roomY * ratio);
  // Follow whichever axis the pointer moved further along.
  const wantW = start.w + (fromLeft ? -dx : dx);
  const wantH = start.h + (fromTop ? -dy : dy);
  const w = Math.max(Math.min(min, maxW), Math.min(maxW, Math.max(wantW, wantH * ratio)));
  const h = w / ratio;
  return {
    x: Math.round(fromLeft ? anchorX - w : anchorX),
    y: Math.round(fromTop ? anchorY - h : anchorY),
    w: Math.round(w),
    h: Math.round(h),
  };
}

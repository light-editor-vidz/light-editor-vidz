/** Où l'image se pose dans le cadre 9:16 que produira l'export (`video_filters::reframe`). */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** L'image ajustée au cadre : contenue en entier (`contain`) ou le couvrant, centrée. */
export function fitBox(
  picture: { w: number; h: number },
  frame: { w: number; h: number },
  mode: "contain" | "cover",
): Box {
  const pick = mode === "contain" ? Math.min : Math.max;
  const scale = pick(frame.w / picture.w, frame.h / picture.h);
  const w = picture.w * scale;
  const h = picture.h * scale;
  return { x: (frame.w - w) / 2, y: (frame.h - h) / 2, w, h };
}

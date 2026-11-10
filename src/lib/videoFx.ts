// Filtre de couleur et recadrage d'une vidéo posée dans une scène : l'aperçu CSS décrit la même
// chose que ce que l'export demande à ffmpeg (`scene_core::video_fx`).

import type { CSSProperties } from "react";
import type { VideoCrop } from "../bindings/VideoCrop";
import filters from "../../crates/scene-core/src/video_fx_filters.json";

export interface ColorFilterDef {
  id: string;
  nameEn: string;
  nameFr: string;
  css: string;
  ffmpeg: string;
}

export const COLOR_FILTERS: ColorFilterDef[] = filters;

/** Le filtre CSS de l'aperçu pour l'identifiant `id` (rien pour « aucun » ou un identifiant inconnu). */
export function cssFilterFor(id: string | null | undefined): string | undefined {
  const css = COLOR_FILTERS.find((f) => f.id === id)?.css;
  return css && css !== "none" ? css : undefined;
}

export const FULL_CROP: VideoCrop = { x: 0, y: 0, w: 1, h: 1 };

/** Borne la zone dans l'image, avec une taille minimale. */
export function clampCrop(c: VideoCrop): VideoCrop {
  const min = 0.02;
  const w = Math.min(1, Math.max(min, c.w));
  const h = Math.min(1, Math.max(min, c.h));
  return { x: Math.min(1 - w, Math.max(0, c.x)), y: Math.min(1 - h, Math.max(0, c.y)), w, h };
}

export const isFullCrop = (c: VideoCrop | null | undefined): boolean =>
  !c || (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1);

/** `object-view-box` : la zone conservée, que `object-fit` ajuste ensuite comme à l'export. */
export function cropViewBox(c: VideoCrop | null | undefined): string | undefined {
  if (isFullCrop(c)) return undefined;
  const { x, y, w, h } = clampCrop(c as VideoCrop);
  const pct = (v: number) => `${+(v * 100).toFixed(3)}%`;
  return `inset(${pct(y)} ${pct(1 - x - w)} ${pct(1 - y - h)} ${pct(x)})`;
}

/** Les styles d'aperçu d'une vidéo : filtre de couleur et recadrage. */
export function videoEffectsStyle(element: { color_filter?: string | null; crop?: VideoCrop | null }): CSSProperties {
  const style: CSSProperties & { objectViewBox?: string } = {};
  const filter = cssFilterFor(element.color_filter);
  if (filter) style.filter = filter;
  const box = cropViewBox(element.crop);
  if (box) style.objectViewBox = box;
  return style;
}

/** Un filtre CSS ne peut pas assombrir les coins : la vignette s'aperçoit par un dégradé posé sur l'image. */
export const VIGNETTE_GRADIENT =
  "radial-gradient(ellipse closest-side at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.75) 135%)";

import { useCallback, useRef, useState } from "react";
import type { CropRect } from "../types";

type HandleId = "tl" | "tc" | "tr" | "ml" | "mr" | "bl" | "bc" | "br";
type DragTarget = HandleId | "body" | null;

interface DragState {
  target: DragTarget;
  startX: number;
  startY: number;
  startRect: CropRect;
}

/** Commandes que la barre de recadrage adresse à la zone de sélection. */
export interface CropApi {
  /** Modifie une partie du rectangle (saisie numérique), borné à l'image. */
  setRect: (patch: Partial<CropRect>) => void;
  /** Impose un rapport largeur/hauteur (`null` = libre) et y ajuste la sélection. */
  setAspect: (ratio: number | null) => void;
  /** Déplace la sélection de `dx`, `dy` pixels. */
  nudge: (dx: number, dy: number) => void;
}

interface UseCropReturn {
  cropRect: CropRect;
  setCropRect: (rect: CropRect) => void;
  api: CropApi;
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
}

const HANDLE_SIZE = 8;

function getHandleAt(px: number, py: number, rect: CropRect, scaleX: number, scaleY: number): HandleId | null {
  const x = rect.x * scaleX;
  const y = rect.y * scaleY;
  const w = rect.width * scaleX;
  const h = rect.height * scaleY;

  const handles: Array<[HandleId, number, number]> = [
    ["tl", x, y],
    ["tc", x + w / 2, y],
    ["tr", x + w, y],
    ["ml", x, y + h / 2],
    ["mr", x + w, y + h / 2],
    ["bl", x, y + h],
    ["bc", x + w / 2, y + h],
    ["br", x + w, y + h],
  ];

  for (const [id, hx, hy] of handles) {
    if (Math.abs(px - hx) <= HANDLE_SIZE && Math.abs(py - hy) <= HANDLE_SIZE) {
      return id;
    }
  }
  return null;
}

function isInsideRect(px: number, py: number, rect: CropRect, scaleX: number, scaleY: number): boolean {
  const x = rect.x * scaleX;
  const y = rect.y * scaleY;
  const w = rect.width * scaleX;
  const h = rect.height * scaleY;
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

export function useCrop(imageWidth: number, imageHeight: number): UseCropReturn {
  const [cropRect, setCropRect] = useState<CropRect>({
    x: Math.round(imageWidth * 0.1),
    y: Math.round(imageHeight * 0.1),
    width: Math.round(imageWidth * 0.8),
    height: Math.round(imageHeight * 0.8),
  });

  const dragRef = useRef<DragState | null>(null);
  const aspectRef = useRef<number | null>(null);
  const rectRef = useRef(cropRect);
  rectRef.current = cropRect;

  const clampRect = useCallback(
    (r: CropRect): CropRect => {
      const width = Math.max(1, Math.min(Math.round(r.width), imageWidth));
      const height = Math.max(1, Math.min(Math.round(r.height), imageHeight));
      return {
        width,
        height,
        x: Math.max(0, Math.min(Math.round(r.x), imageWidth - width)),
        y: Math.max(0, Math.min(Math.round(r.y), imageHeight - height)),
      };
    },
    [imageWidth, imageHeight],
  );

  /** Plus grand rectangle du rapport donné, dans une boîte de `maxW`×`maxH`. */
  const fitAspect = (ratio: number, maxW: number, maxH: number) => {
    const width = Math.min(maxW, maxH * ratio);
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(width / ratio)) };
  };

  const api: CropApi = {
    setRect: (patch) => {
      let next = { ...rectRef.current, ...patch };
      const ratio = aspectRef.current;
      if (ratio && patch.width !== undefined && patch.height === undefined) {
        next = { ...next, height: Math.round(next.width / ratio) };
      } else if (ratio && patch.height !== undefined && patch.width === undefined) {
        next = { ...next, width: Math.round(next.height * ratio) };
      }
      setCropRect(clampRect(next));
    },
    setAspect: (ratio) => {
      aspectRef.current = ratio;
      if (!ratio) return;
      const cur = rectRef.current;
      const size = fitAspect(ratio, cur.width, cur.height);
      const cx = cur.x + cur.width / 2;
      const cy = cur.y + cur.height / 2;
      setCropRect(
        clampRect({
          ...size,
          x: Math.round(cx - size.width / 2),
          y: Math.round(cy - size.height / 2),
        }),
      );
    },
    nudge: (dx, dy) => {
      const cur = rectRef.current;
      setCropRect(clampRect({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    },
  };

  const getScale = useCallback(
    (canvas: HTMLCanvasElement) => ({
      scaleX: imageWidth / canvas.offsetWidth,
      scaleY: imageHeight / canvas.offsetHeight,
    }),
    [imageWidth, imageHeight],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = e.currentTarget;
      canvas.setPointerCapture(e.pointerId);
      const { scaleX, scaleY } = getScale(canvas);
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const handle = getHandleAt(px, py, cropRect, 1 / scaleX, 1 / scaleY);
      const target: DragTarget = handle ?? (isInsideRect(px, py, cropRect, 1 / scaleX, 1 / scaleY) ? "body" : null);

      if (target === null) return;

      dragRef.current = {
        target,
        startX: px,
        startY: py,
        startRect: { ...cropRect },
      };
    },
    [cropRect, getScale],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      const canvas = e.currentTarget;
      const { scaleX, scaleY } = getScale(canvas);
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      const dx = (px - dragRef.current.startX) * scaleX;
      const dy = (py - dragRef.current.startY) * scaleY;
      const s = dragRef.current.startRect;
      const { target } = dragRef.current;
      if (!target) return;

      let { x, y, width, height } = s;

      if (target === "body") {
        x = Math.max(0, Math.min(s.x + dx, imageWidth - s.width));
        y = Math.max(0, Math.min(s.y + dy, imageHeight - s.height));
      } else {
        const right = s.x + s.width;
        const bottom = s.y + s.height;

        if (target.includes("l")) {
          x = Math.max(0, Math.min(s.x + dx, right - 1));
          width = right - x;
        }
        if (target.includes("r")) {
          width = Math.max(1, Math.min(s.width + dx, imageWidth - s.x));
        }
        if (target.includes("t")) {
          y = Math.max(0, Math.min(s.y + dy, bottom - 1));
          height = bottom - y;
        }
        if (target.includes("b")) {
          height = Math.max(1, Math.min(s.height + dy, imageHeight - s.y));
        }
      }

      const ratio = aspectRef.current;
      if (ratio && target !== "body") {
        // Rapport imposé : la dimension que l'on tire commande l'autre, et le côté opposé
        // reste en place.
        const right = s.x + s.width;
        const bottom = s.y + s.height;
        const horizontal = target.includes("l") || target.includes("r");
        let w = horizontal ? width : height * ratio;
        let h = horizontal ? width / ratio : height;
        const maxW = target.includes("l") ? right : imageWidth - s.x;
        const maxH = target.includes("t") ? bottom : imageHeight - s.y;
        const k = Math.min(1, maxW / w, maxH / h);
        w *= k;
        h *= k;
        width = w;
        height = h;
        x = target.includes("l") ? right - w : s.x;
        y = target.includes("t") ? bottom - h : s.y;
        if (!horizontal && !target.includes("l") && !target.includes("r")) {
          x = s.x + (s.width - w) / 2;
        }
        if (horizontal && !target.includes("t") && !target.includes("b")) {
          y = s.y + (s.height - h) / 2;
        }
      }

      setCropRect(clampRect({ x, y, width, height }));
    },
    [getScale, imageWidth, imageHeight, clampRect],
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return { cropRect, setCropRect, api, onPointerDown, onPointerMove, onPointerUp };
}

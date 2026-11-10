import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { useCrop } from "./hooks/useCrop";
import type { CropApi } from "./hooks/useCrop";
import { useT } from "./lib/langContext";
import { isModalOpen, isTypingTarget } from "./lib/dom";
import type { CropRect } from "./types";

interface CropOverlayProps {
  imageWidth: number;
  imageHeight: number;
  /** Opération en cours : Entrée ne relance pas un second recadrage. */
  disabled?: boolean;
  /** Reçoit les commandes de la barre de recadrage (ratio, saisie numérique). */
  apiRef?: MutableRefObject<CropApi | null>;
  onApply: (rect: CropRect) => void;
  onCancel: () => void;
  onCropRectChange?: (rect: CropRect) => void;
}

const HANDLE_SIZE = 10;

export function CropOverlay({
  imageWidth,
  imageHeight,
  disabled = false,
  apiRef,
  onApply,
  onCancel,
  onCropRectChange,
}: CropOverlayProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { cropRect, api, onPointerDown, onPointerMove, onPointerUp } = useCrop(imageWidth, imageHeight);
  const apiLatest = useRef(api);
  apiLatest.current = api;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      setRect: (p) => apiLatest.current.setRect(p),
      setAspect: (r) => apiLatest.current.setAspect(r),
      nudge: (dx, dy) => apiLatest.current.nudge(dx, dy),
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  // Keep a ref so the keyboard handler always reads the latest cropRect
  const cropRectRef = useRef(cropRect);
  useEffect(() => {
    cropRectRef.current = cropRect;
    onCropRectChange?.(cropRect);
  }, [cropRect, onCropRectChange]);

  // Entrée = appliquer, Échap = annuler, flèches = déplacer (Maj : par 10 px). Ignoré
  // pendant une saisie ou quand une boîte de dialogue est ouverte.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || isModalOpen()) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (!disabledRef.current) onApply(cropRectRef.current);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key.startsWith("Arrow") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        apiLatest.current.nudge(dx, dy);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onApply, onCancel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const scaleX = canvas.offsetWidth / imageWidth;
    const scaleY = canvas.offsetHeight / imageHeight;

    // Résolution physique : sur un écran HiDPI, des poignées dessinées en pixels CSS
    // seraient floues.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.offsetWidth * dpr);
    canvas.height = Math.round(canvas.offsetHeight * dpr);
    ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

    // Dimmed overlay
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

    // Clear the crop region
    const cx = cropRect.x * scaleX;
    const cy = cropRect.y * scaleY;
    const cw = cropRect.width * scaleX;
    const ch = cropRect.height * scaleY;

    ctx.clearRect(cx, cy, cw, ch);

    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx, cy, cw, ch);

    // Rule-of-thirds grid
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + (cw / 3) * i, cy);
      ctx.lineTo(cx + (cw / 3) * i, cy + ch);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy + (ch / 3) * i);
      ctx.lineTo(cx + cw, cy + (ch / 3) * i);
      ctx.stroke();
    }

    // Handles
    const handles = [
      [cx, cy],
      [cx + cw / 2, cy],
      [cx + cw, cy],
      [cx, cy + ch / 2],
      [cx + cw, cy + ch / 2],
      [cx, cy + ch],
      [cx + cw / 2, cy + ch],
      [cx + cw, cy + ch],
    ];

    // Quand la sélection couvre toute l'image, les poignées tomberaient à moitié hors du
    // canevas : on les ramène à l'intérieur pour qu'elles restent visibles.
    const half = HANDLE_SIZE / 2;
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 1;
    for (const [hx, hy] of handles) {
      const x = Math.min(Math.max(hx, half), canvas.offsetWidth - half) - half;
      const y = Math.min(Math.max(hy, half), canvas.offsetHeight - half) - half;
      ctx.fillRect(x, y, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeRect(x, y, HANDLE_SIZE, HANDLE_SIZE);
    }
  }, [cropRect, imageWidth, imageHeight]);

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label={t("a11y.crop-selection")}
      />
    </div>
  );
}

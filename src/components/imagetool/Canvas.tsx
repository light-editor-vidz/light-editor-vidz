import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { CropApi } from "./hooks/useCrop";
import { CropOverlay } from "./CropOverlay";
import type { CropRect, EditorMode, ImageMeta, PickedColor } from "./types";
import { useT } from "./lib/langContext";

interface CanvasProps {
  image: ImageMeta | null;
  mode: EditorMode;
  zoom: number;
  /** Onglet affiché : un changement d'onglet ajuste l'image à la fenêtre si elle déborde. */
  tabId?: string | null;
  /** Incrémenté pour demander « ajuster à la fenêtre ». */
  fitSignal?: number;
  /** Aperçu d'un réglage en cours, superposé à l'image. */
  previewSrc?: string | null;
  /** Rotation instantanée (CSS) pendant le glissement du curseur d'angle, avant le vrai calcul. */
  rotatePreview?: { degrees: number; src: string } | null;
  showGrid?: boolean;
  gridSize?: number;
  recentFiles?: string[];
  onRecentRemove?: (path: string) => void;
  onRecentClear?: () => void;
  isLoading?: boolean;
  /** Voile « traitement en cours » sur l'image ; coupé quand le panneau a son propre indicateur. */
  showBusy?: boolean;
  /** Diamètre du pinceau, en pixels d'écran. */
  brushSize?: number;
  maskClearSignal?: number;
  onCropApply: (rect: CropRect) => void;
  onCropCancel: () => void;
  onCropRectChange?: (rect: CropRect) => void;
  /** Reçoit les commandes de la zone de recadrage (ratio, saisie numérique). */
  cropApiRef?: MutableRefObject<CropApi | null>;
  onZoomChange: (z: number | ((prev: number) => number)) => void;
  onOpen: () => void;
  onOpenByPaths?: (paths: string[]) => void;
  onColorPick?: (color: PickedColor | null) => void;
  onColorPickConfirm?: (color: PickedColor) => void;
  onMaskCanvasRef?: (canvas: HTMLCanvasElement | null) => void;
  /** Vrai dès qu'un trait a été peint, faux après effacement. */
  onMaskDirtyChange?: (dirty: boolean) => void;
}

const ZOOM_STEP = 1.15;
const FIT_MARGIN = 32;

// Magnifier constants
const MAG_GRID = 13; // pixels shown (odd so center is clear)
const MAG_CELL = 10; // display px per pixel
const MAG_SIZE = MAG_GRID * MAG_CELL; // = 130

export function Canvas({
  image,
  mode,
  zoom,
  tabId,
  fitSignal,
  previewSrc,
  rotatePreview,
  showGrid = false,
  gridSize = 50,
  recentFiles = [],
  onRecentRemove,
  onRecentClear,
  isLoading = false,
  showBusy = true,
  brushSize = 30,
  maskClearSignal,
  onCropApply,
  onCropCancel,
  onCropRectChange,
  cropApiRef,
  onZoomChange,
  onOpen,
  onOpenByPaths,
  onColorPick,
  onColorPickConfirm,
  onMaskCanvasRef,
  onMaskDirtyChange,
}: CanvasProps) {
  const t = useT();
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const magnifierRef = useRef<HTMLCanvasElement | null>(null);
  const lastPickedRef = useRef<PickedColor | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const brushCursorRef = useRef<HTMLDivElement | null>(null);
  const lastStrokeRef = useRef<{ x: number; y: number } | null>(null);
  const wheelAnchorRef = useRef<{ imgX: number; imgY: number; px: number; py: number } | null>(null);
  const zoomRef = useRef(zoom);
  const hasImage = !!image;

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    if (!isLoading) setLoadingPath(null);
  }, [isLoading]);

  const onMaskCanvasRefStable = useRef(onMaskCanvasRef);
  onMaskCanvasRefStable.current = onMaskCanvasRef;
  const maskCallbackRef = useCallback((el: HTMLCanvasElement | null) => {
    maskCanvasRef.current = el;
    onMaskCanvasRefStable.current?.(el);
  }, []);

  // Copie hors écran pour lire les pixels : nécessaire à la pipette seulement.
  useEffect(() => {
    if (mode !== "eyedropper" || !image?.preview) {
      offscreenRef.current = null;
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let cancelled = false;
    const img = new window.Image();
    // L'image vient du protocole `lcimg` : sans CORS, getImageData lèverait une erreur.
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      ctx.drawImage(img, 0, 0);
      offscreenRef.current = canvas;
    };
    img.src = image.preview;
    return () => {
      cancelled = true;
    };
  }, [mode, image?.preview, image?.width, image?.height]);

  // Nouvelle image : le masque d'inpainting repart vide.
  useEffect(() => {
    if (!maskCanvasRef.current) return;
    const ctx = maskCanvasRef.current.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
    onMaskDirtyChange?.(false);
  }, [image?.preview, onMaskDirtyChange]);

  // Effacement à la demande (bouton « Effacer le masque »)
  useEffect(() => {
    if (maskClearSignal === undefined || !maskCanvasRef.current || !image) return;
    const ctx = maskCanvasRef.current.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, image.width, image.height);
    onMaskDirtyChange?.(false);
  }, [maskClearSignal, image, onMaskDirtyChange]);

  // Hide magnifier when leaving eyedropper mode
  useEffect(() => {
    if (mode !== "eyedropper" && magnifierRef.current) {
      magnifierRef.current.style.display = "none";
    }
  }, [mode]);

  // ── zoom et défilement ────────────────────────────────────────────────────────

  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !image) return;
    const w = el.clientWidth - FIT_MARGIN;
    const h = el.clientHeight - FIT_MARGIN;
    if (w <= 0 || h <= 0) return;
    onZoomChange(Math.min(w / image.width, h / image.height, 1));
  }, [image, onZoomChange]);

  // Une image qui déborde de la fenêtre s'ouvre ajustée plutôt qu'à 100 %.
  useEffect(() => {
    // Après la mise en page : la barre d'onglets et d'état viennent d'apparaître et
    // réduisent la zone visible.
    const id = requestAnimationFrame(() => {
      if (zoomRef.current === 1) fit();
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  useEffect(() => {
    if (fitSignal) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // Ctrl/Cmd + molette (ou pincement du pavé tactile) zoome, ancré sur le pointeur ; la
  // molette seule fait défiler. L'écouteur doit être non passif pour pouvoir annuler le
  // zoom natif de la page, ce que le `onWheel` de React ne permet pas.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasImage) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const content = contentRef.current;
      if (content) {
        const box = content.getBoundingClientRect();
        const z = zoomRef.current;
        wheelAnchorRef.current = {
          imgX: (e.clientX - box.left) / z,
          imgY: (e.clientY - box.top) / z,
          px: e.clientX,
          py: e.clientY,
        };
      }
      const delta = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      onZoomChange((prev) => prev * delta);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasImage, onZoomChange]);

  // Après le zoom, fait défiler pour que le point visé reste sous le pointeur.
  useLayoutEffect(() => {
    const anchor = wheelAnchorRef.current;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!anchor || !el || !content) return;
    wheelAnchorRef.current = null;
    const box = content.getBoundingClientRect();
    el.scrollLeft += box.left + anchor.imgX * zoom - anchor.px;
    el.scrollTop += box.top + anchor.imgY * zoom - anchor.py;
  }, [zoom]);

  // ── eyedropper ────────────────────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (mode !== "eyedropper" || !image) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const containerX = e.clientX - rect.left;
      const containerY = e.clientY - rect.top;
      const imgX = Math.floor(containerX / zoom);
      const imgY = Math.floor(containerY / zoom);

      const displayWidth = Math.round(image.width * zoom);
      const displayHeight = Math.round(image.height * zoom);

      const magCanvas = magnifierRef.current;
      if (magCanvas) {
        const ctx = magCanvas.getContext("2d");
        const offscreen = offscreenRef.current;
        if (ctx) {
          magCanvas.width = MAG_SIZE;
          magCanvas.height = MAG_SIZE;
          ctx.imageSmoothingEnabled = false;

          if (offscreen) {
            const srcX = imgX - Math.floor(MAG_GRID / 2);
            const srcY = imgY - Math.floor(MAG_GRID / 2);
            ctx.drawImage(offscreen, srcX, srcY, MAG_GRID, MAG_GRID, 0, 0, MAG_SIZE, MAG_SIZE);
          } else {
            ctx.fillStyle = "#1e293b";
            ctx.fillRect(0, 0, MAG_SIZE, MAG_SIZE);
          }

          ctx.strokeStyle = "rgba(0,0,0,0.25)";
          ctx.lineWidth = 0.5;
          for (let i = 1; i < MAG_GRID; i++) {
            ctx.beginPath();
            ctx.moveTo(i * MAG_CELL, 0);
            ctx.lineTo(i * MAG_CELL, MAG_SIZE);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i * MAG_CELL);
            ctx.lineTo(MAG_SIZE, i * MAG_CELL);
            ctx.stroke();
          }

          const cx = Math.floor(MAG_GRID / 2) * MAG_CELL;
          const cy = Math.floor(MAG_GRID / 2) * MAG_CELL;
          ctx.strokeStyle = "rgba(255,255,255,0.9)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(cx + 0.5, cy + 0.5, MAG_CELL - 1, MAG_CELL - 1);
        }

        const gapX = 20;
        const gapY = 20;
        const rightX = containerX + gapX;
        const leftX = containerX - MAG_SIZE - gapX;
        const belowY = containerY + gapY;
        const aboveY = containerY - MAG_SIZE - gapY;
        const posX = rightX + MAG_SIZE <= displayWidth ? rightX : Math.max(0, leftX);
        const posY = belowY + MAG_SIZE <= displayHeight ? belowY : Math.max(0, aboveY);

        magCanvas.style.left = `${posX}px`;
        magCanvas.style.top = `${posY}px`;
        magCanvas.style.display = "block";
      }

      if (imgX < 0 || imgY < 0 || imgX >= image.width || imgY >= image.height) {
        onColorPick?.(null);
        return;
      }
      const offscreen = offscreenRef.current;
      if (!offscreen) {
        onColorPick?.(null);
        return;
      }
      const ctx = offscreen.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        onColorPick?.(null);
        return;
      }
      const [r, g, b, a] = ctx.getImageData(imgX, imgY, 1, 1).data;
      const color: PickedColor = { r, g, b, a };
      lastPickedRef.current = color;
      onColorPick?.(color);
    },
    [mode, zoom, image, onColorPick],
  );

  const handleMouseLeave = useCallback(() => {
    if (mode === "eyedropper") {
      onColorPick?.(null);
      if (magnifierRef.current) magnifierRef.current.style.display = "none";
    }
  }, [mode, onColorPick]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (mode !== "eyedropper" || !image) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const imgX = Math.floor((e.clientX - rect.left) / zoom);
      const imgY = Math.floor((e.clientY - rect.top) / zoom);
      if (imgX < 0 || imgY < 0 || imgX >= image.width || imgY >= image.height) return;

      const offscreen = offscreenRef.current;
      if (offscreen) {
        const ctx = offscreen.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          const [r, g, b, a] = ctx.getImageData(imgX, imgY, 1, 1).data;
          onColorPickConfirm?.({ r, g, b, a });
          return;
        }
      }
      if (lastPickedRef.current) {
        onColorPickConfirm?.(lastPickedRef.current);
      }
    },
    [mode, zoom, image, onColorPickConfirm],
  );

  // ── pinceau du masque d'inpainting ────────────────────────────────────────────

  /** Position du pointeur en pixels de l'image (le canevas est affiché à l'échelle du zoom). */
  const toImagePoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? canvas.width / rect.width : 1 / zoom;
    const sy = rect.height ? canvas.height / rect.height : 1 / zoom;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  };

  const moveBrushCursor = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cursor = brushCursorRef.current;
    if (!cursor) return;
    const rect = e.currentTarget.getBoundingClientRect();
    cursor.style.display = "block";
    cursor.style.left = `${e.clientX - rect.left}px`;
    cursor.style.top = `${e.clientY - rect.top}px`;
  };

  /** Trace le segment depuis le dernier point : un geste rapide ne laisse plus de trous. */
  const stroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = toImagePoint(e);
    const last = lastStrokeRef.current ?? p;
    ctx.strokeStyle = "rgba(255, 60, 60, 0.7)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Le diamètre du pinceau est exprimé en pixels d'écran : il garde la même taille
    // apparente quel que soit le zoom.
    ctx.lineWidth = brushSize / zoom;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastStrokeRef.current = p;
    onMaskDirtyChange?.(true);
  };

  const handleMaskPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    lastStrokeRef.current = toImagePoint(e);
    stroke(e);
  };

  const handleMaskPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    moveBrushCursor(e);
    if (lastStrokeRef.current) stroke(e);
  };

  const handleMaskPointerUp = () => {
    lastStrokeRef.current = null;
  };

  // ── empty state ───────────────────────────────────────────────────────────────

  if (!image) {
    return (
      <div className="home select-none">
        <div className="home-inner">
          <div className="home-frame" role="group" aria-label={t("a11y.open-image")}>
            <svg
              className="home-icon"
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <h2 className="home-name">
              LightCut<span className="home-name-accent">Imgz</span>
            </h2>
            <p className="home-subtitle">{t("home.drop")}</p>
            <p className="home-or">{t("home.or")}</p>
            <button className="home-btn" onClick={onOpen} data-testid="home-open">
              {t("home.browse")}
            </button>
          </div>

          {recentFiles.length > 0 && (
            <div className="home-recent">
              <div className="home-recent-head">
                <span>{t("canvas.recent")}</span>
                <button className="home-recent-clear" onClick={onRecentClear}>
                  {t("canvas.recentClear")}
                </button>
              </div>
              {recentFiles.slice(0, 5).map((path) => {
                const loading = loadingPath === path;
                return (
                  <div key={path} className="home-recent-row">
                    <button
                      className="home-recent-item"
                      onClick={() => {
                        setLoadingPath(path);
                        onOpenByPaths?.([path]);
                      }}
                      disabled={isLoading}
                      title={path}
                    >
                      {loading ? (
                        <svg className="animate-spin w-3 h-3 shrink-0 text-indigo-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                        </svg>
                      ) : null}
                      <span className="home-recent-name">{path.split(/[\\/]/).pop()}</span>
                      <span className="home-recent-dir">{path.replace(/[\\/][^\\/]+$/, "")}</span>
                    </button>
                    <button
                      className="home-recent-remove"
                      onClick={() => onRecentRemove?.(path)}
                      aria-label={t("canvas.recentRemove")}
                      title={t("canvas.recentRemove")}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <p className="home-formats">PNG · JPEG · WebP · BMP · TIFF</p>
        </div>
      </div>
    );
  }

  const displayWidth = Math.round(image.width * zoom);
  const displayHeight = Math.round(image.height * zoom);
  // L'aperçu ne vaut que pour l'image sur laquelle il a été demandé : dès que le vrai résultat
  // arrive, la rotation CSS cesse d'elle-même.
  const liveRotation =
    mode === "rotating" && rotatePreview && rotatePreview.src === image.preview ? rotatePreview.degrees : 0;
  const rad = (liveRotation * Math.PI) / 180;
  const boxWidth = Math.round(Math.abs(displayWidth * Math.cos(rad)) + Math.abs(displayHeight * Math.sin(rad)));
  const boxHeight = Math.round(Math.abs(displayWidth * Math.sin(rad)) + Math.abs(displayHeight * Math.cos(rad)));
  const isEyedropper = mode === "eyedropper";
  const isInpainting = mode === "inpainting";

  return (
    <div className="relative flex flex-1 min-w-0 overflow-hidden">
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto flex items-start justify-start bg-slate-800/50"
        style={{ cursor: "default" }}
      >
        <div
          ref={contentRef}
          className="relative m-auto"
          style={{
            width: liveRotation ? boxWidth : displayWidth,
            height: liveRotation ? boxHeight : displayHeight,
            flexShrink: 0,
            cursor: isEyedropper ? "crosshair" : "default",
          }}
          onMouseMove={isEyedropper ? handleMouseMove : undefined}
          onMouseLeave={isEyedropper ? handleMouseLeave : undefined}
          onClick={isEyedropper ? handleClick : undefined}
        >
          <img
            src={image.preview}
            alt={t("a11y.canvas")}
            width={displayWidth}
            height={displayHeight}
            className={liveRotation ? "absolute" : "block"}
            draggable={false}
            data-testid="canvas-image"
            style={{
              imageRendering: zoom >= 3 ? "pixelated" : "auto",
              ...(liveRotation
                ? {
                    left: (boxWidth - displayWidth) / 2,
                    top: (boxHeight - displayHeight) / 2,
                    transform: `rotate(${liveRotation}deg)`,
                  }
                : {}),
            }}
          />

          {previewSrc && (
            <img
              src={previewSrc}
              alt={t("a11y.preview")}
              width={displayWidth}
              height={displayHeight}
              className="absolute inset-0 pointer-events-none"
              draggable={false}
              data-testid="canvas-preview"
            />
          )}

          {showGrid && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: [
                  "linear-gradient(rgba(128,128,128,0.25) 1px, transparent 1px)",
                  "linear-gradient(90deg, rgba(128,128,128,0.25) 1px, transparent 1px)",
                ].join(","),
                backgroundSize: `${gridSize * zoom}px ${gridSize * zoom}px`,
              }}
            />
          )}

          {mode === "cropping" && (
            <CropOverlay
              imageWidth={image.width}
              imageHeight={image.height}
              disabled={isLoading}
              apiRef={cropApiRef}
              onApply={onCropApply}
              onCancel={onCropCancel}
              onCropRectChange={onCropRectChange}
            />
          )}

          {/* Calque du pinceau d'inpainting */}
          {isInpainting && (
            <>
              <canvas
                ref={maskCallbackRef}
                width={image.width}
                height={image.height}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: displayWidth,
                  height: displayHeight,
                  cursor: "none",
                  touchAction: "none",
                }}
                onPointerDown={handleMaskPointerDown}
                onPointerMove={handleMaskPointerMove}
                onPointerUp={handleMaskPointerUp}
                onPointerCancel={handleMaskPointerUp}
                onPointerLeave={() => {
                  if (brushCursorRef.current) brushCursorRef.current.style.display = "none";
                }}
              />
              <div
                ref={brushCursorRef}
                className="absolute pointer-events-none rounded-full border border-white/80 shadow"
                style={{
                  display: "none",
                  width: brushSize,
                  height: brushSize,
                  transform: "translate(-50%, -50%)",
                }}
              />
            </>
          )}

          {/* Magnifier — toujours dans le DOM, affichée à la demande en mode pipette */}
          <canvas
            ref={magnifierRef}
            className="absolute pointer-events-none z-20 rounded overflow-hidden border border-white/25 shadow-xl"
            style={{ display: "none", imageRendering: "pixelated" }}
          />
        </div>
      </div>
      {isLoading && showBusy && (
        <div
          className="busy-overlay absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-40 select-none cursor-wait"
          role="status"
        >
          <svg className="animate-spin w-12 h-12 text-white mb-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-white text-sm font-medium">{t(isInpainting ? "inp.applying" : "canvas.busy")}</span>
        </div>
      )}
    </div>
  );
}

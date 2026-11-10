import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import type { CropRect } from "../types";
import { useT } from "../i18n";
import { useVideoRect } from "../hooks/useVideoRect";
import { aspectValue, fitAspect, resizeLocked } from "../utils/crop";
import { ASPECTS, type Aspect } from "../utils/presets";
import "./CropOverlay.css";

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  crop: CropRect | null;
  onChange?: (crop: CropRect) => void;
  onChangeLive: (crop: CropRect) => void;
  onCommit: () => void;
  onApply: () => void;
}

type Handle = "tl" | "tr" | "bl" | "br" | "move";

export default function CropOverlay({ videoRef, crop, onChangeLive, onCommit, onApply }: Props) {
  const { t } = useT();
  const overlayRef = useRef<HTMLDivElement>(null);
  // Ratio the box is locked to while resizing (UI only: the crop itself is a plain rectangle).
  const [aspect, setAspect] = useState<Aspect | null>(null);
  const dragRef = useRef<{ handle: Handle; startX: number; startY: number; initCrop: CropRect } | null>(null);
  const video = useVideoRect(videoRef);
  const natural = {
    w: video?.naturalWidth || video?.width || 1,
    h: video?.naturalHeight || video?.height || 1,
  };
  const scale = video ? video.width / natural.w : 1;
  const displayRect = { x: video?.left ?? 0, y: video?.top ?? 0, scale };

  // The stored crop is the single source of truth, so Undo/Redo while the panel
  // is open moves the box. Until the user draws, the box shows the full frame
  // without recording a crop (which would be exported even if never touched).
  const rect = useMemo<CropRect>(
    () => crop ?? { x: 0, y: 0, w: natural.w, h: natural.h },
    [crop, natural.w, natural.h],
  );

  // One undo step: the box jumps to the largest centred area of the ratio.
  const pickAspect = (next: Aspect | null) => {
    setAspect(next);
    if (!next) return;
    onChangeLive(fitAspect(natural, next));
    onCommit();
  };

  // Enter key applies
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") onApply();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onApply]);

  const toD = (r: CropRect) => ({
    x: displayRect.x + r.x * displayRect.scale,
    y: displayRect.y + r.y * displayRect.scale,
    w: r.w * displayRect.scale,
    h: r.h * displayRect.scale,
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent, handle: Handle) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { handle, startX: e.clientX, startY: e.clientY, initCrop: { ...rect } };
    },
    [rect],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const { handle, startX, startY, initCrop } = dragRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const sc = displayRect.scale;
      const min = 20;
      const vw = natural.w;
      const vh = natural.h;
      let nx = initCrop.x,
        ny = initCrop.y,
        nw = initCrop.w,
        nh = initCrop.h;

      if (handle === "move") {
        nx = Math.max(0, Math.min(vw - nw, initCrop.x + dx / sc));
        ny = Math.max(0, Math.min(vh - nh, initCrop.y + dy / sc));
      } else if (aspect) {
        const r = resizeLocked(initCrop, handle, dx / sc, dy / sc, { w: vw, h: vh }, aspectValue(aspect), min);
        nx = r.x;
        ny = r.y;
        nw = r.w;
        nh = r.h;
      } else {
        if (handle === "tl" || handle === "bl") {
          nx = Math.max(0, Math.min(initCrop.x + initCrop.w - min, initCrop.x + dx / sc));
          nw = initCrop.w - (nx - initCrop.x);
        }
        if (handle === "tr" || handle === "br") {
          nw = Math.max(min, Math.min(vw - initCrop.x, initCrop.w + dx / sc));
        }
        if (handle === "tl" || handle === "tr") {
          ny = Math.max(0, Math.min(initCrop.y + initCrop.h - min, initCrop.y + dy / sc));
          nh = initCrop.h - (ny - initCrop.y);
        }
        if (handle === "bl" || handle === "br") {
          nh = Math.max(min, Math.min(vh - initCrop.y, initCrop.h + dy / sc));
        }
      }

      onChangeLive({ x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) });
    },
    [displayRect.scale, natural.w, natural.h, onChangeLive, aspect],
  );

  // Closing the gesture here is what turns a whole drag into one undo step.
  // A cancelled pointer (focus lost, touch interrupted) must close it too, or the
  // next edit elsewhere would be folded into this gesture.
  const endDrag = useCallback(() => {
    if (dragRef.current) onCommit();
    dragRef.current = null;
  }, [onCommit]);

  const d = toD(rect);

  return (
    <div
      ref={overlayRef}
      className="crop-overlay"
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {/* Ratio presets: social formats and free-form */}
      <div className="crop-aspects" role="group" aria-label={t.crop_ratio} onPointerDown={(e) => e.stopPropagation()}>
        <button
          className={`crop-aspect ${aspect === null ? "active" : ""}`}
          aria-pressed={aspect === null}
          onClick={() => pickAspect(null)}
        >
          {t.aspect_free}
        </button>
        {ASPECTS.map((a) => (
          <button
            key={a}
            className={`crop-aspect ${aspect === a ? "active" : ""}`}
            aria-pressed={aspect === a}
            title={t[`aspect_${a.replace(":", "_")}` as "aspect_9_16"]}
            onClick={() => pickAspect(a)}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Dark areas outside selection */}
      <div className="crop-shade" style={{ top: 0, left: 0, right: 0, height: d.y }} />
      <div className="crop-shade" style={{ top: d.y + d.h, left: 0, right: 0, bottom: 0 }} />
      <div className="crop-shade" style={{ top: d.y, left: 0, width: d.x, height: d.h }} />
      <div className="crop-shade" style={{ top: d.y, left: d.x + d.w, right: 0, height: d.h }} />

      {/* Selection box */}
      <div
        className="crop-box"
        style={{ left: d.x, top: d.y, width: d.w, height: d.h }}
        onPointerDown={(e) => onPointerDown(e, "move")}
      >
        <div className="crop-grid" />
        {(["tl", "tr", "bl", "br"] as Handle[]).map((h) => (
          <div key={h} className={`crop-handle crop-handle-${h}`} onPointerDown={(e) => onPointerDown(e, h)} />
        ))}
        <div className="crop-dimensions">
          {rect.w} × {rect.h}
        </div>
      </div>

      {/* Apply button above selection */}
      <button
        className="crop-apply-btn"
        style={{ left: d.x + d.w / 2, top: Math.max(8, d.y - 44) }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onApply}
      >
        {t.crop_apply} <kbd>Enter</kbd>
      </button>
    </div>
  );
}

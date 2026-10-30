import { clampPosition, resizeGeometry } from "../../lib/geometry";
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

export interface GeometryPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface SnapGuides {
  vertical: number[];
  horizontal: number[];
}

interface Props {
  geometry: GeometryPatch;
  selected: boolean;
  accentColor: string;
  stageRef: React.RefObject<HTMLDivElement | null>;
  /** Géométries des autres éléments de la composition (hors soi-même), pour le snapping. */
  siblings: { x: number; y: number; width: number; height: number }[];
  onChange: (patch: Partial<GeometryPatch>) => void;
  /** `additive` = shift/cmd/ctrl enfoncé au clic (ajoute/retire de la sélection multiple). */
  onSelect: (additive: boolean) => void;
  /** Guides d'accroche actifs pendant un drag, pour affichage par le parent. */
  onGuides?: (guides: SnapGuides | null) => void;
  /** Mode de fusion CSS de l'élément. Posé sur le calque tourné lui-même : sur un enfant, la
   * rotation (qui crée un contexte d'empilement) l'isolerait et le mélange se ferait avec du
   * transparent au lieu de la scène. */
  blendMode?: string;
  children: ReactNode;
}

export type HandleId = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const SNAP_THRESHOLD = 1.2;
/** Déplacement (px) en dessous duquel un appui reste un simple clic. */
const CLICK_SLOP_PX = 3;

const HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Accroche `value` sur le candidat le plus proche dans `candidates`, si sous le seuil. */
function snapValue(value: number, candidates: number[]): number | null {
  let best: number | null = null;
  let bestDelta = SNAP_THRESHOLD;
  for (const c of candidates) {
    const delta = Math.abs(value - c);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c;
    }
  }
  return best;
}

/** Wrapper générique drag/resize/rotate réutilisé par tous les types d'éléments (texte, image, vidéo, forme). */
export default function ElementInteraction({
  geometry,
  selected,
  accentColor,
  stageRef,
  siblings,
  onChange,
  onSelect,
  onGuides,
  blendMode,
  children,
}: Props) {
  const dragState = useRef<{
    startX: number;
    startY: number;
    startGeometry: GeometryPatch;
    rectWidth: number;
    rectHeight: number;
    centerX: number;
    centerY: number;
    moved: boolean;
  } | null>(null);

  function startDrag(kind: "move" | "resize" | "rotate", handle: HandleId | undefined, e: ReactPointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    // Saisir un élément déjà sélectionné garde la sélection (on peut alors déplacer toute la
    // sélection multiple) ; elle se réduit à cet élément seulement si l'appui reste un clic.
    const keepSelection = kind === "move" && selected && !additive;
    if (!keepSelection) onSelect(additive);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragState.current = {
      startX: e.clientX,
      startY: e.clientY,
      startGeometry: geometry,
      rectWidth: rect.width,
      rectHeight: rect.height,
      centerX: rect.left + ((geometry.x + geometry.width / 2) / 100) * rect.width,
      centerY: rect.top + ((geometry.y + geometry.height / 2) / 100) * rect.height,
      moved: false,
    };

    function onMove(ev: PointerEvent) {
      const state = dragState.current;
      if (!state) return;
      const dxPx = ev.clientX - state.startX;
      const dyPx = ev.clientY - state.startY;
      if (Math.abs(dxPx) > CLICK_SLOP_PX || Math.abs(dyPx) > CLICK_SLOP_PX) state.moved = true;
      const dxPct = (dxPx / state.rectWidth) * 100;
      const dyPct = (dyPx / state.rectHeight) * 100;

      if (kind === "move") {
        let x = clampPosition(state.startGeometry.x + dxPct, state.startGeometry.width);
        let y = clampPosition(state.startGeometry.y + dyPct, state.startGeometry.height);

        const vCandidates = [0, 50, 100, ...siblings.flatMap((s) => [s.x, s.x + s.width / 2, s.x + s.width])];
        const hCandidates = [0, 50, 100, ...siblings.flatMap((s) => [s.y, s.y + s.height / 2, s.y + s.height])];
        const w = state.startGeometry.width;
        const h = state.startGeometry.height;
        let vGuide: number | null = null;
        let hGuide: number | null = null;

        const leftSnap = snapValue(x, vCandidates);
        const centerSnap = snapValue(x + w / 2, vCandidates);
        const rightSnap = snapValue(x + w, vCandidates);
        if (leftSnap !== null) {
          x = leftSnap;
          vGuide = leftSnap;
        } else if (centerSnap !== null) {
          x = centerSnap - w / 2;
          vGuide = centerSnap;
        } else if (rightSnap !== null) {
          x = rightSnap - w;
          vGuide = rightSnap;
        }

        const topSnap = snapValue(y, hCandidates);
        const middleSnap = snapValue(y + h / 2, hCandidates);
        const bottomSnap = snapValue(y + h, hCandidates);
        if (topSnap !== null) {
          y = topSnap;
          hGuide = topSnap;
        } else if (middleSnap !== null) {
          y = middleSnap - h / 2;
          hGuide = middleSnap;
        } else if (bottomSnap !== null) {
          y = bottomSnap - h;
          hGuide = bottomSnap;
        }

        onChange({ x, y });
        onGuides?.({ vertical: vGuide !== null ? [vGuide] : [], horizontal: hGuide !== null ? [hGuide] : [] });
      } else if (kind === "resize" && handle) {
        onChange(resizeGeometry(state.startGeometry, handle, dxPx, dyPx, state.rectWidth, state.rectHeight));
      } else if (kind === "rotate") {
        const angle = (Math.atan2(ev.clientY - state.centerY, ev.clientX - state.centerX) * 180) / Math.PI + 90;
        onChange({ rotation: Math.round(angle) });
      }
    }

    function onUp() {
      if (keepSelection && dragState.current && !dragState.current.moved) onSelect(false);
      dragState.current = null;
      onGuides?.(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      className="element-interaction"
      style={{
        position: "absolute",
        left: `${geometry.x}%`,
        top: `${geometry.y}%`,
        width: `${geometry.width}%`,
        height: `${geometry.height}%`,
        transform: geometry.rotation ? `rotate(${geometry.rotation}deg)` : undefined,
        transformOrigin: "center center",
        mixBlendMode: blendMode as React.CSSProperties["mixBlendMode"],
        cursor: "move",
        pointerEvents: "auto",
      }}
      onPointerDown={(e) => startDrag("move", undefined, e)}
    >
      {children}
      {selected && (
        <>
          <div className="element-outline" style={{ borderColor: accentColor }} />
          {HANDLES.map((h) => (
            <div
              key={h}
              className={`element-handle element-handle-${h}`}
              style={{ background: accentColor }}
              onPointerDown={(e) => startDrag("resize", h, e)}
            />
          ))}
          <div className="element-rotate-line" style={{ background: accentColor }} />
          <div
            className="element-rotate-handle"
            style={{ borderColor: accentColor }}
            onPointerDown={(e) => startDrag("rotate", undefined, e)}
          />
        </>
      )}
    </div>
  );
}

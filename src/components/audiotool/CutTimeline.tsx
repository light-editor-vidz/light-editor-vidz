import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useClockValue, type PlaybackClock } from "../../lib/playbackClock";
import {
  MIN_CUT,
  fmtPrecise,
  mergeCuts,
  parseTimeInput,
  virtualToReal,
  type Cut,
  type Segment,
} from "../../lib/audiotool/cuts";
import { fmtTime } from "../../lib/audiotool/helpers";

const HANDLE_PX = 8;
/** Repères du temps au-dessus de la piste : environ tous les 60 px, sur des nombres ronds. */
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

const newCutId = () => `cut-${Date.now()}-${Math.round(Math.random() * 1e6)}`;

type Drag =
  | { type: "none" }
  | { type: "new"; startTime: number }
  | { type: "move"; id: string; offsetStart: number; offsetEnd: number }
  | { type: "resize"; id: string; edge: "left" | "right" };

interface Props {
  duration: number;
  waveform: number[];
  cuts: Cut[];
  kept: Segment[];
  selectedId: string | null;
  clock: PlaybackClock;
  /** Un geste est terminé : les coupes (fusionnées) remplacent les précédentes. */
  onCutsChange: (cuts: Cut[], selectedId: string | null) => void;
  onSelect: (id: string | null) => void;
  onSeekReal: (time: number) => void;
  onMark: (which: "start" | "end") => void;
  onSeekBy: (delta: number) => void;
}

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** La forme d'onde (canvas) et, par-dessus, les coupes : un glissé sur la piste marque une partie
 * à retirer, les bords d'une coupe la redimensionnent, son milieu la déplace, et un simple clic
 * déplace la tête de lecture. */
export default function CutTimeline({
  duration,
  waveform,
  cuts,
  kept,
  selectedId,
  clock,
  onCutsChange,
  onSelect,
  onSeekReal,
  onMark,
  onSeekBy,
}: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cutsRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** Les coupes pendant un glissé (le reste du temps : `cuts`). */
  const [live, setLive] = useState<Cut[] | null>(null);
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);
  const drag = useRef<Drag>({ type: "none" });
  const liveRef = useRef<Cut[] | null>(null);

  const shown = live ?? cuts;
  const pct = (time: number) => (duration > 0 ? (time / duration) * 100 : 0);

  // La taille du canvas suit celle de la zone.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setSize({ w: body.clientWidth, h: body.clientHeight });
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const virtual = useClockValue(clock, (time) => time);
  const playheadX = duration > 0 ? (virtualToReal(virtual, kept) / duration) * size.w : 0;

  // Les barres ne changent qu'avec le fichier, la taille ou le thème : elles sont dessinées une
  // fois dans une couche hors écran ; chaque image ne coûte alors qu'un `drawImage` et la tête de
  // lecture.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h || !waveform.length) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(size.w * dpr);
    const ph = Math.round(size.h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const bg = cssVar("--bg-card", "#2a2a2a");
    const on = cssVar("--accent", "#5c86ff");
    const key = [waveform.length, waveform[0], waveform[waveform.length - 1], pw, ph, bg, on].join("|");
    if (!layerRef.current || layerRef.current.key !== key) {
      const layer = layerRef.current?.canvas ?? document.createElement("canvas");
      layer.width = pw;
      layer.height = ph;
      const lctx = layer.getContext("2d");
      if (lctx) {
        lctx.setTransform(pw / size.w, 0, 0, ph / size.h, 0, 0);
        lctx.fillStyle = bg;
        lctx.fillRect(0, 0, size.w, size.h);
        const barW = size.w / waveform.length;
        lctx.fillStyle = on;
        for (let i = 0; i < waveform.length; i++) {
          const amp = Math.min(waveform[i], 1.0);
          const barH = Math.max(amp * size.h * 0.85, 1);
          lctx.fillRect(i * barW, (size.h - barH) / 2, Math.max(barW - 0.5, 0.5), barH);
        }
      }
      layerRef.current = { key, canvas: layer };
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(layerRef.current.canvas, 0, 0, size.w, size.h);
    // Tête de lecture, à l'endroit du fichier où se trouve le son.
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, size.h);
    ctx.stroke();
    ctx.restore();
  }, [waveform, size, playheadX]);

  const ticks = useMemo(() => {
    if (!(duration > 0)) return [];
    const step = RULER_STEPS.find((s) => duration / s <= 14) ?? 3600;
    const out: number[] = [];
    for (let time = 0; time <= duration; time += step) out.push(time);
    return out;
  }, [duration]);

  function xToTime(clientX: number): number {
    const rect = cutsRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || duration <= 0) return 0;
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (duration <= 0 || e.button > 0) return;
    // Le bouton « supprimer » d'une coupe gère son propre clic.
    if ((e.target as HTMLElement).closest(".at-cut-delete")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    canvasRef.current?.focus({ preventScroll: true });
    const time = xToTime(e.clientX);
    const rect = cutsRef.current?.getBoundingClientRect();
    if (!rect) return;
    for (const cut of cuts) {
      const left = rect.left + (cut.start / duration) * rect.width;
      const right = rect.left + (cut.end / duration) * rect.width;
      const tiny = right - left <= HANDLE_PX * 2;
      if (!tiny && Math.abs(e.clientX - left) < HANDLE_PX) {
        drag.current = { type: "resize", id: cut.id, edge: "left" };
      } else if (!tiny && Math.abs(e.clientX - right) < HANDLE_PX) {
        drag.current = { type: "resize", id: cut.id, edge: "right" };
      } else if (
        tiny ? e.clientX >= left && e.clientX <= right : e.clientX > left + HANDLE_PX && e.clientX < right - HANDLE_PX
      ) {
        // Une coupe trop étroite pour avoir un milieu ne peut qu'être déplacée.
        drag.current = { type: "move", id: cut.id, offsetStart: time - cut.start, offsetEnd: cut.end - time };
      } else {
        continue;
      }
      liveRef.current = cuts.map((c) => ({ ...c }));
      setLive(liveRef.current);
      onSelect(cut.id);
      return;
    }
    drag.current = { type: "new", startTime: time };
    onSelect(null);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (current.type === "none") return;
    const time = xToTime(e.clientX);
    if (current.type === "new") {
      setDraft({ start: Math.min(current.startTime, time), end: Math.max(current.startTime, time) });
      return;
    }
    const next = (liveRef.current ?? cuts).map((c) => ({ ...c }));
    const cut = next.find((c) => c.id === current.id);
    if (!cut) return;
    if (current.type === "move") {
      const length = cut.end - cut.start;
      let start = Math.max(0, time - current.offsetStart);
      let end = start + length;
      if (end > duration) {
        end = duration;
        start = Math.max(0, duration - length);
      }
      cut.start = start;
      cut.end = end;
    } else if (current.edge === "left") {
      cut.start = Math.max(0, Math.min(cut.end - MIN_CUT, time));
    } else {
      cut.end = Math.min(duration, Math.max(cut.start + MIN_CUT, time));
    }
    liveRef.current = next;
    setLive(next);
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement> | null, cancelled = false) {
    const current = drag.current;
    drag.current = { type: "none" };
    const edited = liveRef.current;
    liveRef.current = null;
    setLive(null);
    setDraft(null);
    if (current.type === "none") return;
    if (current.type === "new") {
      const time = e && !cancelled ? xToTime(e.clientX) : current.startTime;
      const start = Math.min(current.startTime, time);
      const end = Math.max(current.startTime, time);
      if (!cancelled && end - start > MIN_CUT) {
        const merged = mergeCuts([...cuts, { id: newCutId(), start, end }]);
        // La nouvelle coupe a pu être absorbée par une plus ancienne : on sélectionne ce qui la couvre.
        onCutsChange(merged, merged.find((c) => c.start <= start && c.end >= end)?.id ?? null);
      } else if (!cancelled) {
        onSeekReal(current.startTime);
      }
      return;
    }
    // Un glissé peut pousser une coupe sur une autre : fusionnées, c'est toujours un seul geste.
    if (!cancelled && edited) {
      const merged = mergeCuts(edited);
      const moved = edited.find((c) => c.id === current.id);
      const selected = moved ? (merged.find((c) => c.start <= moved.start && c.end >= moved.end)?.id ?? null) : null;
      onCutsChange(merged, selected);
    }
  }

  function removeCut(id: string) {
    onCutsChange(
      cuts.filter((c) => c.id !== id),
      null,
    );
  }

  const selected = cuts.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="at-timeline">
      <div className="at-tl-header">
        <span className="at-tl-label">{t("audioTool.cut.title")}</span>
        {cuts.length > 0 && <span className="at-danger-chip">{t("audioTool.cut.count", { count: cuts.length })}</span>}
        {cuts.length > 0 && (
          <button type="button" className="at-danger-btn" onClick={() => onCutsChange([], null)}>
            {t("audioTool.cut.clear")}
          </button>
        )}
        <span className="at-tl-hint">{t("audioTool.cut.hint")}</span>
      </div>
      <div
        className="at-track"
        data-testid="cut-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={() => endDrag(null, true)}
      >
        <div className="at-ruler">
          {ticks.map((time) => (
            <div key={time} className="at-tick" style={{ left: `${pct(time)}%` }}>
              <span>{fmtTime(time)}</span>
            </div>
          ))}
        </div>
        <div className="at-body" ref={bodyRef}>
          <canvas
            ref={canvasRef}
            role="img"
            tabIndex={0}
            aria-label={t("audioTool.player.waveform")}
            onKeyDown={(e) => {
              if (e.key === "i" || e.key === "o") {
                e.preventDefault();
                onMark(e.key === "i" ? "start" : "end");
              } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                onSeekBy((e.shiftKey ? 5 : 1) * (e.key === "ArrowLeft" ? -1 : 1));
              }
            }}
          />
          <div className="at-cuts" ref={cutsRef}>
            {shown.map((cut) => (
              <div
                key={cut.id}
                className={`at-cut${cut.id === selectedId ? " selected" : ""}`}
                data-id={cut.id}
                style={{ left: `${pct(cut.start)}%`, width: `${pct(cut.end - cut.start)}%` }}
              >
                <div className="at-cut-handle left" title={t("audioTool.cut.resize")} />
                <div className="at-cut-info">
                  <span className="at-cut-duration">{fmtTime(cut.end - cut.start)}</span>
                  <button
                    type="button"
                    className="at-cut-delete"
                    title={t("audioTool.cut.delete")}
                    aria-label={t("audioTool.cut.delete")}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCut(cut.id);
                    }}
                  >
                    ×
                  </button>
                </div>
                <div className="at-cut-handle right" title={t("audioTool.cut.resize")} />
              </div>
            ))}
            {draft && draft.end > draft.start && (
              <div
                className="at-cut draft"
                style={{ left: `${pct(draft.start)}%`, width: `${pct(draft.end - draft.start)}%` }}
              />
            )}
          </div>
        </div>
      </div>
      <CutEditor
        cut={selected}
        duration={duration}
        onEdit={(id, edge, value) => {
          const next = cuts.map((c) => ({ ...c }));
          const cut = next.find((c) => c.id === id);
          if (!cut) return;
          if (edge === "start") cut.start = Math.max(0, Math.min(cut.end - MIN_CUT, value));
          else cut.end = Math.min(duration, Math.max(cut.start + MIN_CUT, value));
          const { start, end } = cut;
          const merged = mergeCuts(next);
          onCutsChange(merged, merged.find((c) => c.start <= start && c.end >= end)?.id ?? null);
        }}
        onDelete={removeCut}
      />
    </div>
  );
}

/** Les champs de la coupe sélectionnée, ou la ligne qui dit d'en sélectionner une. */
function CutEditor({
  cut,
  duration,
  onEdit,
  onDelete,
}: {
  cut: Cut | null;
  duration: number;
  onEdit: (id: string, edge: "start" | "end", value: number) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  void duration;
  return (
    <div className="at-cut-editor">
      <span className="at-cut-editor-label">{t("audioTool.cut.selected")}</span>
      {!cut ? (
        <span className="at-placeholder">{t("audioTool.cut.placeholder")}</span>
      ) : (
        <div className="at-cut-fields">
          <TimeField label={t("audioTool.cut.start")} value={cut.start} onCommit={(v) => onEdit(cut.id, "start", v)} />
          <span>→</span>
          <TimeField label={t("audioTool.cut.end")} value={cut.end} onCommit={(v) => onEdit(cut.id, "end", v)} />
          <span className="at-cut-dur">({fmtPrecise(cut.end - cut.start)})</span>
          <button
            type="button"
            className="at-danger-btn"
            style={{ marginLeft: "auto" }}
            onClick={() => onDelete(cut.id)}
          >
            {t("audioTool.cut.delete")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Un champ de temps `m:ss.t` : le texte tapé est laissé tranquille jusqu'à Entrée ou la perte du
 * focus ; un texte invalide, ou laissé tel quel, ne change rien. */
function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(fmtPrecise(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmtPrecise(value));
  }, [value]);
  function commit() {
    focused.current = false;
    // Quitter un champ intact rend son texte arrondi : ce n'est pas une édition.
    if (text === fmtPrecise(value)) return;
    const parsed = parseTimeInput(text);
    if (parsed === null) {
      setText(fmtPrecise(value));
      return;
    }
    onCommit(parsed);
  }
  return (
    <label className="at-cut-field">
      <span>{label}</span>
      <input
        className="at-cut-input"
        title="M:SS.s"
        spellCheck={false}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={commit}
      />
    </label>
  );
}

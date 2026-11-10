import { memo, useRef, useCallback, useEffect, useState, useLayoutEffect } from "react";
import type { TrimSegment } from "../types";
import { formatTime, parseTimeInput } from "../utils/time";
import { mergeSegments } from "../utils/timeline";
import { useT } from "../i18n";
import FilmStrip from "./FilmStrip";
import CutEditor from "./CutEditor";
import "./Timeline.css";

interface Props {
  duration: number;
  currentTime: number;
  cutSegments: TrimSegment[];
  videoUrl: string;
  onSeek: (time: number) => void;
  onCutSegmentsChange: (segs: TrimSegment[]) => void;
  onCutSegmentsChangeLive: (segs: TrimSegment[]) => void;
  onCommit: () => void;
}

type DragMode =
  | { type: "none" }
  | { type: "new-cut"; startTime: number }
  | { type: "move-cut"; id: string; offsetStart: number; offsetEnd: number }
  | { type: "resize-cut"; id: string; edge: "left" | "right" };

const MIN_CUT = 0.05;

function Timeline({
  duration,
  currentTime,
  cutSegments,
  videoUrl,
  onSeek,
  onCutSegmentsChange,
  onCutSegmentsChangeLive,
  onCommit,
}: Props) {
  const { t } = useT();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode>({ type: "none" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  // The zone being drawn, so the user sees it before releasing the pointer.
  const [draft, setDraft] = useState<{ start: number; end: number } | null>(null);

  // Track width for filmstrip
  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setTrackWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedSeg = cutSegments.find((s) => s.id === selectedId) ?? null;

  const timeToPercent = useCallback((t: number) => (duration > 0 ? (t / duration) * 100 : 0), [duration]);
  const xToTime = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return 0;
      return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
    },
    [duration],
  );

  // ─── Pointer down ──────────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!trackRef.current || duration <= 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);

      const time = xToTime(e.clientX);
      const rect = trackRef.current.getBoundingClientRect();
      const handlePx = 8;

      for (const seg of cutSegments) {
        const leftPx = rect.left + (seg.start / duration) * rect.width;
        const rightPx = rect.left + (seg.end / duration) * rect.width;

        const isTiny = rightPx - leftPx <= handlePx * 2;
        if (!isTiny && Math.abs(e.clientX - leftPx) < handlePx) {
          dragRef.current = { type: "resize-cut", id: seg.id, edge: "left" };
          setSelectedId(seg.id);
          return;
        }
        if (!isTiny && Math.abs(e.clientX - rightPx) < handlePx) {
          dragRef.current = { type: "resize-cut", id: seg.id, edge: "right" };
          setSelectedId(seg.id);
          return;
        }
        // A cut narrower than two handles has no "middle": any press inside it
        // moves it, otherwise it could only ever be resized.
        const tiny = rightPx - leftPx <= handlePx * 2;
        if (
          tiny
            ? e.clientX >= leftPx && e.clientX <= rightPx
            : e.clientX > leftPx + handlePx && e.clientX < rightPx - handlePx
        ) {
          dragRef.current = { type: "move-cut", id: seg.id, offsetStart: time - seg.start, offsetEnd: seg.end - time };
          setSelectedId(seg.id);
          return;
        }
      }

      dragRef.current = { type: "new-cut", startTime: time };
      setSelectedId(null);
    },
    [cutSegments, duration, xToTime],
  );

  // ─── Pointer move ──────────────────────────────────────────────────────────
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      const time = xToTime(e.clientX);

      if (drag.type === "new-cut") {
        setDraft({ start: Math.min(drag.startTime, time), end: Math.max(drag.startTime, time) });
      } else if (drag.type === "move-cut") {
        const seg = cutSegments.find((s) => s.id === drag.id);
        if (!seg) return;
        const dur = seg.end - seg.start;
        let newStart = Math.max(0, time - drag.offsetStart);
        let newEnd = newStart + dur;
        if (newEnd > duration) {
          newEnd = duration;
          newStart = Math.max(0, duration - dur);
        }
        onCutSegmentsChangeLive(
          cutSegments.map((s) => (s.id === drag.id ? { ...s, start: newStart, end: newEnd } : s)),
        );
      } else if (drag.type === "resize-cut") {
        const seg = cutSegments.find((s) => s.id === drag.id);
        if (!seg) return;
        if (drag.edge === "left") {
          const newStart = Math.max(0, Math.min(seg.end - MIN_CUT, time));
          onCutSegmentsChangeLive(cutSegments.map((s) => (s.id === drag.id ? { ...s, start: newStart } : s)));
        } else {
          const newEnd = Math.min(duration, Math.max(seg.start + MIN_CUT, time));
          onCutSegmentsChangeLive(cutSegments.map((s) => (s.id === drag.id ? { ...s, end: newEnd } : s)));
        }
      }
    },
    [cutSegments, duration, xToTime, onCutSegmentsChangeLive],
  );

  // ─── Pointer up ────────────────────────────────────────────────────────────
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = { type: "none" };
      setDraft(null);

      if (drag.type === "new-cut") {
        const time = xToTime(e.clientX);
        const start = Math.min(drag.startTime, time);
        const end = Math.max(drag.startTime, time);
        if (end - start > MIN_CUT) {
          const merged = mergeSegments([...cutSegments, { id: `cut-${Date.now()}`, start, end }]);
          onCutSegmentsChange(merged);
          // The new cut may have been absorbed into an existing one, which keeps
          // the earlier segment's id — select whichever zone now covers the draw.
          setSelectedId(merged.find((s) => s.start <= start && s.end >= end)?.id ?? null);
        } else {
          onSeek(drag.startTime);
        }
        return;
      }

      if (drag.type === "move-cut" || drag.type === "resize-cut") {
        // A drag can push one cut over another; merge so the timeline never shows
        // two stacked zones. Still part of the gesture, so it costs no extra undo step.
        const merged = mergeSegments(cutSegments);
        if (merged.length !== cutSegments.length) {
          onCutSegmentsChangeLive(merged);
          setSelectedId((prev) => (merged.some((s) => s.id === prev) ? prev : null));
        }
        onCommit();
      }
    },
    [cutSegments, xToTime, onSeek, onCutSegmentsChange, onCutSegmentsChangeLive, onCommit],
  );

  // A cancelled pointer (focus lost, OS interruption) must close the gesture,
  // or the next unrelated edit would be folded into it.
  const onPointerCancel = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = { type: "none" };
    setDraft(null);
    if (drag.type === "move-cut" || drag.type === "resize-cut") onCommit();
  }, [onCommit]);

  const deleteCut = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      onCutSegmentsChange(cutSegments.filter((s) => s.id !== id));
      if (selectedId === id) setSelectedId(null);
    },
    [cutSegments, selectedId, onCutSegmentsChange],
  );

  // ─── Time input handlers ───────────────────────────────────────────────────
  const handleTimeInput = useCallback(
    (id: string, edge: "start" | "end", raw: string) => {
      const parsed = parseTimeInput(raw);
      if (parsed === null) return;
      const seg = cutSegments.find((s) => s.id === id);
      if (!seg) return;

      let updated: TrimSegment;
      if (edge === "start") {
        const newStart = Math.max(0, Math.min(seg.end - MIN_CUT, parsed));
        updated = { ...seg, start: newStart };
      } else {
        const newEnd = Math.min(duration, Math.max(seg.start + MIN_CUT, parsed));
        updated = { ...seg, end: newEnd };
      }
      // Typing times can overlap another cut, just like dragging can.
      const merged = mergeSegments(cutSegments.map((s) => (s.id === id ? updated : s)));
      onCutSegmentsChange(merged);
      setSelectedId(merged.find((s) => s.start <= updated.start && s.end >= updated.end)?.id ?? null);
    },
    [cutSegments, duration, onCutSegmentsChange],
  );

  // Delete / Backspace removes the selected cut, unless a text field is focused.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
      )
        return;
      e.preventDefault();
      onCutSegmentsChange(cutSegments.filter((s) => s.id !== selectedId));
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, cutSegments, onCutSegmentsChange]);

  const playheadPct = timeToPercent(currentTime);

  return (
    <div className="timeline">
      {/* Header */}
      <div className="tl-header">
        <span className="tl-label">{t.tl_trim}</span>
        {cutSegments.length > 0 && <span className="tl-cut-count">{t.tl_cuts(cutSegments.length)}</span>}
        {cutSegments.length > 0 && (
          <button
            className="tl-clear-btn"
            onClick={() => {
              onCutSegmentsChange([]);
              setSelectedId(null);
            }}
          >
            {t.tl_clear}
          </button>
        )}
        <span className="tl-hint">{t.tl_hint}</span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="tl-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {/* Ruler */}
        <TimeRuler duration={duration} />

        {/* Body */}
        <div className="tl-body">
          {/* Filmstrip */}
          <FilmStrip videoUrl={videoUrl} duration={duration} trackWidth={trackWidth} />

          {/* Darkening outside cuts (kept zones stay bright) */}
          <div className="tl-kept-mask" />

          {/* Zone being drawn */}
          {draft && draft.end > draft.start && (
            <div
              className="tl-cut tl-cut-draft"
              style={{
                left: `${timeToPercent(draft.start)}%`,
                width: `${timeToPercent(draft.end - draft.start)}%`,
                pointerEvents: "none",
              }}
            />
          )}

          {/* Cut segments */}
          {cutSegments.map((seg) => (
            <div
              key={seg.id}
              className={`tl-cut ${selectedId === seg.id ? "selected" : ""}`}
              style={{ left: `${timeToPercent(seg.start)}%`, width: `${timeToPercent(seg.end - seg.start)}%` }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedId(seg.id);
              }}
            >
              <div className="tl-cut-handle tl-cut-handle-left" title={t.cut_resize} />
              <div className="tl-cut-info">
                <span className="tl-cut-duration">{formatTime(seg.end - seg.start)}</span>
                <button
                  className="tl-cut-delete"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => deleteCut(seg.id, e)}
                >
                  ×
                </button>
              </div>
              <div className="tl-cut-handle tl-cut-handle-right" title={t.cut_resize} />
            </div>
          ))}

          {/* Playhead */}
          <div className="tl-playhead" style={{ left: `${playheadPct}%` }}>
            <div className="tl-playhead-head" />
          </div>
        </div>
      </div>

      {/* Precise time editor — always rendered to avoid layout shift */}
      <CutEditor
        seg={selectedSeg}
        duration={duration}
        onTimeInput={handleTimeInput}
        onDelete={(id) => {
          onCutSegmentsChange(cutSegments.filter((s) => s.id !== id));
          setSelectedId(null);
        }}
        onSeek={onSeek}
      />
    </div>
  );
}

export default memo(Timeline);

// ─── TimeRuler ────────────────────────────────────────────────────────────────

// Smallest "nice" step that keeps the labelled ticks (every 5th) at least ~60px
// apart on a typical track, so a 3 h video does not stack 180 overlapping labels.
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export function rulerStep(duration: number): number {
  const maxMajorTicks = 14;
  return RULER_STEPS.find((step) => duration / (step * 5) <= maxMajorTicks) ?? 3600;
}

function TimeRuler({ duration }: { duration: number }) {
  if (duration <= 0) return <div className="tl-ruler" />;
  const step = rulerStep(duration);
  const ticks: { t: number; major: boolean }[] = [];
  for (let t = 0; t <= duration; t += step) {
    ticks.push({ t, major: (t / step) % 5 === 0 });
  }
  return (
    <div className="tl-ruler">
      {ticks.map(({ t, major }) => (
        <div key={t} className={`tl-tick ${major ? "major" : "minor"}`} style={{ left: `${(t / duration) * 100}%` }}>
          {major && <span className="tl-tick-label">{formatTime(t)}</span>}
        </div>
      ))}
    </div>
  );
}

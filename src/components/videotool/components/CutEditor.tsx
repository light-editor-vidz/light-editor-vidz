import { useState } from "react";
import type { TrimSegment } from "../types";
import { formatTimePrecise } from "../utils/time";
import { useT } from "../i18n";

export interface CutEditorProps {
  seg: TrimSegment | null;
  duration: number;
  onTimeInput: (id: string, edge: "start" | "end", raw: string) => void;
  onDelete: (id: string) => void;
  onSeek: (time: number) => void;
}

export default function CutEditor({ seg, onTimeInput, onDelete, onSeek }: CutEditorProps) {
  const { t } = useT();
  // null = not editing → display derived from props; string = user is typing locally
  const [editingStart, setEditingStart] = useState<string | null>(null);
  const [editingEnd, setEditingEnd] = useState<string | null>(null);

  const startVal = editingStart ?? (seg ? formatTimePrecise(seg.start) : "");
  const endVal = editingEnd ?? (seg ? formatTimePrecise(seg.end) : "");

  const commitAndReset = (edge: "start" | "end", raw: string) => {
    // Focusing then leaving a field without typing hands back the display text,
    // rounded to a tenth. Committing that would silently move the boundary and
    // add an undo step for nothing.
    const shown = seg ? formatTimePrecise(edge === "start" ? seg.start : seg.end) : "";
    if (seg && raw !== shown) onTimeInput(seg.id, edge, raw);
    if (edge === "start") setEditingStart(null);
    else setEditingEnd(null);
  };

  return (
    <div className="cut-editor">
      <span className="cut-editor-label">{t.cut_editor_label}</span>

      {seg ? (
        <>
          <div className="cut-editor-field">
            <span className="cut-editor-field-label">{t.cut_start}</span>
            <input
              className="cut-editor-input"
              value={startVal}
              onChange={(e) => setEditingStart(e.target.value)}
              onBlur={(e) => commitAndReset("start", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onFocus={() => setEditingStart(formatTimePrecise(seg.start))}
              title={t.cut_format}
            />
            <button className="cut-editor-seek" onClick={() => onSeek(seg.start)} title={t.cut_jump}>
              ↵
            </button>
          </div>

          <span className="cut-editor-arrow">→</span>

          <div className="cut-editor-field">
            <span className="cut-editor-field-label">{t.cut_end}</span>
            <input
              className="cut-editor-input"
              value={endVal}
              onChange={(e) => setEditingEnd(e.target.value)}
              onBlur={(e) => commitAndReset("end", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onFocus={() => setEditingEnd(formatTimePrecise(seg.end))}
              title={t.cut_format}
            />
            <button className="cut-editor-seek" onClick={() => onSeek(seg.end)} title={t.cut_jump}>
              ↵
            </button>
          </div>

          <span className="cut-editor-dur">({formatTimePrecise(seg.end - seg.start)})</span>

          <button className="cut-editor-delete" onClick={() => onDelete(seg.id)}>
            {t.cut_delete}
          </button>
        </>
      ) : (
        <span className="cut-editor-placeholder">{t.cut_editor_placeholder}</span>
      )}
    </div>
  );
}

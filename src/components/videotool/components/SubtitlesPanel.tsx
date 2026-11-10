import { useCallback, useState } from "react";
import { getApi } from "../api";
import type { SubtitlesState, SubtitleStyle, SubtitleAnimation } from "../types";
import { parseSrt } from "../utils/srt";
import { useT } from "../i18n";
import CueEditor, { CueList } from "../../subtitles/CueEditor";
import "../../subtitles/subtitles.css";
import "./SubtitlesPanel.css";

export interface GeneratedSubtitles {
  id: number;
  label: string;
  cues: ReturnType<typeof parseSrt>;
}

interface Props {
  subtitles: SubtitlesState | null;
  onImport: (fileName: string, cues: ReturnType<typeof parseSrt>) => void;
  onStyleChange: (style: SubtitleStyle) => void;
  /** Continuous edits (sliders, colour pickers): one undo step per gesture. */
  onStyleChangeLive?: (style: SubtitleStyle) => void;
  onCommit?: () => void;
  /** Called with a short reason key when the file cannot be used. */
  onError?: (reason: "empty" | "read") => void;
  onAnimationChange: (animation: SubtitleAnimation) => void;
  onRemove: () => void;
  /** Subtitles generated for this video, offered as a list to pick from. */
  generated?: GeneratedSubtitles[];
  onUseGenerated?: (item: GeneratedSubtitles) => void;
  onDiscardGenerated?: (id: number) => void;
  /** Corrected texts of the subtitles in use (timings unchanged; an empty text removes its cue). */
  onEditTexts?: (texts: string[]) => void;
}

// Only families that exist on macOS, Windows and (via fontconfig aliases or
// metric-compatible substitutes) Linux. Listing Calibri or Futura meant the
// preview and the export each silently picked a different fallback.
const FONT_OPTIONS = [
  "Arial",
  "Arial Black",
  "Helvetica",
  "Impact",
  "Verdana",
  "Trebuchet MS",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Comic Sans MS",
  "sans-serif",
  "serif",
  "monospace",
];

export default function SubtitlesPanel({
  subtitles,
  onImport,
  onStyleChange,
  onStyleChangeLive,
  onCommit,
  onError,
  onAnimationChange,
  onRemove,
  generated = [],
  onUseGenerated,
  onDiscardGenerated,
  onEditTexts,
}: Props) {
  const { t } = useT();
  // The cues being edited: anything that replaces them (undo, another set) ends the edit.
  const [editingCues, setEditingCues] = useState<ReturnType<typeof parseSrt> | null>(null);

  const ANIMATIONS: { id: SubtitleAnimation; label: string; desc: string }[] = [
    { id: "word-pop", label: t.subtitles_anim_word_pop, desc: t.subtitles_anim_word_pop_desc },
    { id: "word-bounce", label: t.subtitles_anim_word_bounce, desc: t.subtitles_anim_word_bounce_desc },
    { id: "word-highlight", label: t.subtitles_anim_word_highlight, desc: t.subtitles_anim_word_highlight_desc },
    { id: "rainbow", label: t.subtitles_anim_rainbow, desc: t.subtitles_anim_rainbow_desc },
    { id: "sentence-fade", label: t.subtitles_anim_sentence_fade, desc: t.subtitles_anim_sentence_fade_desc },
    { id: "sentence-slide", label: t.subtitles_anim_sentence_slide, desc: t.subtitles_anim_sentence_slide_desc },
    { id: "typewriter", label: t.subtitles_anim_typewriter, desc: t.subtitles_anim_typewriter_desc },
  ];

  const handleImport = useCallback(async () => {
    try {
      const result = await getApi().openSubtitleFile();
      if (!result) return;
      const cues = parseSrt(result.content);
      if (cues.length === 0) {
        onError?.("empty");
        return;
      }
      const fileName = result.filePath.split(/[/\\]/).pop() || result.filePath;
      onImport(fileName, cues);
    } catch (err) {
      console.error("Subtitle import failed:", err);
      onError?.("read");
    }
  }, [onImport, onError]);

  const generatedList =
    generated.length > 0 ? (
      <div className="subtitles-section">
        <div className="subtitles-label">{t.subtitles_generated}</div>
        <ul className="subtitles-generated">
          {generated.map((g) => (
            <li key={g.id}>
              <span className="subtitles-generated-name">
                {g.label} · {t.subtitles_generated_count.replace("{n}", String(g.cues.length))}
              </span>
              <button className="btn-secondary" onClick={() => onUseGenerated?.(g)}>
                {t.subtitles_use}
              </button>
              <button className="btn-ghost" onClick={() => onDiscardGenerated?.(g.id)}>
                {t.subtitles_discard}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  if (!subtitles) {
    return (
      <div className="subtitles-panel">
        <p className="subtitles-hint">{t.subtitles_hint}</p>
        <button className="btn-primary" onClick={handleImport}>
          {t.subtitles_import}
        </button>
        {generatedList}
      </div>
    );
  }

  const { style, animation } = subtitles;

  const patchStyle = (patch: Partial<SubtitleStyle>) => onStyleChange({ ...style, ...patch });
  // Sliders and colour pickers fire a change per tick: fold them into one step.
  const patchLive = (patch: Partial<SubtitleStyle>) => (onStyleChangeLive ?? onStyleChange)({ ...style, ...patch });
  const commitProps = onCommit
    ? { onPointerUp: onCommit, onPointerCancel: onCommit, onKeyUp: onCommit, onBlur: onCommit }
    : {};

  return (
    <div className="subtitles-panel">
      <div className="subtitles-file-row">
        <span className="subtitles-filename">{subtitles.fileName}</span>
        <button className="btn-ghost subtitles-remove" onClick={onRemove}>
          {t.subtitles_remove}
        </button>
      </div>

      {generatedList}

      {onEditTexts && (
        <div className="subtitles-section">
          <div className="subtitles-label">{t.subtitles_texts}</div>
          {editingCues === subtitles.cues ? (
            <CueEditor
              cues={subtitles.cues}
              onApply={(texts) => {
                onEditTexts(texts);
                setEditingCues(null);
              }}
              onCancel={() => setEditingCues(null)}
            />
          ) : (
            <>
              <CueList cues={subtitles.cues} />
              <button className="btn-secondary" onClick={() => setEditingCues(subtitles.cues)}>
                {t.subtitles_edit}
              </button>
            </>
          )}
        </div>
      )}

      <div className="subtitles-section">
        <div className="subtitles-label">{t.subtitles_animation}</div>
        <div className="subtitles-anim-grid">
          {ANIMATIONS.map((a) => (
            <button
              key={a.id}
              className={`subtitles-anim-card ${animation === a.id ? "active" : ""}`}
              onClick={() => onAnimationChange(a.id)}
            >
              <span className="subtitles-anim-name">{a.label}</span>
              <span className="subtitles-anim-desc">{a.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="subtitles-section">
        <div className="subtitles-label">{t.subtitles_font}</div>
        <select
          className="subtitles-select"
          value={style.fontFamily}
          onChange={(e) => patchStyle({ fontFamily: e.target.value })}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>

      <div className="subtitles-section">
        <div className="subtitles-label">{t.subtitles_size}</div>
        <input
          type="range"
          min="2"
          max="12"
          step="0.5"
          value={style.fontSize}
          onChange={(e) => patchLive({ fontSize: Number(e.target.value) })}
          {...commitProps}
          className="subtitles-slider"
        />
      </div>

      <div className="subtitles-section subtitles-colors">
        <div className="subtitles-color-field">
          <label>{t.subtitles_color}</label>
          <input
            type="color"
            value={style.color}
            onChange={(e) => patchLive({ color: e.target.value })}
            {...commitProps}
          />
        </div>
        <div className="subtitles-color-field">
          <label>{t.subtitles_outline}</label>
          <input
            type="color"
            value={style.outlineColor}
            onChange={(e) => patchLive({ outlineColor: e.target.value })}
            {...commitProps}
          />
        </div>
        <div className="subtitles-color-field">
          <label>{t.subtitles_background}</label>
          <input
            type="color"
            value={style.backgroundColor}
            onChange={(e) => patchLive({ backgroundColor: e.target.value })}
            {...commitProps}
          />
        </div>
        {animation === "word-highlight" && (
          <div className="subtitles-color-field">
            <label>{t.subtitles_accent}</label>
            <input
              type="color"
              value={style.accentColor}
              onChange={(e) => patchLive({ accentColor: e.target.value })}
              {...commitProps}
            />
          </div>
        )}
      </div>

      <div className="subtitles-section">
        <div className="subtitles-label">{t.subtitles_outline_width}</div>
        <input
          type="range"
          min="0"
          max="6"
          step="0.5"
          value={style.outlineWidth}
          onChange={(e) => patchLive({ outlineWidth: Number(e.target.value) })}
          {...commitProps}
          className="subtitles-slider"
        />
      </div>

      <div className="subtitles-section">
        <div className="subtitles-label">{t.subtitles_background_opacity}</div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={style.backgroundOpacity}
          onChange={(e) => patchLive({ backgroundOpacity: Number(e.target.value) })}
          {...commitProps}
          className="subtitles-slider"
        />
      </div>

      <div className="subtitles-section">
        <div className="subtitles-label">{t.subtitles_position}</div>
        <div className="subtitles-position-row">
          {(
            [
              { id: "top", label: t.subtitles_position_top },
              { id: "middle", label: t.subtitles_position_middle },
              { id: "bottom", label: t.subtitles_position_bottom },
            ] as const
          ).map((pos) => (
            <button
              key={pos.id}
              className={`btn-secondary ${style.position === pos.id ? "active" : ""}`}
              onClick={() => patchStyle({ position: pos.id })}
            >
              {pos.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { memo } from "react";
import type { EditorState } from "../types";
import type { StabilizeLevel } from "../hooks/useHistory";
import { useT } from "../i18n";
import { getFilterById } from "../utils/filters";
import { CubeIcon, StarIcon, SoundOnIcon, SoundOffIcon, CropIcon, SubtitleIcon } from "./icons";
import "./Toolbar.css";

const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const STABILIZE_LEVELS: StabilizeLevel[] = ["off", "light", "normal", "strong"];

interface Props {
  state: EditorState;
  showCrop: boolean;
  showFilters: boolean;
  showGeometry: boolean;
  showSubtitles: boolean;
  onSpeedChange: (speed: number) => void;
  onSpeedChangeLive: (speed: number) => void;
  onCommit: () => void;
  onStabilizeChange: (level: StabilizeLevel) => void;
  onMuteToggle: () => void;
  onCropToggle: () => void;
  onCropReset: () => void;
  onFilterToggle: () => void;
  onGeometryToggle: () => void;
  onSubtitlesToggle: () => void;
}

function Toolbar({
  state,
  showCrop,
  showFilters,
  showGeometry,
  showSubtitles,
  onSpeedChange,
  onSpeedChangeLive,
  onCommit,
  onStabilizeChange,
  onMuteToggle,
  onCropToggle,
  onCropReset,
  onFilterToggle,
  onGeometryToggle,
  onSubtitlesToggle,
}: Props) {
  const { t, lang } = useT();
  const activeFilter = getFilterById(state.filter);
  const geometryActive =
    state.rotation !== 0 ||
    state.straighten !== 0 ||
    state.perspectiveHorizontal !== 0 ||
    state.perspectiveVertical !== 0;

  return (
    <div className="toolbar">
      {/* Geometry (Rotate & Perspective) */}
      <div className="tool-section">
        <div className="tool-label">{t.tool_geometry}</div>
        <button
          className={`tool-toggle-btn ${showGeometry ? "active-accent" : geometryActive ? "active-ok" : ""}`}
          onClick={onGeometryToggle}
        >
          <CubeIcon />
          {t.tool_geometry}
        </button>
      </div>

      <div className="tool-divider" />

      {/* Filters */}
      <div className="tool-section">
        <div className="tool-label">{t.tool_filters}</div>
        <button
          className={`tool-toggle-btn ${showFilters ? "active-accent" : state.filter !== "none" ? "active-ok" : ""}`}
          onClick={onFilterToggle}
        >
          <StarIcon />
          {state.filter === "none" ? t.tool_filters : lang === "fr" ? activeFilter.nameFr : activeFilter.nameEn}
        </button>
      </div>

      <div className="tool-divider" />

      {/* Subtitles */}
      <div className="tool-section">
        <div className="tool-label">{t.tool_subtitles}</div>
        <button
          className={`tool-toggle-btn ${showSubtitles ? "active-accent" : state.subtitles ? "active-ok" : ""}`}
          onClick={onSubtitlesToggle}
        >
          <SubtitleIcon />
          <span className="tool-toggle-btn-label" title={state.subtitles?.fileName}>
            {state.subtitles ? state.subtitles.fileName : t.tool_subtitles}
          </span>
        </button>
      </div>

      <div className="tool-divider" />

      {/* Speed */}
      <div className="tool-section">
        <div className="tool-label">{t.tool_speed}</div>
        <div className="speed-display">{state.speed}x</div>
        <input
          type="range"
          min={0}
          max={SPEED_PRESETS.length - 1}
          step={1}
          value={SPEED_PRESETS.indexOf(state.speed) !== -1 ? SPEED_PRESETS.indexOf(state.speed) : 3}
          onChange={(e) => onSpeedChangeLive(SPEED_PRESETS[Number(e.target.value)])}
          onPointerUp={onCommit}
          onPointerCancel={onCommit}
          onKeyUp={onCommit}
          onBlur={onCommit}
          className="speed-slider"
        />
        <div className="speed-labels">
          <span>0.25x</span>
          <span>4x</span>
        </div>
        <div className="speed-presets">
          {SPEED_PRESETS.map((s) => (
            <button
              key={s}
              className={`preset-btn ${state.speed === s ? "active" : ""}`}
              onClick={() => onSpeedChange(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      <div className="tool-divider" />

      {/* Audio */}
      <div className="tool-section">
        <div className="tool-label">{t.tool_audio}</div>
        <button className={`tool-toggle-btn ${state.muted ? "active-danger" : "active-ok"}`} onClick={onMuteToggle}>
          {state.muted ? (
            <>
              <SoundOffIcon />
              {t.tool_muted}
            </>
          ) : (
            <>
              <SoundOnIcon />
              {t.tool_sound_on}
            </>
          )}
        </button>
      </div>

      <div className="tool-divider" />

      {/* Crop */}
      <div className="tool-section">
        <div className="tool-label">{t.tool_crop}</div>

        {showCrop ? (
          <p className="crop-hint">{t.crop_hint}</p>
        ) : state.crop ? (
          <>
            <div className="crop-applied-badge">
              ✓ {Math.round(state.crop.w)} × {Math.round(state.crop.h)}
            </div>
            <button className="tool-toggle-btn active-accent" onClick={onCropToggle}>
              {t.crop_adjust}
            </button>
            <button className="tool-toggle-btn crop-reset-btn" onClick={onCropReset}>
              {t.crop_reset}
            </button>
          </>
        ) : (
          <button className="tool-toggle-btn" onClick={onCropToggle}>
            <CropIcon />
            {t.crop_set}
          </button>
        )}
      </div>

      <div className="tool-divider" />

      {/* Stabilisation: analysed and applied at export */}
      <div className="tool-section">
        <div className="tool-label">{t.tool_stabilize}</div>
        <div className="stab-options" role="group" aria-label={t.tool_stabilize}>
          {STABILIZE_LEVELS.map((level) => (
            <button
              key={level}
              className={`stab-btn ${state.stabilize === level ? "active" : ""}`}
              aria-pressed={state.stabilize === level}
              onClick={() => onStabilizeChange(level)}
            >
              {t[`stabilize_${level}`]}
            </button>
          ))}
        </div>
        {state.stabilize !== "off" && <p className="trim-hint">{t.stabilize_hint}</p>}
      </div>

      <div className="tool-divider" />

      {/* Trim info */}
      <div className="tool-section">
        <div className="tool-label">{t.tool_trim}</div>
        <p className="trim-hint">{t.trim_hint}</p>
        {state.cutSegments.length > 0 && <div className="trim-count">{t.cuts_count(state.cutSegments.length)}</div>}
      </div>
    </div>
  );
}

export default memo(Toolbar);

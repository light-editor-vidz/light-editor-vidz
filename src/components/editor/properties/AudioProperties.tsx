import { useTranslation } from "react-i18next";
import { Music } from "lucide-react";
import type { AudioTrack } from "../../../bindings/AudioTrack";
import type { AudioFilter } from "../../../bindings/AudioFilter";
import type { AudioFilterKind } from "../../../bindings/AudioFilterKind";
import type { FadeCurve } from "../../../bindings/FadeCurve";
import { AUDIO_SPEED_MAX, AUDIO_SPEED_MIN, defaultAudioFilter } from "../../../lib/audio";
import { Header } from "./Header";
import { NumberField } from "./NumberField";

const FADE_CURVES: { value: FadeCurve; labelKey: string }[] = [
  { value: "linear", labelKey: "properties.fadeCurveLinear" },
  { value: "equal-power", labelKey: "properties.fadeCurveEqualPower" },
];

const FILTER_KINDS: { value: AudioFilterKind; labelKey: string }[] = [
  { value: "low-pass", labelKey: "properties.filterLowPass" },
  { value: "high-pass", labelKey: "properties.filterHighPass" },
  { value: "band-pass", labelKey: "properties.filterBandPass" },
];

const FILTER_SLOPES = [12, 24, 36, 48];

export function AudioProperties({
  track,
  onUpdate,
}: {
  track: AudioTrack;
  onUpdate: (patch: Partial<AudioTrack>) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Header
        color="var(--color-audio)"
        icon={<Music size={13} />}
        title={t("properties.audioTitle")}
        subtitle={track.name}
      />

      <div className="properties-section">
        <span className="properties-label">{t("properties.trackName")}</span>
        <input className="properties-input" value={track.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </div>

      <div className="properties-section">
        <div className="properties-row properties-row-header">
          <span className="properties-label">{t("properties.volume")}</span>
          <div className="properties-row">
            <button
              type="button"
              className={`properties-toggle${track.solo ? " active" : ""}`}
              onClick={() => onUpdate({ solo: !track.solo })}
              title={t("properties.solo")}
            >
              {t("properties.solo")}
            </button>
            <button
              type="button"
              className={`properties-toggle${track.muted ? " active" : ""}`}
              onClick={() => onUpdate({ muted: !track.muted })}
              title={t("properties.mute")}
            >
              {track.muted ? t("properties.muted") : t("properties.mute")}
            </button>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(e) => onUpdate({ volume: Number(e.target.value) })}
        />
      </div>

      <div className="properties-section">
        <span className="properties-label">{t("properties.audioOffset")}</span>
        <NumberField
          className="properties-input mono"
          step={0.1}
          min={0}
          value={track.audio_offset}
          onChange={(audio_offset) => onUpdate({ audio_offset })}
        />
      </div>

      <div className="properties-section">
        <span className="properties-label">{t("properties.fadeIn")}</span>
        <NumberField
          className="properties-input mono"
          step={0.1}
          min={0}
          value={track.fade_in}
          onChange={(fade_in) => onUpdate({ fade_in })}
        />
      </div>

      <div className="properties-section">
        <span className="properties-label">{t("properties.fadeOut")}</span>
        <NumberField
          className="properties-input mono"
          step={0.1}
          min={0}
          value={track.fade_out}
          onChange={(fade_out) => onUpdate({ fade_out })}
        />
      </div>

      <div className="properties-section">
        <span className="properties-label">{t("properties.fadeCurve")}</span>
        <select
          className="properties-input"
          value={track.fade_curve}
          onChange={(e) => onUpdate({ fade_curve: e.target.value as FadeCurve })}
        >
          {FADE_CURVES.map(({ value, labelKey }) => (
            <option key={value} value={value}>
              {t(labelKey)}
            </option>
          ))}
        </select>
      </div>

      <div className="properties-section">
        <span className="properties-label">{t("properties.audioSpeed")}</span>
        <NumberField
          className="properties-input mono"
          step={0.05}
          min={AUDIO_SPEED_MIN}
          max={AUDIO_SPEED_MAX}
          value={track.speed}
          onChange={(speed) => onUpdate({ speed })}
        />
      </div>

      <div className="properties-section">
        <span className="properties-label">{t("properties.filter")}</span>
        <select
          className="properties-input"
          value={track.filter?.kind ?? "none"}
          onChange={(e) =>
            onUpdate({
              filter: e.target.value === "none" ? null : defaultAudioFilter(e.target.value as AudioFilterKind),
            })
          }
        >
          <option value="none">{t("properties.filterNone")}</option>
          {FILTER_KINDS.map(({ value, labelKey }) => (
            <option key={value} value={value}>
              {t(labelKey)}
            </option>
          ))}
        </select>
      </div>

      {track.filter && <FilterFields filter={track.filter} onChange={(filter) => onUpdate({ filter })} />}
    </>
  );
}

function FilterFields({ filter, onChange }: { filter: AudioFilter; onChange: (filter: AudioFilter) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="properties-section">
        <span className="properties-label">{t("properties.filterFrequency")}</span>
        <NumberField
          className="properties-input mono"
          step={10}
          min={20}
          max={20000}
          decimals={0}
          value={filter.frequency}
          onChange={(frequency) => onChange({ ...filter, frequency })}
        />
      </div>
      {filter.kind === "band-pass" ? (
        <div className="properties-section">
          <span className="properties-label">{t("properties.filterQ")}</span>
          <NumberField
            className="properties-input mono"
            step={0.1}
            min={0.1}
            max={20}
            value={filter.q}
            onChange={(q) => onChange({ ...filter, q })}
          />
        </div>
      ) : (
        <div className="properties-section">
          <span className="properties-label">{t("properties.filterSlope")}</span>
          <select
            className="properties-input"
            value={filter.slope}
            onChange={(e) => onChange({ ...filter, slope: Number(e.target.value) })}
          >
            {FILTER_SLOPES.map((slope) => (
              <option key={slope} value={slope}>
                {t("properties.filterSlopeValue", { slope })}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

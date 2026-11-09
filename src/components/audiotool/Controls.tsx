import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NumberField } from "../editor/properties/NumberField";
import { SLOPES, type FilterType } from "../../lib/audiotool/helpers";
import { SPEEDS, type AudioSettings } from "../../lib/audiotool/settings";

interface Props {
  settings: AudioSettings;
  sampleRate: number;
  /** Le champ que l'export refuserait, signalé en rouge. */
  invalidField: string | null;
  /** Change un réglage ; `commit` fait de ce changement un pas d'annulation. */
  onChange: (patch: Partial<AudioSettings>, commit: boolean) => void;
  /** Un geste (glissé de curseur, saisie) est fini : le réglage courant devient un pas. */
  onCommit: () => void;
}

const FILTERS: { value: FilterType; key: string }[] = [
  { value: "", key: "audioTool.filter.none" },
  { value: "lowpass", key: "audioTool.filter.lowpass" },
  { value: "highpass", key: "audioTool.filter.highpass" },
  { value: "bandpass", key: "audioTool.filter.bandpass" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="at-section">
      <h3 className="at-section-title">{title}</h3>
      <div className="at-section-body">{children}</div>
    </section>
  );
}

/** Les réglages d'un fichier audio : fondus, volume, vitesse, filtre. */
export default function Controls({ settings, sampleRate, invalidField, onChange, onCommit }: Props) {
  const { t } = useTranslation();
  const invalid = (field: string) => (invalidField === field ? true : undefined);
  const band = settings.filterType === "bandpass";
  const nyquist = Math.max(2, Math.floor(sampleRate / 2) - 1);
  const gestureEnd = { onPointerUp: onCommit, onKeyUp: onCommit, onBlur: onCommit };

  return (
    <aside className="at-side">
      <Section title={t("audioTool.fade.title")}>
        <div className="at-row">
          <label htmlFor="at-fadein">{t("audioTool.fade.in")}</label>
          <input
            id="at-fadein"
            className="at-range"
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={settings.fadeIn}
            aria-invalid={invalid("fadein")}
            onChange={(e) => onChange({ fadeIn: Number(e.target.value) }, false)}
            {...gestureEnd}
          />
          <span className="at-val">{settings.fadeIn.toFixed(1)}s</span>
        </div>
        <div className="at-row">
          <label htmlFor="at-fadeout">{t("audioTool.fade.out")}</label>
          <input
            id="at-fadeout"
            className="at-range"
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={settings.fadeOut}
            aria-invalid={invalid("fadeout")}
            onChange={(e) => onChange({ fadeOut: Number(e.target.value) }, false)}
            {...gestureEnd}
          />
          <span className="at-val">{settings.fadeOut.toFixed(1)}s</span>
        </div>
        <div>
          <span className="at-row-label">{t("audioTool.fade.curve")}</span>
          <div className="at-choices" role="group" aria-label={t("audioTool.fade.curve")} style={{ marginTop: 6 }}>
            {(["linear", "equal-power"] as const).map((curve) => (
              <button
                type="button"
                key={curve}
                className={`at-choice${settings.fadeCurve === curve ? " active" : ""}`}
                aria-pressed={settings.fadeCurve === curve}
                onClick={() => onChange({ fadeCurve: curve }, true)}
              >
                {t(curve === "linear" ? "audioTool.fade.linear" : "audioTool.fade.equalPower")}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title={t("audioTool.volume.title")}>
        <label className="at-check">
          <input
            type="checkbox"
            checked={settings.normalize}
            onChange={(e) => onChange({ normalize: e.target.checked }, true)}
          />
          <span>{t("audioTool.volume.normalize")}</span>
        </label>
      </Section>

      <Section title={t("audioTool.speed.title")}>
        <div className="at-speed-display">{SPEEDS[settings.speedStep]}x</div>
        <input
          className="at-range"
          type="range"
          min={0}
          max={SPEEDS.length - 1}
          step={1}
          value={settings.speedStep}
          aria-label={t("audioTool.speed.title")}
          onChange={(e) => onChange({ speedStep: Number(e.target.value) }, false)}
          {...gestureEnd}
        />
        <div className="at-speed-labels">
          <span>0.25x</span>
          <span>4x</span>
        </div>
        <div className="at-presets">
          {SPEEDS.map((speed, step) => (
            <button
              type="button"
              key={speed}
              className={`at-choice${settings.speedStep === step ? " active" : ""}`}
              aria-pressed={settings.speedStep === step}
              onClick={() => onChange({ speedStep: step }, true)}
            >
              {speed}x
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("audioTool.filter.title")}>
        <div className="at-choices" role="group" aria-label={t("audioTool.filter.title")}>
          {FILTERS.map(({ value, key }) => (
            <button
              type="button"
              key={value || "none"}
              className={`at-choice${settings.filterType === value ? " active" : ""}`}
              aria-pressed={settings.filterType === value}
              onClick={() => onChange({ filterType: value }, true)}
            >
              {t(key)}
            </button>
          ))}
        </div>
        {settings.filterType !== "" && (
          <>
            <div className="at-row">
              <label htmlFor="at-filter-freq">{t(band ? "audioTool.filter.centre" : "audioTool.filter.cutoff")}</label>
              <div className="at-unit" aria-invalid={invalid("filter-freq")}>
                <NumberField
                  id="at-filter-freq"
                  min={1}
                  max={nyquist}
                  step={100}
                  decimals={0}
                  value={settings.filterFreq}
                  onChange={(filterFreq) => onChange({ filterFreq }, false)}
                  onBlur={onCommit}
                />
                <span>Hz</span>
              </div>
            </div>
            {band ? (
              <div className="at-row">
                <label htmlFor="at-filter-bw">{t("audioTool.filter.bandwidth")}</label>
                <div className="at-unit" aria-invalid={invalid("filter-bw")}>
                  <NumberField
                    id="at-filter-bw"
                    min={1}
                    max={nyquist}
                    step={50}
                    decimals={0}
                    value={settings.filterBandwidth}
                    onChange={(filterBandwidth) => onChange({ filterBandwidth }, false)}
                    onBlur={onCommit}
                  />
                  <span>Hz</span>
                </div>
              </div>
            ) : (
              <>
                <div className="at-row">
                  <label htmlFor="at-filter-slope">{t("audioTool.filter.slope")}</label>
                  <select
                    id="at-filter-slope"
                    className="at-select"
                    value={settings.filterSlope}
                    aria-invalid={invalid("filter-slope")}
                    onChange={(e) => onChange({ filterSlope: Number(e.target.value) }, true)}
                  >
                    {SLOPES.map((slope) => (
                      <option key={slope} value={slope}>
                        {slope} dB/oct
                      </option>
                    ))}
                  </select>
                </div>
                <div className="at-row">
                  <label htmlFor="at-filter-q">{t("audioTool.filter.q")}</label>
                  <div className="at-unit" aria-invalid={invalid("filter-q")}>
                    <NumberField
                      id="at-filter-q"
                      min={0.1}
                      max={20}
                      step={0.05}
                      decimals={3}
                      disabled={settings.filterSlope !== 12}
                      value={settings.filterQ}
                      onChange={(filterQ) => onChange({ filterQ }, false)}
                      onBlur={onCommit}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </Section>

      <Section title={t("audioTool.cut.title")}>
        <p className="at-hint">{t("audioTool.cut.sideHint")}</p>
        {settings.cuts.length > 0 && (
          <div className="at-count">{t("audioTool.cut.count", { count: settings.cuts.length })}</div>
        )}
      </Section>
    </aside>
  );
}

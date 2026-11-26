import { useTranslation } from "react-i18next";
import type { ChromaKey } from "../../../bindings/ChromaKey";
import { DEFAULT_CHROMA_KEY } from "../../../lib/chroma";

const SLIDERS = [
  { field: "similarity", label: "properties.chromaSimilarity", min: 0.02, max: 0.6 },
  { field: "blend", label: "properties.chromaBlend", min: 0, max: 0.4 },
] as const;

/** Le fond vert d'une vidéo : activation, couleur, tolérance, bord et reflets. */
export function ChromaKeyFields({
  value,
  onChange,
}: {
  value: ChromaKey | null;
  onChange: (value: ChromaKey | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="properties-section">
      <div className="properties-row properties-row-header">
        <span className="properties-label">{t("properties.chromaKey")}</span>
        <button
          type="button"
          className={`properties-toggle${value ? " active" : ""}`}
          aria-label={t("properties.chromaKey")}
          aria-pressed={!!value}
          onClick={() => onChange(value ? null : DEFAULT_CHROMA_KEY)}
        >
          {value ? t("properties.backgroundColorOn") : t("properties.backgroundColorOff")}
        </button>
      </div>
      {value && (
        <>
          <input
            type="color"
            aria-label={t("properties.chromaColor")}
            title={t("properties.chromaColor")}
            value={value.color}
            onChange={(e) => onChange({ ...value, color: e.target.value })}
          />
          {SLIDERS.map(({ field, label, min, max }) => (
            <label key={field} className="properties-label">
              {t(label)}
              <input
                type="range"
                min={min}
                max={max}
                step={0.01}
                value={value[field]}
                onChange={(e) => onChange({ ...value, [field]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="properties-label">
            <input
              type="checkbox"
              checked={value.despill}
              onChange={(e) => onChange({ ...value, despill: e.target.checked })}
            />{" "}
            {t("properties.chromaDespill")}
          </label>
        </>
      )}
    </div>
  );
}

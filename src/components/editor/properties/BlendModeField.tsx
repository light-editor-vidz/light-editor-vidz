import { BLEND_MODES, BLEND_MODE_LABEL_KEYS } from "./options";
import { useTranslation } from "react-i18next";
import type { BlendMode } from "../../../bindings/BlendMode";

export function BlendModeField({
  value,
  onChange,
}: {
  value: BlendMode | null;
  onChange: (v: BlendMode | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="properties-section">
      <span className="properties-label">{t("properties.blendMode")}</span>
      <select
        className="properties-input"
        value={value ?? "normal"}
        onChange={(e) => onChange(e.target.value === "normal" ? null : (e.target.value as BlendMode))}
      >
        {BLEND_MODES.map((m) => (
          <option key={m} value={m}>
            {t(BLEND_MODE_LABEL_KEYS[m])}
          </option>
        ))}
      </select>
    </div>
  );
}

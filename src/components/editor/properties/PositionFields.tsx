import { useTranslation } from "react-i18next";
import type { Element } from "../../../bindings/Element";
import type { ElementPatch } from "../../../lib/elements";
import { NumberField } from "./NumberField";

export function PositionFields({ element, onUpdate }: { element: Element; onUpdate: (patch: ElementPatch) => void }) {
  const { t } = useTranslation();
  return (
    <div className="properties-section">
      <span className="properties-label">{t("properties.position")}</span>
      <div className="properties-grid-2">
        <label className="properties-mini-field">
          X
          <NumberField className="properties-input mono" value={element.x} onChange={(v) => onUpdate({ x: v })} />
        </label>
        <label className="properties-mini-field">
          Y
          <NumberField className="properties-input mono" value={element.y} onChange={(v) => onUpdate({ y: v })} />
        </label>
        <label className="properties-mini-field">
          W
          <NumberField
            className="properties-input mono"
            value={element.width}
            min={1}
            onChange={(v) => onUpdate({ width: v })}
          />
        </label>
        <label className="properties-mini-field">
          H
          <NumberField
            className="properties-input mono"
            value={element.height}
            min={1}
            onChange={(v) => onUpdate({ height: v })}
          />
        </label>
        <label className="properties-mini-field">
          {t("properties.rotation")}
          <NumberField
            className="properties-input mono"
            value={element.rotation}
            onChange={(v) => onUpdate({ rotation: v })}
          />
        </label>
      </div>
    </div>
  );
}

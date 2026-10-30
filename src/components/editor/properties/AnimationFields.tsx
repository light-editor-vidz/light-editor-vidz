import { ANIMATION_OPTIONS, TEXT_ONLY_ANIMATION_OPTIONS, EASING_OPTIONS, DEFAULT_ANIMATION } from "./options";
import { useTranslation } from "react-i18next";
import { NumberField } from "./NumberField";
import { Plus, X } from "lucide-react";
import type { Element } from "../../../bindings/Element";
import type { AnimationType } from "../../../bindings/AnimationType";
import type { Animation } from "../../../bindings/Animation";
import type { Easing } from "../../../bindings/Easing";
import type { ElementPatch } from "../../../lib/elements";

export function AnimationFields({ element, onUpdate }: { element: Element; onUpdate: (patch: ElementPatch) => void }) {
  const { t } = useTranslation();
  const options = element.type === "text" ? [...ANIMATION_OPTIONS, ...TEXT_ONLY_ANIMATION_OPTIONS] : ANIMATION_OPTIONS;

  function addAnimation() {
    onUpdate({ animations: [...element.animations, { ...DEFAULT_ANIMATION }] });
  }

  function updateAnimation(index: number, patch: Partial<Animation>) {
    onUpdate({ animations: element.animations.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  }

  function removeAnimation(index: number) {
    onUpdate({ animations: element.animations.filter((_, i) => i !== index) });
  }

  return (
    <div className="properties-section">
      <div className="properties-row properties-row-header">
        <span className="properties-label">{t("properties.animation")}</span>
        <button type="button" className="properties-toggle" onClick={addAnimation} title={t("properties.animAdd")}>
          <Plus size={12} />
        </button>
      </div>
      {element.animations.map((anim, i) => (
        <div key={i} className="animation-entry">
          <div className="properties-row">
            <select
              className="properties-input"
              value={anim.animation_type}
              onChange={(e) => updateAnimation(i, { animation_type: e.target.value as AnimationType })}
            >
              {element.type === "text" ? (
                <>
                  <optgroup label={t("properties.animGroupInOut")}>
                    {ANIMATION_OPTIONS.map((opt) => (
                      <option key={opt.type} value={opt.type}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t("properties.animGroupReveal")}>
                    {TEXT_ONLY_ANIMATION_OPTIONS.map((opt) => (
                      <option key={opt.type} value={opt.type}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </optgroup>
                </>
              ) : (
                options.map((opt) => (
                  <option key={opt.type} value={opt.type}>
                    {t(opt.labelKey)}
                  </option>
                ))
              )}
            </select>
            <button
              type="button"
              className="properties-toggle"
              onClick={() => removeAnimation(i)}
              title={t("properties.animRemove")}
            >
              <X size={12} />
            </button>
          </div>
          <div className="properties-row">
            <button
              type="button"
              className={`properties-toggle${anim.direction === "in" ? " active" : ""}`}
              onClick={() => updateAnimation(i, { direction: "in" })}
            >
              {t("properties.animIn")}
            </button>
            <button
              type="button"
              className={`properties-toggle${anim.direction === "out" ? " active" : ""}`}
              onClick={() => updateAnimation(i, { direction: "out" })}
            >
              {t("properties.animOut")}
            </button>
            <button
              type="button"
              className={`properties-toggle${anim.with_fade ? " active" : ""}`}
              onClick={() => updateAnimation(i, { with_fade: !anim.with_fade })}
              title={t("properties.animFadeToggle")}
            >
              {t("properties.animFadeShort")}
            </button>
          </div>
          <div className="properties-row">
            <NumberField
              className="properties-input mono"
              step={0.1}
              min={0.1}
              value={anim.duration}
              onChange={(duration) => updateAnimation(i, { duration })}
            />
            <select
              className="properties-input"
              value={anim.easing}
              onChange={(e) => updateAnimation(i, { easing: e.target.value as Easing })}
            >
              {EASING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </div>
  );
}

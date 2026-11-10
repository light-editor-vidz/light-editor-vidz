import { useTranslation } from "react-i18next";
import type { Element } from "../../../bindings/Element";
import type { VideoCrop } from "../../../bindings/VideoCrop";
import type { ElementPatch } from "../../../lib/elements";
import { COLOR_FILTERS, FULL_CROP, clampCrop, isFullCrop } from "../../../lib/videoFx";
import { NumberField } from "./NumberField";

const CROP_FIELDS: { key: keyof VideoCrop; labelKey: string }[] = [
  { key: "x", labelKey: "properties.videoCropX" },
  { key: "y", labelKey: "properties.videoCropY" },
  { key: "w", labelKey: "properties.videoCropW" },
  { key: "h", labelKey: "properties.videoCropH" },
];

/** Filtre de couleur et recadrage d'une vidéo (les mêmes que dans la vue Vidéo). */
export function VideoEffectsFields({
  element,
  onUpdate,
}: {
  element: Extract<Element, { type: "video" }>;
  onUpdate: (patch: ElementPatch) => void;
}) {
  const { t, i18n } = useTranslation();
  const french = i18n.resolvedLanguage === "fr";
  const crop = element.crop ?? FULL_CROP;

  function setCrop(patch: Partial<VideoCrop>) {
    const next = clampCrop({ ...crop, ...patch });
    onUpdate({ crop: isFullCrop(next) ? null : next });
  }

  return (
    <>
      <div className="properties-section">
        <span className="properties-label">{t("properties.videoFilter")}</span>
        <select
          className="properties-input"
          value={element.color_filter ?? "none"}
          onChange={(e) => onUpdate({ color_filter: e.target.value === "none" ? null : e.target.value })}
        >
          {COLOR_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {french ? f.nameFr : f.nameEn}
            </option>
          ))}
        </select>
      </div>

      <div className="properties-section">
        <div className="properties-row properties-row-header">
          <span className="properties-label">{t("properties.videoCrop")}</span>
          {element.crop && (
            <button type="button" className="properties-toggle" onClick={() => onUpdate({ crop: null })}>
              {t("properties.videoCropReset")}
            </button>
          )}
        </div>
        <div className="properties-row">
          {CROP_FIELDS.map(({ key, labelKey }) => (
            <label className="properties-mini-field" key={key}>
              {t(labelKey)}
              <NumberField
                className="properties-input mono"
                step={1}
                min={0}
                max={100}
                decimals={0}
                value={Math.round(crop[key] * 100)}
                onChange={(percent) => setCrop({ [key]: percent / 100 })}
              />
            </label>
          ))}
        </div>
      </div>
    </>
  );
}

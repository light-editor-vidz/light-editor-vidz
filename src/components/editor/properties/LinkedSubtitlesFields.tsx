import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LinkedCue } from "../../../bindings/LinkedCue";
import type { LinkedSubtitles } from "../../../bindings/LinkedSubtitles";
import CueEditor, { CueList } from "../../subtitles/CueEditor";
import { NumberField } from "./NumberField";

const POSITIONS = ["top", "middle", "bottom"];

/** Le sous-titre associé à une vidéo ou à un son : l'afficher ou non, son style, ses textes. */
export function LinkedSubtitlesFields({
  subtitles,
  onChange,
  onEditCues,
}: {
  subtitles: LinkedSubtitles;
  onChange: (subtitles: LinkedSubtitles) => void;
  /** Les textes corrigés : ils valent pour toutes les utilisations de ce média. */
  onEditCues: (cues: LinkedCue[]) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const cues = subtitles.cues.map((c, id) => ({ ...c, id }));
  return (
    <div className="properties-section">
      <span className="properties-label">{t("properties.subtitles")}</span>
      <label className="subs-check">
        <input
          type="checkbox"
          checked={subtitles.enabled}
          onChange={(e) => onChange({ ...subtitles, enabled: e.target.checked })}
        />
        {t("properties.subtitlesShow")}
      </label>
      <span className="properties-label">{t("properties.subtitlesPosition")}</span>
      <select
        className="properties-input"
        value={subtitles.position}
        onChange={(e) => onChange({ ...subtitles, position: e.target.value })}
      >
        {POSITIONS.map((p) => (
          <option key={p} value={p}>
            {t(`properties.subtitlesAt.${p}`)}
          </option>
        ))}
      </select>
      <span className="properties-label">{t("properties.subtitlesSize")}</span>
      <NumberField
        className="properties-input mono"
        step={0.1}
        min={0.5}
        max={20}
        value={subtitles.font_size}
        onChange={(font_size) => onChange({ ...subtitles, font_size })}
      />
      {editing ? (
        <CueEditor
          cues={cues}
          onCancel={() => setEditing(false)}
          onApply={(texts) => {
            onEditCues(subtitles.cues.map((c, i) => ({ ...c, text: texts[i] })).filter((c) => c.text.trim()));
            setEditing(false);
          }}
        />
      ) : (
        <>
          <CueList cues={cues} />
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            {t("properties.subtitlesEdit")}
          </button>
        </>
      )}
    </div>
  );
}

import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { cueTime } from "../../lib/subs/linked";

export interface EditableCue {
  id: number;
  start: number;
  end: number;
  text: string;
}

export { cueTime };

/** La liste des répliques, en lecture. */
export function CueList({ cues }: { cues: EditableCue[] }) {
  return (
    <ol className="subs-cue-list">
      {cues.map((cue, i) => (
        <li className="subs-cue" key={cue.id}>
          <span className="subs-cue-index">{i + 1}</span>
          <div className="subs-cue-body">
            <span className="subs-cue-time">
              {cueTime(cue.start)} → {cueTime(cue.end)}
            </span>
            <p className="subs-cue-text">{cue.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const CueEditRow = memo(function CueEditRow({
  index,
  cue,
  value,
  label,
  onChange,
}: {
  index: number;
  cue: EditableCue;
  value: string;
  label: string;
  onChange: (index: number, value: string) => void;
}) {
  return (
    <li className="subs-cue">
      <span className="subs-cue-index">{index + 1}</span>
      <div className="subs-cue-body">
        <span className="subs-cue-time">
          {cueTime(cue.start)} → {cueTime(cue.end)}
        </span>
        <textarea
          className="subs-cue-edit"
          rows={2}
          aria-label={label}
          value={value}
          onChange={(e) => onChange(index, e.currentTarget.value)}
        />
      </div>
    </li>
  );
});

/** Corrige le texte des répliques, sans toucher à leurs temps. Vider une réplique la retire, après
 * confirmation. */
export default function CueEditor({
  cues,
  onApply,
  onCancel,
}: {
  cues: EditableCue[];
  onApply: (texts: string[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [texts, setTexts] = useState(() => cues.map((c) => c.text));
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const changed = texts.some((text, i) => text !== cues[i].text);
  const emptied = texts.filter((text) => !text.trim()).length;
  // Une seule ligne se redessine à chaque frappe, pas toute la liste.
  const change = useCallback((index: number, value: string) => {
    setConfirmRemoval(false);
    setTexts((previous) => previous.map((old, j) => (j === index ? value : old)));
  }, []);
  return (
    <div className="subs-cue-editor">
      <ol className="subs-cue-list">
        {cues.map((cue, i) => (
          <CueEditRow
            key={cue.id}
            index={i}
            cue={cue}
            value={texts[i]}
            label={t("subs.edit.cue", { index: i + 1 })}
            onChange={change}
          />
        ))}
      </ol>
      {emptied > 0 && (
        <p className="modal-hint" role="alert">
          {t("subs.edit.emptyWarning", { count: emptied })}
        </p>
      )}
      <div className="subs-edit-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={!changed}
          onClick={() => {
            if (emptied > 0 && !confirmRemoval) setConfirmRemoval(true);
            else onApply(texts);
          }}
        >
          {confirmRemoval ? t("subs.edit.confirmRemove") : t("subs.edit.apply")}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t("subs.edit.discard")}
        </button>
      </div>
    </div>
  );
}

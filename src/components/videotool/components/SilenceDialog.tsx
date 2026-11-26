import { useState } from "react";
import { getApi } from "../api";
import { useVideoOwner } from "../owner";
import { useT } from "../i18n";
import { cutsFromSilences, type Range } from "../utils/silence";
import type { SubtitleCue } from "../utils/srt";
import "./SilenceDialog.css";

interface Props {
  videoPath: string;
  duration: number;
  /** Les sous-titres générés pour cette vidéo : ils protègent les mots et marquent les phrases. */
  cues: SubtitleCue[];
  onApply: (cuts: Range[]) => void;
  onClose: () => void;
}

type State = { kind: "idle" | "busy" | "no_audio" | "error" } | { kind: "done"; silences: Range[] };

export default function SilenceDialog({ videoPath, duration, cues, onApply, onClose }: Props) {
  const { t, lang } = useT();
  const owner = useVideoOwner();
  const [threshold, setThreshold] = useState(-35);
  const [minSilence, setMinSilence] = useState(0.6);
  const [margin, setMargin] = useState(0.15);
  const [sentencesOnly, setSentencesOnly] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });

  // The margin and the sentence option apply to what was found: no new analysis.
  const cuts = state.kind === "done" ? cutsFromSilences(state.silences, duration, { margin, sentencesOnly }, cues) : [];
  const removed = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);

  const analyse = async () => {
    setState({ kind: "busy" });
    try {
      const silences = await getApi(owner).detectSilences(videoPath, threshold, minSilence);
      setState(silences ? { kind: "done", silences } : { kind: "no_audio" });
    } catch (err) {
      console.error("Silence detection failed:", err);
      setState({ kind: "error" });
    }
  };

  const cancel = () => {
    if (state.kind === "busy") void getApi(owner).cancelFfmpeg();
    onClose();
  };

  const field = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    rerun: boolean,
  ) => (
    <label className="silence-field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={state.kind === "busy"}
        onChange={(e) => {
          onChange(Number(e.target.value));
          // Une analyse faite avec d'autres réglages ne vaut plus.
          if (rerun) setState({ kind: "idle" });
        }}
      />
      <output>{value}</output>
    </label>
  );

  return (
    <div className="silence-backdrop" onClick={cancel}>
      <div
        className="silence-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t.silences_title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{t.silences_title}</h2>
        <p className="silence-hint">{t.silences_hint}</p>
        {field(t.silences_threshold, threshold, -60, -15, 1, setThreshold, true)}
        {field(t.silences_min, minSilence, 0.2, 3, 0.1, setMinSilence, true)}
        {field(t.silences_margin, margin, 0, 1, 0.05, setMargin, false)}
        <label className="silence-check">
          <input
            type="checkbox"
            checked={sentencesOnly}
            disabled={cues.length === 0}
            onChange={(e) => setSentencesOnly(e.target.checked)}
          />
          {t.silences_sentences}
        </label>
        {cues.length === 0 && <p className="silence-hint">{t.silences_sentences_needs}</p>}

        <p className="silence-status" role="status">
          {state.kind === "busy" && t.silences_analysing}
          {state.kind === "no_audio" && t.silences_no_audio}
          {state.kind === "error" && t.silences_error}
          {state.kind === "done" &&
            (cuts.length > 0
              ? t.silences_found(cuts.length, removed.toLocaleString(lang, { maximumFractionDigits: 1 }))
              : t.silences_none)}
        </p>

        <div className="silence-actions">
          <button className="btn-ghost" onClick={cancel}>
            {t.silences_cancel}
          </button>
          <button className="btn-ghost" onClick={() => void analyse()} disabled={state.kind === "busy"}>
            {t.silences_analyse}
          </button>
          <button className="btn-primary" onClick={() => onApply(cuts)} disabled={cuts.length === 0}>
            {t.silences_apply}
          </button>
        </div>
      </div>
    </div>
  );
}

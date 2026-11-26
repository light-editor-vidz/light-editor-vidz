import { alwaysDenoises, parseVoice, VOICE_LEVELS, type VoiceCleanup, type VoiceLevel } from "../lib/voice";

export interface VoiceCleanupTexts {
  label: string;
  levels: Record<VoiceLevel, string>;
  denoise: string;
  gate: string;
  hint: string;
}

interface Props {
  value: VoiceCleanup;
  onChange: (value: VoiceCleanup) => void;
  /** Textes déjà traduits : la vue Vidéo a ses propres messages. */
  texts: VoiceCleanupTexts;
  disabled?: boolean;
  classes: { row: string; label: string; select: string; check: string };
}

/** Niveau de nettoyage, réduction du bruit et noise gate. */
export default function VoiceCleanupFields({ value, onChange, texts, disabled, classes }: Props) {
  const denoised = alwaysDenoises(value.level);
  return (
    <>
      <div className={classes.row}>
        <label className={classes.label} htmlFor="voice-level">
          {texts.label}
        </label>
        <select
          id="voice-level"
          className={classes.select}
          value={value.level}
          disabled={disabled}
          title={texts.hint}
          onChange={(e) => onChange(parseVoice({ ...value, level: e.target.value }))}
        >
          {VOICE_LEVELS.map((level) => (
            <option key={level} value={level}>
              {texts.levels[level]}
            </option>
          ))}
        </select>
      </div>
      <div className={classes.row}>
        <label className={classes.check}>
          <input
            type="checkbox"
            checked={denoised || value.denoise}
            disabled={disabled || denoised}
            onChange={(e) => onChange({ ...value, denoise: e.target.checked })}
          />
          <span>{texts.denoise}</span>
        </label>
        <label className={classes.check}>
          <input
            type="checkbox"
            checked={value.gate}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, gate: e.target.checked })}
          />
          <span>{texts.gate}</span>
        </label>
      </div>
    </>
  );
}

import { SAFE_ZONE_PLATFORMS, type SafeZonePlatform } from "../lib/platforms";

interface Props {
  value: SafeZonePlatform | null;
  onChange: (value: string) => void;
  /** Textes déjà traduits : la vue Vidéo a ses propres messages. */
  label: string;
  offLabel: string;
  hint: string;
  className?: string;
  disabled?: boolean;
}

export default function SafeZoneSelect({ value, onChange, label, offLabel, hint, className, disabled }: Props) {
  return (
    <select
      className={className}
      value={value ?? ""}
      aria-label={label}
      title={hint}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{offLabel}</option>
      {SAFE_ZONE_PLATFORMS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}
        </option>
      ))}
    </select>
  );
}

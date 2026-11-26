import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeCheck, inspectDelivery } from "../lib/deliveryCheck";
import { LIMITS_AS_OF, PLATFORMS, platformOf, type CheckItem, type PlatformId } from "../lib/platforms";
import "./DeliveryCheck.css";

/** Le choix d'une destination : le parent applique les réglages du préréglage. */
export function DestinationSelect({
  value,
  onChange,
  className,
  disabled,
}: {
  value: PlatformId | null;
  onChange: (id: string) => void;
  className?: string;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <select
      className={className}
      aria-label={t("delivery.destination")}
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{t("delivery.none")}</option>
      {PLATFORMS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}
        </option>
      ))}
    </select>
  );
}

export function CheckList({ platform, items }: { platform: PlatformId; items: CheckItem[] }) {
  const { t } = useTranslation();
  const title = platformOf(platform)?.title ?? platform;
  const warnings = items.filter((i) => !i.ok).length;
  return (
    <div className="delivery-check" role="status">
      <strong>
        {warnings === 0
          ? t("delivery.allGood", { platform: title })
          : t("delivery.warnings", { platform: title, count: warnings })}
      </strong>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={item.ok ? "ok" : "warn"}>
            <span aria-hidden="true">{item.ok ? "✓" : "⚠"}</span> {describeCheck(item, t)}
          </li>
        ))}
      </ul>
      <small>{t("delivery.indicative", { date: LIMITS_AS_OF })}</small>
    </div>
  );
}

/** Relit le fichier exporté et le compare aux attentes de la destination. */
export default function DeliveryCheck({ platform, path }: { platform: PlatformId; path: string }) {
  const { t } = useTranslation();
  const key = `${platform}\n${path}`;
  const [result, setResult] = useState<{ key: string; items: CheckItem[] | null }>({ key: "", items: null });
  useEffect(() => {
    const spec = platformOf(platform);
    if (!spec) return;
    let stale = false;
    inspectDelivery(path, spec)
      .then((items) => !stale && setResult({ key, items }))
      .catch(() => !stale && setResult({ key, items: null }));
    return () => {
      stale = true;
    };
  }, [platform, path, key]);

  if (result.key !== key) return <div className="delivery-check">{t("delivery.checking")}</div>;
  if (!result.items) return <div className="delivery-check">{t("delivery.failed")}</div>;
  return <CheckList platform={platform} items={result.items} />;
}

import type { RecentEntry } from "../api";
import { useT } from "../i18n";
import "./RecentList.css";

interface Props {
  items: RecentEntry[];
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
  onClear: () => void;
}

/** Videos opened lately, on the home screen. */
export default function RecentList({ items, onOpen, onRemove, onClear }: Props) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <section className="recent" aria-label={t.recent_title}>
      <div className="recent-head">
        <h3>{t.recent_title}</h3>
        <button className="recent-clear" onClick={onClear}>
          {t.recent_clear}
        </button>
      </div>
      <ul>
        {items.slice(0, 5).map((item) => (
          <li key={item.path} className="recent-item">
            <button className="recent-open" onClick={() => onOpen(item.path)} title={item.path}>
              <span className="recent-kind">{item.name.split(".").pop()?.toUpperCase()}</span>
              <span className="recent-name">{item.name}</span>
              <span className="recent-dir">{item.dir}</span>
            </button>
            <button
              className="recent-remove"
              onClick={() => onRemove(item.path)}
              aria-label={t.recent_remove}
              title={t.recent_remove}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

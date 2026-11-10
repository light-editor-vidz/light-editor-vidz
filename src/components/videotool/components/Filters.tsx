import { VIDEO_FILTERS } from "../utils/filters";
import { useT } from "../i18n";
import "./Filters.css";

interface Props {
  activeFilterId: string;
  onSelect: (filterId: string) => void;
  frameDataUrl?: string;
}

export default function Filters({ activeFilterId, onSelect, frameDataUrl }: Props) {
  const { lang } = useT();

  return (
    <div className="filters-panel">
      <div className="filters-grid">
        {VIDEO_FILTERS.map((f) => {
          const isTransform = f.id === "mirror" || f.id === "upside_down";
          const previewStyle = {
            filter: isTransform ? "none" : f.css,
            transform: f.id === "mirror" ? "scaleX(-1)" : f.id === "upside_down" ? "scaleY(-1)" : "none",
          };
          return (
            <button
              key={f.id}
              className={`filter-card ${activeFilterId === f.id ? "active" : ""}`}
              onClick={() => onSelect(f.id)}
            >
              <div className="filter-preview-box">
                {frameDataUrl ? (
                  <img className="filter-preview-img" src={frameDataUrl} alt="" style={previewStyle} />
                ) : (
                  <div className="filter-preview-inner" style={previewStyle}>
                    <div className="preview-placeholder">Abc</div>
                  </div>
                )}
              </div>
              <span className="filter-name">{lang === "fr" ? f.nameFr : f.nameEn}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

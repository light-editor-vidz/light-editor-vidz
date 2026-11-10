import { useT } from "../i18n";
import { RotateIcon } from "./icons";
import "./GeometrySettings.css";

interface Props {
  rotation: number;
  straighten: number;
  perspectiveH: number;
  perspectiveV: number;
  onRotationChange: (rotation: number) => void;
  onStraightenChange: (val: number) => void;
  onPerspectiveHChange: (val: number) => void;
  onPerspectiveVChange: (val: number) => void;
  onCommit: () => void;
  onReset: () => void;
}

export default function GeometrySettings({
  rotation,
  straighten,
  perspectiveH,
  perspectiveV,
  onRotationChange,
  onStraightenChange,
  onPerspectiveHChange,
  onPerspectiveVChange,
  onCommit,
  onReset,
}: Props) {
  const { t } = useT();

  // Closes the gesture so a whole slider scrub is a single undo step.
  const commitProps = { onPointerUp: onCommit, onPointerCancel: onCommit, onKeyUp: onCommit, onBlur: onCommit };

  const handleRotate = () => {
    onRotationChange((rotation + 90) % 360);
  };

  return (
    <div className="geometry-panel">
      <div className="geometry-controls">
        <div className="geometry-row">
          <label>{t.geometry_rotate}</label>
          <div className="rotate-control">
            <button className="btn-secondary btn-icon" onClick={handleRotate} title={t.geometry_rotate}>
              <RotateIcon />
            </button>
            <span className="geometry-value">{rotation}°</span>
          </div>
        </div>

        <div className="geometry-row">
          <label>{t.geometry_straighten}</label>
          <input
            type="range"
            min="-45"
            max="45"
            value={straighten}
            onChange={(e) => onStraightenChange(Number(e.target.value))}
            {...commitProps}
            className="geometry-slider"
          />
          <span className="geometry-value">{straighten}°</span>
        </div>

        <div className="geometry-row">
          <label>{t.geometry_perspective_h}</label>
          <input
            type="range"
            min="-45"
            max="45"
            value={perspectiveH}
            onChange={(e) => onPerspectiveHChange(Number(e.target.value))}
            {...commitProps}
            className="geometry-slider"
          />
          <span className="geometry-value">{perspectiveH}°</span>
        </div>

        <div className="geometry-row">
          <label>{t.geometry_perspective_v}</label>
          <input
            type="range"
            min="-45"
            max="45"
            value={perspectiveV}
            onChange={(e) => onPerspectiveVChange(Number(e.target.value))}
            {...commitProps}
            className="geometry-slider"
          />
          <span className="geometry-value">{perspectiveV}°</span>
        </div>

        <button className="btn-ghost geometry-reset" onClick={onReset}>
          {t.geometry_reset}
        </button>
      </div>
    </div>
  );
}

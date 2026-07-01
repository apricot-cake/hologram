import { Highlight } from './Highlight.jsx';

// One label↔control row (the Settings → 外観 layout). Reused so every labelled
// setting renders the same way. Reuses the `.setting-row` style from index.html.
export function SettingRow({ label, children, style }) {
  return (
    <div className="setting-row" style={style}>
      <span>
        <Highlight text={label} />
      </span>
      {children}
    </div>
  );
}

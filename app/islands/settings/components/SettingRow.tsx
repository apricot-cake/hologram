import type { CSSProperties, ReactNode } from 'react';
import { Highlight } from './Highlight.tsx';

// One label↔control row (the Settings → 外観 layout). Reused so every labelled
// setting renders the same way. Reuses the `.setting-row` style from index.html.
export function SettingRow({ label, children, style }: { label: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="setting-row" style={style}>
      <span>
        <Highlight text={label} />
      </span>
      {children}
    </div>
  );
}

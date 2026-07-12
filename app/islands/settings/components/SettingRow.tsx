import type { CSSProperties, ReactNode } from 'react';
import { Highlight } from './Highlight.tsx';

// One label↔control row: label (+ optional hint) on the left, control on the
// right — the shadcn settings-form layout. Reused so every labelled setting
// renders the same way.
export function SettingRow({ label, hint, children, style }: { label: string; hint?: string | null; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3" style={style}>
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm leading-none font-medium">
          <Highlight text={label} />
        </div>
        {hint ? (
          <div className="text-muted-foreground text-[0.8rem] leading-snug">
            <Highlight text={hint} />
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

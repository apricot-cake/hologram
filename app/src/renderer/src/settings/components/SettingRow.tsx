import type { CSSProperties, ReactNode } from 'react';
import { Highlight } from './Highlight.tsx';

// ラベルと操作部品を1組にした行: 左にラベル（と、あれば補足）、右に操作部品＝shadcn の
// 設定フォームのレイアウト。使い回すことで、ラベルの付いた設定はどれも同じ描かれ方になる。
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

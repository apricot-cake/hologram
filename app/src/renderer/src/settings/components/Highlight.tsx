import { useContext } from 'react';
import type { ReactNode } from 'react';
import { SearchContext } from '../search-context.ts';

// React-native replacement for the old DOM tree-walk highlighter: wraps every
// occurrence of the active query in a highlighted <mark>. Use for user-visible
// label text only (not <select>/<option>), mirroring the original which skipped
// form controls.
export function Highlight({ text }: { text?: string | number | null }) {
  const q = useContext(SearchContext);
  const s = text == null ? '' : String(text);
  if (!q) return s;
  const low = s.toLowerCase();
  if (!low.includes(q)) return s;

  const out: ReactNode[] = [];
  let i = 0;
  let idx: number;
  while ((idx = low.indexOf(q, i)) !== -1) {
    if (idx > i) out.push(s.slice(i, idx));
    out.push(
      <mark className="bg-selected/20 text-foreground rounded-xs px-0.5" key={idx}>
        {s.slice(idx, idx + q.length)}
      </mark>,
    );
    i = idx + q.length;
  }
  if (i < s.length) out.push(s.slice(i));
  return <>{out}</>;
}

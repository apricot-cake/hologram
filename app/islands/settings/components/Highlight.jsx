import { useContext } from 'react';
import { SearchContext } from '../search-context.js';

// React-native replacement for the old DOM tree-walk highlighter: wraps every
// occurrence of the active query in <mark class="set-hl">. Use for user-visible
// label text only (not <select>/<option>), mirroring the original which skipped
// form controls. The .set-hl style is reused from index.html.
export function Highlight({ text }) {
  const q = useContext(SearchContext);
  const s = text == null ? '' : String(text);
  if (!q) return s;
  const low = s.toLowerCase();
  if (!low.includes(q)) return s;

  const out = [];
  let i = 0;
  let idx;
  while ((idx = low.indexOf(q, i)) !== -1) {
    if (idx > i) out.push(s.slice(i, idx));
    out.push(<mark className="set-hl" key={idx}>{s.slice(idx, idx + q.length)}</mark>);
    i = idx + q.length;
  }
  if (i < s.length) out.push(s.slice(i));
  return <>{out}</>;
}

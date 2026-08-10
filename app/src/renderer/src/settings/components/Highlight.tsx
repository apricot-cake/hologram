import { useContext } from 'react';
import type { ReactNode } from 'react';
import { SearchContext } from '../search-context.ts';

// 以前の DOM を歩き回る強調表示を、React 本来の書き方で置き換えたもの: いま効いている
// クエリの出現をすべて、強調した <mark> で包む。使うのは利用者に見えるラベルの文言だけ
// （<select>/<option> には使わない）＝フォームの部品を飛ばしていた元の実装に倣う。
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

import type { ReactNode, Ref } from 'react';
import { Highlight } from './Highlight.tsx';

// 設定の節1つ分: 揃った見出しと本体。見出しをここに集めることが試行の要点＝節ごとに
// タイトルの描き方がずれていかない。`innerRef` は包みの要素を外へ出す＝ページをまたぐ
// 検索のために、親がその textContent を読めるようにするため。`hidden` はページの見え方を
// 切り替える。
export function Section({ title, hidden, innerRef, children }: { title: string; hidden?: boolean; innerRef?: Ref<HTMLDivElement>; children?: ReactNode }) {
  return (
    <div className="mb-10 last:mb-0" hidden={hidden} ref={innerRef}>
      <h2 className="mb-1 text-lg font-semibold tracking-tight">
        <Highlight text={title} />
      </h2>
      <div className="pt-3">{children}</div>
    </div>
  );
}

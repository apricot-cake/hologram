// 飛ぶためのレールの登録簿（#47）＝年月のレールが、セクション分けされたグリッドから受け取る
// しかなく、モデルからは導けない唯一のもの＝ある月の見出しが今どこにあるか（masonic の
// positioner は SectionedGridHost のローカルなフックの結果）。grid-nav.ts と同じ形で、ホストが
// 載る時に読み取り専用のハンドルを登録し、外れる時に消す。セクション分けされたグリッドが
// 載っていなければ（他の並び順や、別の閲覧モード）、呼び出し側（レールのコンポーネント）は
// 安全に何もしない結果を得る。
//
// grid-nav.ts に畳まず、意図して分けてある。矢印キーでの移動は、全体の項目の添字で選択を
// 動かすが、レールはセクションのキーでスクロール位置を動かす＝呼び出し側も単位も違うし、
// grid-nav.ts の取り決めはキーボードでの選択の領分だけを扱う。

export interface SectionNavHandle {
  /** このセクションの見出しがビューポートの上端に来るまでスクロールする。知らないキーには何もしない。 */
  scrollToTop(key: string): void;
}

let handle: SectionNavHandle | null = null;

export function registerSectionNav(h: SectionNavHandle): () => void {
  handle = h;
  return () => {
    if (handle === h) handle = null;
  };
}

export function scrollSectionToTop(key: string): void {
  handle?.scrollToTop(key);
}

/** 今セクション分けされたグリッドが載っているか＝載っていなければ、レールは自分を隠す。 */
export function hasSectionNav(): boolean {
  return handle !== null;
}

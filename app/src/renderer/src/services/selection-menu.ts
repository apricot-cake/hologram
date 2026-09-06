import { hologramIpc } from './ipc.ts';
import { open as menuOpen } from './menu.ts';

// メニューの行のグリフ。カードのメニューが描くのと同じ 24×24 の線画寸法に揃える。
const SEL_IC = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  web: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/></svg>',
  library: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
};

// `sel*` にしてあるのは、どのメニューへ差し込んでも、そのメニューが既に持っている act と
// 衝突しないようにするため。
const ACTS = ['selCopy', 'selWeb', 'selLibrary'];

// ウェブ検索の URL を組む唯一の場所。Google に固定するのは判断による（#167）＝切り替え
// られる検索エンジンにはまだ需要が無く、需要が出た時にはこの関数が継ぎ目のすべてになる。
//
// 切り詰めているのは、URL には実際の長さの制限があり（Chromium は約2MB、Windows のシェルは
// ずっと短い）、選択には制限が無いから＝投稿を丸ごとクエリ文字列に貼ると、検索としてではなく
// URL として失敗する。
export function webSearchUrl(text: string): string {
  return 'https://www.google.com/search?q=' + encodeURIComponent(text.slice(0, 1000));
}

// 選択は文書ではなく検索の語だ。元の版面から来る改行や連続した空白は、ウェブのクエリでも
// ライブラリのクエリでもただの雑音。
export function searchTermOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// 右クリックが選択の上に落ちたなら選択テキストを、そうでなければ '' を返す。
//
// Chromium は選択から離れた場所を右クリックすると選択を畳むので、選択を鍵にするメニューも
// 同じことを尋ねなければならない。この判定が無いと、インスペクタで選択したままのテキストが、
// 利用者がアプリの別の場所を右クリックしている間ずっと「コピー」を出し続ける。
//
// containsNode ではなく intersectsNode を使う。右クリックは、選択テキストを収めている要素の
// 上に落ちる。そのテキストにかかる範囲は、その要素を含みもしなければ、部分的に含みもしない
// （要素は範囲の両端の、それ自身を含む祖先であり、それはまさにどちらの述語も除外する場合）＝
// そこでは containsNode(el, true) が false になり、この機能は本筋の経路で死んでいた。
// intersectsNode が尋ねるのは、本当に効く問い＝このノードは範囲と少しでも重なっているか。
export function selectionTextAt(target: EventTarget | null): string {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
  const text = searchTermOf(sel.toString());
  if (!text) return '';
  if (target instanceof Node && !sel.getRangeAt(0).intersectsNode(target)) return '';
  return text;
}

export interface SelectionMenuDeps {
  t(key: string): string;
  /** `text` をライブラリの検索語として走らせる＝search-box-builder の searchFor。 */
  searchInLibrary(text: string): void;
}

export function makeSelectionMenu(deps: SelectionMenuDeps) {
  // 並びは Chromium に合わせる。テキストの行が先に来る＝それを出した操作がテキストを
  // 狙っていたから。カードの上でも同じ理由でカード自身の行の上に置く（そして選択が
  // ある間だけ。それ以外ではカードのメニューは変わらない）。
  function items(): HologramMenuItem[] {
    return [
      { label: deps.t('ctxCopyText'), act: 'selCopy', icon: SEL_IC.copy },
      { label: deps.t('ctxSearchWeb'), act: 'selWeb', icon: SEL_IC.web },
      { label: deps.t('ctxSearchLibrary'), act: 'selLibrary', icon: SEL_IC.library },
    ];
  }

  /** true なら、その act はこのメニューのもので、処理を済ませたことを表す。 */
  function pick(text: string, item: HologramMenuItem): boolean {
    const act = item.act;
    if (!act || !ACTS.includes(act)) return false;
    const term = searchTermOf(text || '');
    if (!term) return true; // こちらのものではあるが、働きかける先が残っていない
    if (act === 'selCopy') hologramIpc.copyText(term);
    else if (act === 'selWeb') hologramIpc.openExternal(webSearchUrl(term));
    else if (act === 'selLibrary') deps.searchInLibrary(term);
    return true;
  }

  // document レベルの受け皿。自前のメニューを持たない画面のためのもの。
  function handleContextmenu(e: MouseEvent) {
    if (e.defaultPrevented) return; // このクリックは既に別のメニューのもの
    const text = selectionTextAt(e.target);
    if (!text) return; // 選択が無ければメニューも出さない。以前と同じ
    e.preventDefault();
    menuOpen({ items: items(), x: e.clientX, y: e.clientY }, (item) => {
      pick(text, item);
    });
  }

  return { items, pick, handleContextmenu };
}

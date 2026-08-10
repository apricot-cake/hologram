// 選択の状態＝投稿グリッドの複数選択の Set と、Shift 範囲の起点。唯一の持ち主として
// 切り出したもの。hologramStore の 'selectedSet' キーがその状態そのもの（揃え続けるべき
// 別の閉包の Set は無い）＝書き換えのたびに store.get('selectedSet') で今の Set を読み、
// 新しい Set を組み（ストアの set() は === が同一なら何もしないし、グリッドの
// コンポーネントの Cell＝Grid.tsx を参照＝がこのキーを直接購読しているので、通知するには
// 新しい参照が要る）、それを書き戻す。Shift 範囲の起点は以前と同じくモジュールの私的な
// 変数のまま（購読側はいない＝viewer の内部だけのもので、state→store の段が自分で
// hologramStore へ入れないと決めた）。
// 書き換えの周りの副作用（#postGrid の 'selecting' クラス、一括の IPC・確認・描画の
// まとめ）はすべて viewer.js が持ち、このモジュールの問い合わせと書き換えの API だけを
// 呼ぶ。今は本物の ES モジュールで、その export は orchestrator と画面下の FloatingBar の
// コンポーネント（selection/）が直接 import する。

import { store } from './store.ts';

// 保存されている集合そのものではなく複製を返す。ストアがこれを ReadonlySet として持つのは、
// 公開された選択をその場で書き換えてはいけないから（同一性が変化の信号そのもの＝下のストアへの
// 押し込みを参照）。どのみち、ここの呼び出し側はどれも新しい集合を組む。
function current(): Set<string> {
  return new Set(store.getState().selectedSet);
}

let anchor: number | null = null;
// ラバーバンドのドラッグ（#484）。スナップショットは、追加であろうとなかろうと、どの
// ドラッグでも取る＝Esc が戻すのはこれ。帯がそこへ足すのか置き換えるのかは別のフラグ。
// 2つを一緒にしていたせいで、素のドラッグ中の Esc は、ドラッグを始めた時の選択ではなく
// 空の選択を戻していた。
let marqueeBase: ReadonlySet<string> | null = null;
let marqueeAdditive = false;
let marqueeAnchor: number | null = null;
let marqueeActive = false;

export function has(key: string) {
  return current().has(key);
}
export function size() {
  return current().size;
}
export function anchorIndex() {
  return anchor;
}

type PostIdKey = (p: HologramPost) => string;

// `groups` のうち、今選ばれている群すべて（一括操作はこれに対して働く）。`postIdKey` は
// 群の代表を、その選択のキーへ解決する。
export function selectedGroups(groups: HologramPostGroup[], postIdKey: PostIdKey): HologramPostGroup[] {
  const set = current();
  return groups.filter((g) => set.has(postIdKey(g.rep)));
}
// 選ばれた群すべての、レコードすべて。
export function selectedRecords(groups: HologramPostGroup[], postIdKey: PostIdKey): HologramPost[] {
  const records: HologramPost[] = [];
  selectedGroups(groups, postIdKey).forEach((g) => records.push(...g.records));
  return records;
}
export function isAllSelected(groups: HologramPostGroup[], postIdKey: PostIdKey): boolean {
  const set = current();
  return groups.length > 0 && groups.every((g) => set.has(postIdKey(g.rep)));
}

// カードを選択に出し入れする。shiftKey を伴う場合は、最後の起点から範囲選択もする
// （Google フォト風）。`idx` と `key` が押されたカードを指し、`groups`（と `postIdKey`）が
// 範囲のメンバーをキーへ解決する。
export function toggle(idx: number, key: string, shiftKey: boolean, groups: HologramPostGroup[], postIdKey: PostIdKey) {
  const next = new Set(current());
  if (shiftKey && anchor !== null) {
    const lo = Math.min(anchor, idx);
    const hi = Math.max(anchor, idx);
    for (let i = lo; i <= hi; i++) if (groups[i]) next.add(postIdKey(groups[i].rep));
    anchor = idx;
  } else if (next.has(key)) {
    next.delete(key);
    anchor = null;
  } else {
    next.add(key);
    anchor = idx;
  }
  store.setState({ selectedSet: next });
}

// 素のクリック（#143）。選択をこのカード1枚だけに畳み、それを範囲の起点にする＝Eagle や
// エクスプローラー風の「クリック＝単独選択」。Ctrl/Shift は上の toggle() を使い続ける
// （追加・解除／範囲）。
export function selectOnly(idx: number, key: string) {
  anchor = idx;
  store.setState({ selectedSet: new Set<string>([key]) });
}

export function clear() {
  anchor = null;
  store.setState({ selectedSet: new Set<string>() });
}

// --- ラバーバンド（ドラッグによる範囲選択、#484） -------------------------
// 帯はその場で下見が出る。当たったものの集合が変わるフレームごとに updateMarquee() が
// 走るので、同じ添字の集合に対しては何度実行しても同じでなければならない＝積み上げるのでは
// なく、必ず下のスナップショットから組み直す。

// `additive` は、ドラッグを始めた時に Ctrl/Cmd か Shift を押していたことを表す
// （エクスプローラーや Finder 風＝帯は既存の選択を置き換えずに広げる）。
export function beginMarquee(additive: boolean) {
  marqueeBase = current();
  marqueeAdditive = additive;
  marqueeAnchor = anchor;
  marqueeActive = true;
}

export function updateMarquee(indices: number[], groups: HologramPostGroup[], postIdKey: PostIdKey) {
  if (!marqueeActive) return;
  const next = new Set<string>(marqueeAdditive ? (marqueeBase ?? []) : []);
  for (const i of indices) {
    const g = groups[i];
    if (g) next.add(postIdKey(g.rep));
  }
  // 矢印での移動は起点から動くので、起点は帯が触れた最小の添字に置く＝ひと続きの先頭で、
  // そこからキーボードで続けるのが自然に読める。（`indices` は marquee.hitIndices から
  // 昇順で届く。）
  anchor = indices.length ? indices[0] : marqueeAnchor;
  store.setState({ selectedSet: next });
}

export function endMarquee() {
  marqueeBase = null;
  marqueeAdditive = false;
  marqueeAnchor = null;
  marqueeActive = false;
}

// ドラッグ中の Esc。始める前に選ばれていたものを、そのまま戻す。
export function cancelMarquee() {
  if (!marqueeActive) return;
  const base = marqueeBase;
  anchor = marqueeAnchor;
  endMarquee();
  store.setState({ selectedSet: new Set<string>(base ?? []) });
}

// 無条件の全選択（Ctrl/Cmd+A）。今の選択に関わらず、すべての群を入れる。
export function selectAll(groups: HologramPostGroup[], postIdKey: PostIdKey) {
  const next = new Set(current());
  groups.forEach((g) => next.add(postIdKey(g.rep)));
  anchor = null;
  store.setState({ selectedSet: next });
}

// 全選択・全解除のボタンとツールバーのショートカット。すべて選ばれた状態と、何も選ばれて
// いない状態の間を一手で行き来する。
export function toggleAll(groups: HologramPostGroup[], postIdKey: PostIdKey) {
  if (isAllSelected(groups, postIdKey)) clear();
  else selectAll(groups, postIdKey);
}

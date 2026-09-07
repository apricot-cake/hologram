// セッション内 undo/redo スタック（#235）。意図して揮発性にしている: ウィンドウ
// が生きている間だけ生き、投稿ごとの永続的な変更履歴は無い（理由は #235 の
// 再提案ガードにある）。
//
// スタックが記録するのは、その編集が実際に生んだ「差分」――対象ごとに、
// 追加した値と削除した値――で、undo はその差分を今対象が持っているものに
// 対して反転して再適用する。これがもたらす2つの帰結こそが主旨そのもの:
//
//   - 対象にとって何も変わらなかった編集は決して記録しない（一部のアイテムが
//     すでにそのタグを持っている選択への一括タグ付け）＝undo がその操作が
//     置かなかった値を剥ぎ取ることはできない。
//   - 同じ対象への後の、無関係な編集は、それを undo で通り越されても生き
//     残る＝ここでは捕まえたフィールド全体を書き戻すことが一切無いため。
//
// どちらも、却下された代替案（全スナップショット復元／素朴な逆操作）が
// 使われていない理由――#235 参照。
//
// 再追加された値は元の index ではなく対象の一覧の末尾に着地する: 位置は
// 差分の一部ではなく、それを再構築するには、このモデルが避けようとしている
// スナップショットを運ぶことになってしまう。
//
// このモジュールが持つのはスタックのセマンティクスだけ（上限、新しい編集での
// redo の破棄、方向のマッピング、スタック最上段のガード）。実際に変更を
// 書き込むのは呼び出し側の仕事で、`appliers` の dep として（種類ごとに1つ）
// 届く――undo.ts は DOM にも IPC にも一切触れない。

const UNDO_MAX = 50;

/** 記録された変更が何についてのものか: どの種類の対象に、どんな値の集合を。 */
export type UndoKind = 'post-tags' | 'poster-tags' | 'folder-items';

/**
 * 編集における1つの対象の取り分。`target` は captureId（post-tags）、
 * poster key（poster-tags）、またはフォルダ id（…-items）。`image` は
 * post-tags のときだけ一緒に運ばれる。update-tags が captureId ではなく
 * ファイル名でキー付けされているため。`added`/`removed` は編集が実際に
 * 動かした値――空の対は変更ではない。
 */
export type UndoChange = {
  kind: UndoKind;
  target: string;
  image?: string;
  added: string[];
  removed: string[];
};

/** すでに方向が定まった変更: 今すぐこれらを追加し、それらを削除する。 */
export type DirectedChange = { target: string; image?: string; add: string[]; remove: string[] };

export type UndoEntry = { id: number; changes: UndoChange[] };

export type UndoAppliers = { [K in UndoKind]: (changes: DirectedChange[]) => Promise<void> | void };

const uniq = (list: readonly string[] | null | undefined) => [...new Set((list || []).filter((v): v is string => typeof v === 'string'))];

/**
 * 何もしない変更と、自己相殺するものを落とす。追加にも削除にも挙がっている
 * 値は整合の取れた形で反転できないので、推測するのではなく両側から取り除く。
 */
function normalize(changes: readonly UndoChange[] | null | undefined): UndoChange[] {
  const out: UndoChange[] = [];
  for (const c of changes || []) {
    if (!c || !c.target) continue;
    const added = uniq(c.added);
    const removed = uniq(c.removed);
    const both = new Set(added.filter((v) => removed.includes(v)));
    const a = added.filter((v) => !both.has(v));
    const r = removed.filter((v) => !both.has(v));
    if (!a.length && !r.length) continue;
    out.push({ kind: c.kind, target: c.target, ...(c.image ? { image: c.image } : {}), added: a, removed: r });
  }
  return out;
}

export function makeUndo(deps: { appliers: UndoAppliers }) {
  const undoStack: UndoEntry[] = [];
  let redoStack: UndoEntry[] = [];
  let seq = 0;

  /**
   * 編集を記録する。エントリを返す（トースト通知がその id を保持できる
   * ように）。正規化を生き延びるものが何も無かったときは null――null は、
   * 「Undo」を提示すべきものが無いという呼び出し側への合図。
   */
  function push(changes: readonly UndoChange[] | null | undefined): UndoEntry | null {
    const normalized = normalize(changes);
    if (!normalized.length) return null;
    const entry: UndoEntry = { id: ++seq, changes: normalized };
    undoStack.push(entry);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = []; // 線形の履歴: 新しい編集は redo の枝を破棄する
    return entry;
  }

  async function apply(entry: UndoEntry, dir: 'undo' | 'redo') {
    // 変更ごとではなく種類ごとに1回、適用側を呼ぶ: どの適用側もひとかたまりの
    // データ（folders 配列、poster-tags のマップ）を永続化するので、
    // まとめることで N個の対象への undo が N回ではなく1回の書き込みで済む。
    const byKind = new Map<UndoKind, DirectedChange[]>();
    for (const c of entry.changes) {
      const image = c.image ? { image: c.image } : {};
      const directed: DirectedChange = dir === 'undo' ? { target: c.target, ...image, add: c.removed, remove: c.added } : { target: c.target, ...image, add: c.added, remove: c.removed };
      const list = byKind.get(c.kind);
      if (list) list.push(directed);
      else byKind.set(c.kind, [directed]);
    }
    for (const [kind, changes] of byKind) {
      const applier = deps.appliers[kind];
      if (applier) await applier(changes);
    }
  }

  /** Ctrl+Z が次に取るであろうエントリ――トースト通知の「Undo」はこれを見て正直さを保つ。 */
  function peek(): UndoEntry | null {
    return undoStack.length ? undoStack[undoStack.length - 1] : null;
  }

  // どちらも、適用されたエントリを返す。何もすることが無かったときは null
  // （呼び出し側はエントリがあるときだけトースト通知する）。
  async function undo(): Promise<UndoEntry | null> {
    const entry = undoStack.pop();
    if (!entry) return null;
    await apply(entry, 'undo');
    redoStack.push(entry);
    return entry;
  }

  async function redo(): Promise<UndoEntry | null> {
    const entry = redoStack.pop();
    if (!entry) return null;
    await apply(entry, 'redo');
    undoStack.push(entry);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    return entry;
  }

  /**
   * トースト通知の「Undo」: そのトースト通知が上がった原因のエントリを
   * undo する。それが今もいちばん新しいものである間だけ。トースト通知は
   * その操作より数秒長生きするので、このガードが無いと、もう1回別の編集が
   * 起きた後にクリックが着地すると、代わりにその別の編集が元に戻されて
   * しまう――まさに、この差分モデルが防ごうとしている「undo が別の何かを
   * 壊した」という失敗そのもの。もう最上段にないときはこのボタンは no-op
   * で、Ctrl+Z が戻る手段として残る。
   */
  async function undoIfTop(id: number): Promise<UndoEntry | null> {
    const top = peek();
    if (!top || top.id !== id) return null;
    return undo();
  }

  return { push, undo, redo, undoIfTop, peek };
}

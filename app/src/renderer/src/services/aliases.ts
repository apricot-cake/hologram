// 投稿者の別名の service＝現実の同じ作者・アカウントを指す posterKey どうしを、壊さずに
// 元へ戻せる形で名前統合する（#23 St1: 設計は Issue 上で 2026-07-11 / 2026-07-16 /
// 2026-07-19 / 2026-07-20 に確定）。tags.ts と同じ「状態を持つ」形で、load() と書き換えが
// ディスクへ永続化し（get/set-poster-aliases。ipc-organize.ts 経由で DB に載る）、購読側へ
// 通知する。その周りの業務ロジック（取り消しの記録、確認のゲート、トースト、共有の
// markPostsMutated の世代の繰り上げ）は呼び出し側（poster-grid-builder.ts）が持ち、群の
// 配列に自分で手を伸ばす代わりに、ここの書き換えを呼ぶ。
//
// 正準のキーは、その群の primary の posterKey（2026-07-11 の設計＝新しい id の名前空間は
// 作らない）＝投稿者をまとめる・数える・絞り込む読み手はどれも、メンバーのキーを
// resolve(key) へ畳む。だから既存の userKey の空間（クエリの葉、投稿者のフォルダやタグ）は
// そのまま動き続ける。葉や集約がコンパイルの元にする読み取りは membersOf(key)（'user' の
// クエリの葉、buildUsers の2回目の畳み込み、投稿者のタグ・フォルダの和集合の読み取り）。
// resolve(key) は membersOf の先頭の要素＝下の reindex() が、primary をその位置に留める。
//
// 段階①だけ（この Issue のチェックリストの項目1＝土台と、手で操作する UI と、伝播）。
// alias-suggest.ts（段階②の、判断を伴わない候補の順位付け）と `dismissed` の一覧
// （段階②の、断って覚えておく仕組み）は、その回で入る。
import { hologramIpc } from './ipc.ts';

export interface PosterAliasGroup {
  id: string;
  primary: string;
  members: string[]; // primary が先頭。残りは保存された順＝reindex() を参照
}

const genId = () => 'al-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);

let groups: PosterAliasGroup[] = [];
let byKey = new Map<string, PosterAliasGroup>();

// 読み込みと書き換えのたびに組み直す（群の数はごく小さい＝統合はせいぜい数件なので、
// 索引に手を入れるより丸ごと組み直す方が安い）。
function reindex() {
  byKey = new Map();
  for (const g of groups) {
    // primary を先頭に。membersOf(key)[0] は、よく回るループが resolve() をもう一度
    // 呼ばずに取れる安い「正準のキー」で、resolve() と一致していなければならない。
    g.members = [g.primary, ...g.members.filter((m) => m !== g.primary)];
    for (const m of g.members) byKey.set(m, g);
  }
}

async function readAliases() {
  try {
    const r = await hologramIpc.getPosterAliases();
    return Array.isArray(r?.groups) ? r.groups : [];
  } catch {
    return [];
  }
}
// 投げっぱなしの永続化。tags.ts の setPosterTags の先例に合わせてある。
async function writeAliases() {
  try {
    await hologramIpc.setPosterAliases({ groups: groups.map((g) => ({ id: g.id, primary: g.primary, members: g.members })) });
  } catch {
    /* できる範囲で */
  }
}

let loadPromise: Promise<void> | null = null;
async function doLoad() {
  const raw = await readAliases();
  groups = raw.filter((g): g is PosterAliasGroup => !!g && typeof g.id === 'string' && typeof g.primary === 'string' && Array.isArray(g.members) && g.members.length >= 2);
  reindex();
}
// 何度実行しても同じ＝viewer の bootApp から1回呼んで安全で、後の呼び出しは同じ promise を
// 使い回す。
export function load(): Promise<void> {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

// #32 St2: 他のウィンドウの set-poster-aliases が着いた＝読み直し（org-changed が発火する
// 時点でディスクは既に最新）、このウィンドウ自身の購読側へ通知する。folders.ts や tags.ts の
// org-changed のリスナーが使っている「読み込み直して通知する」と同じ形。
// できる範囲で。Node（単体テスト）ではブリッジが無い＝このモジュールの
// readAliases()/writeAliases() が既に使っている握り潰しと同じ。
try {
  hologramIpc.onOrgChanged((kind) => {
    if (kind !== 'poster-aliases') return;
    loadPromise = doLoad().then(() => notify());
  });
} catch {
  /* ブリッジが無い（Node の単体テスト） */
}

// --- 購読側（このモジュール自身の変更の経路＝tags.ts の鏡。共有の投稿の世代の計数を
// ここで繰り上げる者はいない。それは呼び出し側の仕事のまま。tags.ts の書き換えが
// markPostsMutated を viewer.ts に任せているのとまったく同じ） ---
const subs: Array<() => void> = [];
function notify() {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch {
      /* 無視する */
    }
  }
}
export function onChange(cb: () => void): () => void {
  subs.push(cb);
  return () => {
    const i = subs.indexOf(cb);
    if (i >= 0) subs.splice(i, 1);
  };
}

// --- 読み取り ---
export function groupOf(key: string): PosterAliasGroup | null {
  return byKey.get(key) || null;
}
/** このキーの群がまとめている posterKey すべて（primary が先頭）。群に属していなければ [key] 1つだけ。 */
export function membersOf(key: string): string[] {
  const g = byKey.get(key);
  return g ? g.members : [key];
}
/** その群の正準のキー（2026-07-11 の設計＝primary が正準のキーそのもので、新しい id の名前空間は作らない）。群に属していなければ恒等。 */
export function resolve(key: string): string {
  const g = byKey.get(key);
  return g ? g.primary : key;
}
export function isPrimary(key: string): boolean {
  const g = byKey.get(key);
  return !g || g.primary === key;
}
export function allGroups(): readonly PosterAliasGroup[] {
  return groups;
}

// --- 書き換え。永続化して通知する。取り消しの記録、確認のゲート、トーストは呼び出し側
// （poster-grid-builder.ts）に残る。tags.ts のヘッダのコメントが自分の書き換えについて
// 説明しているのと同じ分担。 ---

// keyA と keyB の群を1つに統合する（どちらもまだ群を持っていなければ新しく作る）。
// opts.primary を渡す場合は、和集合のメンバーでなければならない。渡さなければ、keyA/keyB の
// うち既に群を持っていた方の primary を使う。両方が持っていた場合は keyA 側が勝つ＝だから
// 群に属していない投稿者を、既に統合済みの群へ統合すると、既定ではその群の身元が保たれる
// （呼び出し側は、インスペクタが開いている投稿者を keyA として渡す）。
export function merge(keyA: string, keyB: string, opts?: { primary?: string }): boolean {
  if (!keyA || !keyB || keyA === keyB) return false;
  const gA = byKey.get(keyA);
  const gB = byKey.get(keyB);
  if (gA && gA === gB) return false; // 既に同じ群
  const members = [...new Set([...(gA ? gA.members : [keyA]), ...(gB ? gB.members : [keyB])])];
  const fallbackPrimary = (gA && gA.primary) || (gB && gB.primary) || keyA;
  const primary = opts?.primary && members.includes(opts.primary) ? opts.primary : fallbackPrimary;
  const id = (gA && gA.id) || (gB && gB.id) || genId();
  groups = groups.filter((g) => g !== gA && g !== gB);
  groups.push({ id, primary, members });
  reindex();
  writeAliases();
  notify();
  return true;
}

// key をその群から外す。メンバーが2人未満になった群は、もう群ではない（解散する＝最後に
// 残ったメンバーも群に属さない状態へ戻る）。lib-db-write.ts の replacePosterAliases が
// ディスクへ書く途中で課しているのと同じ「2人未満」の下限。外したキーが primary だった時は、
// 残った先頭のメンバーを自動で primary へ繰り上げる。だから、メンバーでない primary を
// 持つ群が永続化されることはない。
export function unlink(key: string): boolean {
  const g = byKey.get(key);
  if (!g) return false;
  const members = g.members.filter((m) => m !== key);
  groups = groups.filter((x) => x !== g);
  if (members.length >= 2) groups.push({ id: g.id, primary: g.primary === key ? members[0] : g.primary, members });
  reindex();
  writeAliases();
  notify();
  return true;
}

// key をその群の primary にする（2026-07-11 の設計＝既定は投稿数が最も多いメンバーで、
// インスペクタから変えられる。「最も多い」を決めるのは呼び出し側で、buildUsers() の件数から
// 判断して勝ったキーをここへ渡す。このモジュールはその依存を持たないままにする。tags.ts が
// 投稿やタグの業務ロジックを自分の書き換えの外に置いているのと同じ理屈）。
export function setPrimary(key: string): boolean {
  const g = byKey.get(key);
  if (!g || g.primary === key) return false;
  g.primary = key;
  reindex();
  writeAliases();
  notify();
  return true;
}

// --- 取り消し／やり直しのためのスナップショットの基本操作（poster-grid-builder.ts の、
// 統合・解除に対する Ctrl+Z の結線。#23 St1） ---
//
// 共有の取り消しのスタック（undo.ts）は、対象ごとの追加・削除の値の差分＝「その値が、
// その対象の一覧に入っているか」のために作られた形（投稿のタグ、投稿者のタグ、フォルダの
// 項目）。統合・解除は一覧の中の値ではなく、群に対する構造の編集だ。それぞれが既に自分の
// 複数メンバーの群の primary だった投稿者2人を統合する場合（普通に起きる。統合済みの対へ
// 3人目を統合する場面）、両側の以前の群をすべてそのまま戻さなければならず、「UI で名指し
// された1つのキーを外す」では足りない。だから値の差分ではなく、poster-grid-builder.ts の
// 適用側が、触れた群すべての前後のスナップショットを丸ごと記録する。そのために要る基本操作は
// この2つだけ＝キーの集合に触れている今の群を捕まえることと、同じキーに今触れているものを
// 渡されたスナップショットで置き換えること。

/** 今 `keys` のどれかを含む、重複を除いた群すべて（深い複製）。 */
export function snapshotFor(keys: readonly string[]): PosterAliasGroup[] {
  const seen = new Set<string>();
  const out: PosterAliasGroup[] = [];
  for (const key of keys) {
    const g = byKey.get(key);
    if (g && !seen.has(g.id)) {
      seen.add(g.id);
      out.push({ id: g.id, primary: g.primary, members: [...g.members] });
    }
  }
  return out;
}

// まず、今 `keys` のどれかを含む群をすべて捨てる＝影響を受けるキーと受けないキーに
// またがる群も、部分的に手を入れるのではなく `snapshot` から丸ごと組み直す＝そのうえで
// `snapshot` をそのまま入れ直す。
export function restore(keys: readonly string[], snapshot: readonly PosterAliasGroup[]): void {
  const keySet = new Set(keys);
  groups = groups.filter((g) => !g.members.some((m) => keySet.has(m)));
  for (const g of snapshot) if (g.members.length >= 2) groups.push({ id: g.id, primary: g.primary, members: [...g.members] });
  reindex();
  writeAliases();
  notify();
}

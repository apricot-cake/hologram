'use strict';

import { normalizeTabPersistShape } from '../shared/data-schemas.ts';

// #21: 改名・統合・孤児の片付けは、いずれも tagId を変えるか消す＝そして #5 の 2026-07-18 の
// コメントは、保存した検索やタブの中のタグの葉を tagId の参照の裏へ置いた。まさに、改名が保存済み
// のクエリを孤児にしないようにするため。このモジュールはその約束のもう半分＝tagId が張り替え
// られた（統合）か消えた（削除）とき、そういう葉を全部同期させる掃き寄せで、クエリの木が休んで
// いられる2か所＝folders.tree（動的フォルダ）と tabs.state（タブごとの表示のスナップショットと、
// そのタブごとの遷移の履歴、#144）＝の両方にまたがる。
//
// レンダラーの query.ts の形を import せず、意図してダックタイピング（`AnyNode`）にしてある。
// これはメインプロセスで、タブの塊がたまたま持っている JSON が何であれ、それに対して走る
// （レンダラー側なら normalizeLeaf が治すであろう、廃止済みの葉の型の形も含めて）＝この歩き手が
// 認識しないノード（kind や children が無い）は、例外を投げずにそのまま残す。ここでの壊れた木は
// 既存のデータの問題であって、この掃き寄せが直す仕事ではないため。

interface AnyNode {
  kind?: string;
  type?: string;
  tagId?: number;
  children?: AnyNode[];
  [key: string]: unknown;
}

/** `remap(id)` は残すべき新しい id を返すか、葉を丸ごと捨てるなら 'delete' を返す。 */
export type TagIdRemap = (id: number) => number | 'delete';

const TAG_ID_REMAP_KEY = 'tagIdRemap';
type StoredTagIdRemap = Record<string, number | null>;

function readStoredTagIdRemap(sqlite: import('better-sqlite3').Database): StoredTagIdRemap {
  const row = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(TAG_ID_REMAP_KEY) as { value: string } | undefined;
  if (!row) return {};
  try {
    const value = JSON.parse(row.value);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeStoredTagIdRemap(sqlite: import('better-sqlite3').Database, value: StoredTagIdRemap): void {
  sqlite.prepare('INSERT INTO store_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(TAG_ID_REMAP_KEY, JSON.stringify(value));
}

function resolveStoredTagId(value: StoredTagIdRemap, id: number): number | 'delete' {
  const seen = new Set<number>();
  let current = id;
  while (Object.hasOwn(value, current) && !seen.has(current)) {
    seen.add(current);
    const next = value[current];
    if (next == null) return 'delete';
    current = next;
  }
  return current;
}

export function rememberTagMerge(sqlite: import('better-sqlite3').Database, source: number, target: number): void {
  const value = readStoredTagIdRemap(sqlite);
  value[source] = target;
  for (const key of Object.keys(value)) {
    const resolved = resolveStoredTagId(value, Number(key));
    value[key] = resolved === 'delete' ? null : resolved;
  }
  writeStoredTagIdRemap(sqlite, value);
}

export function rememberTagDeletion(sqlite: import('better-sqlite3').Database, deleted: ReadonlySet<number>): void {
  const value = readStoredTagIdRemap(sqlite);
  for (const id of deleted) value[id] = null;
  for (const key of Object.keys(value)) if (resolveStoredTagId(value, Number(key)) === 'delete') value[key] = null;
  writeStoredTagIdRemap(sqlite, value);
}

export function savedTagIdRemap(sqlite: import('better-sqlite3').Database, validIds: ReadonlySet<number>): TagIdRemap {
  const value = readStoredTagIdRemap(sqlite);
  return (id) => {
    const resolved = resolveStoredTagId(value, id);
    return resolved !== 'delete' && validIds.has(resolved) ? resolved : 'delete';
  };
}

// クエリの木を1つ、その場で歩く。何か変わったら true を返す（呼び出し元は、実際に変わった行だけを
// 保存し直す）。葉は `{kind:'cond', type:'tag', tagId}`（query.ts）。それ以外は `children` を
// 通って再帰する。
export function sweepQueryTree(node: AnyNode | null | undefined, remap: TagIdRemap): boolean {
  if (!node || typeof node !== 'object' || !Array.isArray(node.children)) return false;
  let changed = false;
  const kept: AnyNode[] = [];
  for (const child of node.children) {
    if (child && child.kind === 'cond' && child.type === 'tag' && typeof child.tagId === 'number') {
      const r = remap(child.tagId);
      if (r === 'delete') {
        changed = true;
        continue; // 葉を捨てる
      }
      if (r !== child.tagId) {
        child.tagId = r;
        changed = true;
      }
      kept.push(child);
      continue;
    }
    if (child && child.kind === 'group') {
      if (sweepQueryTree(child, remap)) changed = true;
    }
    kept.push(child);
  }
  if (changed) node.children = kept;
  return changed;
}

function sweepFilterList(filters: unknown, remap: TagIdRemap): boolean {
  if (!Array.isArray(filters)) return false;
  let changed = false;
  const kept: unknown[] = [];
  for (const filter of filters) {
    if (filter && typeof filter === 'object' && (filter as AnyNode).type === 'tag' && typeof (filter as AnyNode).tagId === 'number') {
      const oldId = (filter as AnyNode).tagId as number;
      const nextId = remap(oldId);
      if (nextId === 'delete') {
        changed = true;
        continue;
      }
      if (nextId !== oldId) {
        (filter as AnyNode).tagId = nextId;
        changed = true;
      }
    }
    kept.push(filter);
  }
  if (changed) filters.splice(0, filters.length, ...kept);
  return changed;
}

// タブ1つ分の永続化された塊（tab-state.ts の HologramTabPersist。DB を裏に持つ `tabs` テーブルから
// 解析済みの JSON として読み戻す＝#298 が tabs.json をここへ移した）。state.view.tree（生きた
// グリッドのスナップショット）と、'posts' / 'posters' の遷移履歴のエントリそれぞれの .tree を
// 掃き寄せる（#144 がそれらをタブごとの戻る・進むのスタックにも載せた）。'image' のエントリは木を
// 持たないので、そのままにする。
export function sweepTabState(blob: unknown, remap: TagIdRemap): { blob: unknown; changed: boolean } {
  if (!blob || typeof blob !== 'object') return { blob, changed: false };
  const canonical = normalizeTabPersistShape(blob);
  let changed = canonical !== blob;
  const view = (canonical as { view?: { tree?: AnyNode } }).view;
  if (view && view.tree && sweepQueryTree(view.tree, remap)) changed = true;
  if (view && sweepFilterList((view as { f?: unknown }).f, remap)) changed = true;
  const hist = (canonical as { nav?: { hist?: Array<{ kind?: string; state?: { tree?: AnyNode; f?: unknown } }> } }).nav?.hist;
  if (Array.isArray(hist)) {
    for (const entry of hist) {
      if (!entry || (entry.kind !== 'posts' && entry.kind !== 'posters')) continue;
      const tree = entry.state?.tree;
      if (tree && sweepQueryTree(tree, remap)) changed = true;
      if (sweepFilterList(entry.state?.f, remap)) changed = true;
    }
  }
  return { blob: canonical, changed };
}

// folders.tree と tabs.state のすべてのタグの葉に `remap` を当て、実際に変わった行だけを書き戻す。
// 呼び出し元自身のトランザクションの中で呼ぶこと（統合と削除は、既に操作全体を1つで包んでいる）。
export function sweepFoldersAndTabs(sqlite: import('better-sqlite3').Database, remap: TagIdRemap): void {
  const folderRows = sqlite.prepare("SELECT id, tree FROM folders WHERE kind = 'dynamic' AND tree IS NOT NULL").all() as Array<{ id: string; tree: string }>;
  const updateFolder = sqlite.prepare('UPDATE folders SET tree = ? WHERE id = ?');
  for (const row of folderRows) {
    let tree: AnyNode;
    try {
      tree = JSON.parse(row.tree);
    } catch {
      continue; // 解析できない行を直すのは、この掃き寄せの仕事ではない
    }
    if (sweepQueryTree(tree, remap)) updateFolder.run(JSON.stringify(tree), row.id);
  }

  const tabRows = sqlite.prepare('SELECT id, state FROM tabs').all() as Array<{ id: string; state: string }>;
  const updateTab = sqlite.prepare('UPDATE tabs SET state = ? WHERE id = ?');
  for (const row of tabRows) {
    let blob: unknown;
    try {
      blob = JSON.parse(row.state);
    } catch {
      continue;
    }
    const swept = sweepTabState(blob, remap);
    if (swept.changed) updateTab.run(JSON.stringify(swept.blob), row.id);
  }
}

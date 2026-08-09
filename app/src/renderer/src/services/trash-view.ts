// ゴミ箱の行き先の状態（#268）――左ナビの「ゴミ箱」項目と、それが開く
// `trash` ブラウズビューの裏にあるモデル。生の IPC 呼び出しは trash.ts に
// 残る（list/restore/delete/empty、1:1 の転送）。これが持つのは view が
// 必要とするものすべて: カードへグループ化された読み込み済みレコード、
// 自分専用の選択、そして復元／完全削除／全消去のコマンド。
//
// この選択はあえて services/selection.ts のものではない: あちらの集合は
// フローティングバーのタグ／フォルダ／グループ操作を供給していて、それらは
// まさにゴミ箱が提供してはいけない編集そのもの（#268 の設計で確定済み――
// 「通常のタグ／フォルダ編集と新規保存はゴミ箱の中では無効」）。決して
// 混同されえない2つの集合であることが、各操作でのガードによってではなく
// 構造によってそれを真であり続けさせている。
//
// カードのモデルはライブラリ自身のもの（post-grid-builder の cardModel を
// hologramTrashGridSource に渡す）で、ゴミ箱に入った投稿がグリッドにいた
// ときとまったく同じに見えるようにしている。グルーピング関数も同じ理由で
// ここに注入されている――1枚のカードとして削除された複数画像の投稿は、
// 1枚のカードとして戻ってくる。
//
// ここには、ゴミ箱がディスク上のどこにあるかを知るものは何も無く、それが
// ライブラリ自身のカードモデルにこれらのレコードを描かせている: list-trash
// はファイルを保存フォルダからの相対名で扱う（`.trash/<file>`、
// lib-trash-capture.ts の rebaseOntoTrash 参照）。それは、アプリ内の
// すべてのファイル名が読まれる唯一の枠組み（#267）。このプレフィックスは
// 復元／完全削除にも見えない: どちらもレコードを captureId でアドレス
// 指定し、main が baseOf() でそれを回復する。
import { open as confirmOpen } from './confirm.ts';
import { postIdKey, stampPost } from './records.ts';
import { store } from './store.ts';
import { deleteFromTrash, emptyTrash, listTrash, restorePost } from './trash.ts';
import { notify } from './ui.ts';

export interface TrashViewDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  /** post-grid-builder の groupRecords――ライブラリグリッドが使うのと同じグルーピング。 */
  groupRecords(list: HologramPost[]): HologramPostGroup[];
  /** 単一画像の覗き見（services/lightbox.ts）、インスペクタのサムネイルが開くのと同じもの。 */
  openQuickView(g: HologramPostGroup): void;
}

let deps: TrashViewDeps | null = null;
export function configure(d: TrashViewDeps) {
  deps = d;
}

let groups: HologramPostGroup[] = [];
let count = 0; // ゴミ箱内の capture 数（カード数ではない）＝サイドバーバッジが示すもの
let selected = new Set<string>(); // グループのキー（カードの代表レコードの postIdKey）
let anchor: string | null = null; // shift 範囲選択のアンカー
let busy = false;
let loaded = false;

export interface TrashViewSnapshot {
  groups: HologramPostGroup[];
  selected: ReadonlySet<string>;
  count: number;
  busy: boolean;
  loaded: boolean;
}
let snapshot: TrashViewSnapshot = { groups, selected, count, busy, loaded };

const subs = new Set<() => void>();
function publish() {
  snapshot = { groups, selected, count, busy, loaded };
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function getSnapshot(): TrashViewSnapshot {
  return snapshot;
}
/** サイドバーバッジはこれだけを読む（数値はそれ自体で安定したスナップショット）。 */
export function getCount(): number {
  return count;
}

const keyOfGroup = (g: HologramPostGroup) => postIdKey(g.rep);

// .trash/ を読み、カード集合を作り直す。唯一の更新経路にするのに十分安上がり
// （ディレクトリの読み取り＋グループ化1回）なので、バッジと view は中身に
// ついて決して食い違わない。
export async function refresh(): Promise<void> {
  if (!deps) return; // orchestrator がこれを配線する前に呼ばれた（コンポーネントが先にマウントした）
  let records: HologramPost[] = [];
  try {
    records = ((await listTrash()) || []) as HologramPost[];
  } catch {
    records = [];
  }
  // 最近削除されたものを先に――どのゴミ箱も読まれる順序（Explorer の
  // 「削除日」、macOS Finder の「Date Deleted」、digiKam の「Deletion Time」）。
  records.sort((a, b) => String((b as any).trashedAt || '').localeCompare(String((a as any).trashedAt || '')));
  count = records.length;
  groups = deps.groupRecords(records.map(stampPost));
  const live = new Set(groups.map(keyOfGroup));
  const kept = new Set([...selected].filter((k) => live.has(k)));
  if (kept.size !== selected.size) selected = kept;
  if (anchor && !live.has(anchor)) anchor = null;
  loaded = true;
  // null（[] ではなく）はグリッドのセルを同期的にアンマウントする――post
  // グリッドが使うのと同じ番兵（services/grid.ts の computeModel 参照）。
  store.setState({ trashGroups: groups.length ? groups : null });
  publish();
}

// --- 選択 --------------------------------------------------------------------
// ただのクリックは置き換え、Ctrl/Cmd はトグル、Shift はアンカーから拡張する
// ――post グリッドがすでに教えているジェスチャー（#143）なので、ここで
// 新しく学ぶことは何も無い。
export function clickCard(key: string, mods: { ctrl?: boolean; shift?: boolean }) {
  if (mods.shift && anchor) {
    const keys = groups.map(keyOfGroup);
    const a = keys.indexOf(anchor);
    const b = keys.indexOf(key);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      selected = new Set(keys.slice(lo, hi + 1));
      publish();
      return;
    }
  }
  if (mods.ctrl) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  } else {
    selected = new Set([key]);
  }
  anchor = key;
  publish();
}
export function clearSelection() {
  if (!selected.size) return;
  selected = new Set();
  anchor = null;
  publish();
}
export function selectAll() {
  selected = new Set(groups.map(keyOfGroup));
  publish();
}
export function preview(key: string) {
  const g = groups.find((x) => keyOfGroup(x) === key);
  if (g && deps) deps.openQuickView(g);
}

// --- コマンド ------------------------------------------------------------
function selectedGroups(): HologramPostGroup[] {
  return groups.filter((g) => selected.has(keyOfGroup(g)));
}
async function run(work: () => Promise<void>) {
  if (busy) return;
  busy = true;
  publish();
  try {
    await work();
  } finally {
    busy = false;
    await refresh(); // refresh() publishes
  }
}

export function restoreSelected() {
  const picked = selectedGroups();
  if (!picked.length) return;
  const n = picked.reduce((sum, g) => sum + g.records.length, 0);
  run(async () => {
    for (const g of picked) {
      for (const r of g.records) {
        try {
          await restorePost((r.image || r.video || r.file || r.captureId) as string); // #236: r.file は取り込み画像の IPC 識別子
        } catch {
          /* このまま続ける――1件の不良レコードが残りを巻き添えにしてはいけない */
        }
      }
    }
    if (deps) notify(deps.t('trashRestored', [n]));
  });
}

// 完全削除は、ここにある操作のうち他のどの画面でも元に戻せない唯一のもの
// なので確認を求める――ライブラリ自身の削除確認（services/confirm.ts）と
// 同じ形。#105 のキーワードによるゲート付きの一掃は「空にする」専用のまま
// 残す。
export function requestDeleteSelected() {
  const picked = selectedGroups();
  if (!picked.length || !deps) return;
  const n = picked.reduce((sum, g) => sum + g.records.length, 0);
  const d = deps;
  confirmOpen({
    message: d.t('trashDeleteConfirm', [n]),
    description: d.t('trashDeleteConfirmDesc'),
    okLabel: d.t('trashDeleteBtn'),
    cancelLabel: d.t('confirmCancel'),
    onOk: () =>
      run(async () => {
        for (const g of picked) {
          for (const r of g.records) {
            try {
              await deleteFromTrash(r.captureId as string);
            } catch {
              /* このまま続ける */
            }
          }
        }
        notify(d.t('trashDeleted', [n]));
      }),
  });
}

// 全消去――#105 の明示的な確認。これが置き換えた設定セクションから変更
// せずに引き継いでいる（同じ message/description のキー、同じ
// AlertDialog）。
export function requestEmptyAll() {
  if (!count || !deps) return;
  const d = deps;
  confirmOpen({
    message: d.t('trashEmptyBtn'),
    description: d.t('trashEmptyConfirm'),
    okLabel: d.t('trashEmptyBtn'),
    cancelLabel: d.t('confirmCancel'),
    onOk: () =>
      run(async () => {
        try {
          await emptyTrash();
        } catch {
          /* できる範囲で――refresh() が生き残ったものを表示する */
        }
        notify(d.t('trashEmptied'));
      }),
  });
}

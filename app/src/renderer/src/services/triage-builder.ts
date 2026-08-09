// トリアージモードのビジネスロジック（#46）――triage.ts の純粋な状態の
// うち、deps を要する半分。undo-builder.ts / inspector-builder.ts を鏡写しに
// している: 自分専用の横断的な状態を持たない葉モジュール（folders.ts、
// posts.ts、tags.ts）は直接 import する。orchestrator が持つクロージャ
// （pushUndo、getAllPosts、groupRecords、markPostsMutated、renderPosts）
// だけが注入された deps として届く。
//
// === キュー ===
// グループが対象になるのは、その代表レコードがタグ無しで、かつどの静的
// フォルダのメンバーでもないとき（folders.staticFolders()――投稿を持てる
// 唯一のフォルダ。保存済み検索は決して持たない）。postGrid 自身のグループ化
// （groupRecords）で構築するので、複数画像の投稿は他のどこでもそうである
// のと同じ1枚のカードとしてトリアージされる――ここでタグ付けまたは
// フォルダ分けすると、グループの全レコードに書き込む。
// inspector-builder.ts の applyInspectorTagChange が使うのと同じ単位。
//
// === undo（#46 × #235） ===
// #235 の差分ベースの undo/redo スタック（undo-builder.ts）は、タグ／
// フォルダ操作の「データ」側についてはそのまま再利用する: applyTag/
// applyFolder は注入された pushUndo を呼び、返されたクロージャを保持する。
// ただしここでの Backspace は Ctrl+Z と同じものではない――それは
// triage.ts の lastAction が覚えているちょうど1つの操作に限定されており、
// 画面上のカーソルも1つ戻す必要がある。これは #235 のスタックがまったく
// 知らないこと（スキップには取り消すデータが一切無い）。そのためトリアージは
// スタックに「最上段は何か」を尋ねるのではなく、自分専用の単一スロットの
// 「最後の操作」（previousIndex ＋あれば #235 の undo クロージャ）を持つ
// ――2つの仕組みは、一方が他方を包含するのではなく組み合わさる。この
// Issue の、実装時に確認するという決定に従う。トリアージが開いている間も
// Ctrl+Z は引き続き働き（GlobalShortcuts は聞くのをやめない）、同じ
// スタックのエントリへ届く。applyTag/applyFolder はどちらも共有の唯一の
// pushUndo を通して push するため。
import { applyFolderItems, notifyChanged as notifyFolderChanged, onChange as foldersOnChange, staticFolders } from './folders.ts';
import { subscribe as subscribePostsData } from './posts-data.ts';
import { applyTagWrite, updateTags as postsUpdateTags } from './posts.ts';
import * as triage from './triage.ts';
import type { UndoChange } from './undo.ts';

export interface TriageMedia {
  src: string;
  video?: boolean;
  alt?: string;
  poster?: string;
}

export interface TriageBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  /** image-tab/lightbox が読むのと同じギャラリーインスタンス（records.ts の
   * makeGallery）――トリアージはその最初のページを表示する（v1 にはページ
   * めくり／ズームは無い。TriageMode.tsx 参照）。 */
  buildGroupGalleryItems(g: HologramPostGroup): TriageMedia[];
  getAllPosts(): HologramPost[];
  /** postGrid の groupRecords――ライブラリグリッドが使うのと同じグルーピング。 */
  groupRecords(list: HologramPost[]): HologramPostGroup[];
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  getPostById(id: string): HologramPost | undefined;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
}

function isInAnyFolder(captureId: string | null | undefined): boolean {
  if (!captureId) return false;
  return staticFolders().some((f) => f.items.includes(captureId));
}

/** ツールバーバッジの再描画トリガー――ライブラリの編集でもフォルダ所属の
 * 変更でも、投稿はキューへ出入りしうる。deps は不要（どちらの元も葉
 * モジュール）なので、コンポーネントは orchestrator.ts の束縛経由ではなく
 * これを直接 import する。lightbox.ts 自身の subscribe() を import する
 * のと同じやり方。foldersOnChange には購読解除が無い（folders.ts は一度も
 * それを提供したことがない――他のすべての呼び出し元もそれと共に生きて
 * いる。ここでは何もアンマウントされることが無いため）。 */
export function subscribeQueueCount(cb: () => void): () => void {
  const unsub = subscribePostsData(cb);
  foldersOnChange(cb);
  return unsub;
}

export function makeTriage(deps: TriageBuilderDeps) {
  function qualifies(p: HologramPost): boolean {
    return !(p.tags || []).length && !isInAnyFolder(p.captureId);
  }

  /** タグ無し・フォルダ無しの投稿すべてをグループ化したもの――新しい openTriage() がスナップショットするキュー。 */
  function buildQueue(): HologramPostGroup[] {
    return deps.groupRecords(deps.getAllPosts()).filter((g) => qualifies(g.rep));
  }

  /** ツールバーバッジ／空状態のゲート: 今トリアージを開いたら何件あるか。 */
  function queueCount(): number {
    return buildQueue().length;
  }

  function openTriage(): void {
    triage.openWith(buildQueue());
  }

  function closeTriage(): void {
    triage.close();
  }

  function advance(action: Omit<TriageLastActionInput, 'previousIndex'>): void {
    const st = triage.get();
    triage.setLastAction({ ...action, previousIndex: st.idx });
    triage.setIdx(st.idx + 1);
  }

  /** 現在のグループの全レコードにタグを1つ追加し、永続化し、undo を記録し、進む。 */
  async function applyTag(tag: string): Promise<void> {
    const g = triage.current();
    const clean = (tag || '').trim();
    if (!g || !clean) return;
    const recs = g.records && g.records.length ? g.records : [g.rep];
    const changes: UndoChange[] = [];
    for (const r of recs) {
      const prev: string[] = (r.tags || []).slice();
      if (prev.includes(clean)) continue; // 何らかの理由ですでに持っている――追加するものが無い
      const next = [...prev, clean];
      let res: Awaited<ReturnType<typeof postsUpdateTags>> | null = null;
      try {
        res = await postsUpdateTags(r.image || r.video || r.file, next);
      } catch {
        /* このまま続ける――1件の書き込み失敗がグループの残りを巻き添えにしてはいけない */
      }
      const rec = deps.getPostById(r.captureId);
      if (rec) applyTagWrite(rec, next, res);
      changes.push({ kind: 'post-tags', target: r.captureId, image: r.image || r.video || r.file, added: [clean], removed: [] });
    }
    if (!changes.length) return;
    const undo = deps.pushUndo(changes);
    deps.markPostsMutated();
    deps.renderPosts(true);
    advance({ kind: 'tag', label: deps.t('triageLastTag', [clean]), undo: undo || undefined });
  }

  /** 現在のグループの代表レコードをフォルダ `folderId` へ追加し、永続化し、undo を記録し、進む。 */
  function applyFolder(folderId: string): void {
    const g = triage.current();
    const cid = g && g.rep && g.rep.captureId;
    if (!g || !cid) return;
    const f = staticFolders().find((x) => x.id === folderId);
    if (!f) return;
    const res = applyFolderItems(folderId, [cid], null);
    if (!res.added.length) return; // すでにメンバー――何も動いておらず、黙って通り過ぎるものも無い
    const undo = deps.pushUndo([{ kind: 'folder-items', target: folderId, added: res.added, removed: res.removed }]);
    notifyFolderChanged('membership');
    deps.renderPosts(true);
    advance({ kind: 'folder', label: deps.t('triageLastFolder', [f.name]), undo: undo || undefined });
  }

  /** 今の項目には触れずに次へ進む――次回のためにタグ無し・フォルダ無しのまま残す。 */
  function skip(): void {
    const g = triage.current();
    if (!g) return;
    advance({ kind: 'skip', label: deps.t('triageLastSkip') });
  }

  /** Backspace: ちょうど最後の操作（データ＋カーソル）を取り消す。ファイル冒頭を参照。 */
  function undoLast(): void {
    const last = triage.get().lastAction;
    if (!last) return;
    last.undo?.();
    triage.setIdx(last.previousIndex);
    triage.setLastAction(null);
  }

  /** 現在の項目のギャラリー最初のページ。表示するものが無ければ null。 */
  function currentMedia(): TriageMedia | null {
    const g = triage.current();
    if (!g) return null;
    return deps.buildGroupGalleryItems(g)[0] || null;
  }

  // 登録は triage/index.tsx 自身の effect にある（トリアージが開いている
  // 間だけの範囲）。GlobalShortcuts ではなく image-tab/index.tsx 自身の
  // ←/→ リスナーを鏡写しにしている――トリアージはグリッドが画面に出ている
  // 間に発火する理由の無いキー集合（1-9/Space/Backspace）を持つ。
  function handleTriageKey(e: KeyboardEvent): void {
    if (!triage.isOpen()) return;
    const t = e.target as HTMLElement | null;
    const typing = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
    if (e.key === 'Backspace' && !typing) {
      e.preventDefault();
      undoLast();
      return;
    }
    if (typing) return; // タグ欄は自分自身の Enter／入力を持つ――TriageMode.tsx 参照
    if (e.key === ' ') {
      e.preventDefault();
      skip();
      return;
    }
    if (/^[1-9]$/.test(e.key)) {
      const tag = triage.get().pinnedTags[Number(e.key) - 1];
      if (tag) void applyTag(tag);
    }
  }

  return { queueCount, openTriage, closeTriage, applyTag, applyFolder, skip, undoLast, handleTriageKey, currentMedia, listFolders: () => staticFolders() };
}

type TriageLastActionInput = { kind: 'tag' | 'folder' | 'skip'; label: string; previousIndex: number; undo?: () => void };

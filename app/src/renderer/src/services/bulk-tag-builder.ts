// 一括の「選択にタグを付ける」＝選択バーの「タグを追加」の、書き込み側。面は Dialog
// （selection/BulkTagDialog、P2⑦）。その前は tag-pop の mode:'bulk' で、さらに前は編集の
// オーバーレイのモーダルだった。毎回動いたのはタグを積む場所だけで、確定＝永続化、取り消しの
// 捕捉、描画のやり直し、トースト＝はずっとこのモジュールが持っている。
//
// 積む一覧は、もうレンダラーには一切無い。ダイアログが React の状態で持ち、適用の時に1回だけ
// 渡してくるので、揃え続けるモジュールレベルの複製も、追加・削除のたびの refresh() の
// 押し込みも要らない。そのモジュール（と、それが支えていた「タグ付けのセッション」という面
// 全体）は撤去した＝P2⑬＝ので、このファイルも一括編集という名前を一緒に捨てた。多くの投稿に
// タグを付けるのは、今は組み合わせで行う＝「タグなし」で絞り、結果を矢印でたどり、インスペクタ
// でタグを編集する。この Dialog は「同じタグを、これ全部に一度で」の近道でしかない。
import { open as bulkTagOpen } from './bulk-tag.ts';
import { applyTagWrite, updateTags as postsUpdateTags } from './posts.ts';
import type { UndoChange } from './undo.ts';
import type { NotifyAction } from './ui.ts';

export interface BulkTagBuilderDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  showToast(msg: unknown, action?: NotifyAction | null): void;
  showKindMenu(tag: string, x: number, y: number, onChange: () => void): void;
  inspectorTagPickerData(tags: string[], recordsForSource: any[], kind: string): any;
  pushUndo(changes: readonly UndoChange[]): (() => void) | null;
  undoAction(undoFn: (() => void) | null): NotifyAction | null;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  keepCurrentVisible(): void;
  getPostById(id: string): HologramPost | undefined;
  selectedRecords(): HologramPost[];
}

export function makeBulkTag(deps: BulkTagBuilderDeps) {
  // 積んだタグを、選ばれたレコードすべてへ併合する。足すモードしか無い（「N 件の投稿の
  // タグを置き換える」UI は存在しない）ので、各レコードは自分のタグを保ったまま、これらを
  // 得る。
  async function applyTagsToSelection(records: HologramPost[], applyTags: string[]) {
    deps.keepCurrentVisible(); // タグの編集で、カードが今の絞り込みの外へ出ることがある
    // そのレコードがまだ持っていなかったタグだけが、そのレコードの分の編集（#235）。選択の
    // 一部が既にそのタグを持っていた場合、操作を取り消した時にそれを失ってはいけない＝
    // だから、元からあったものは記録しない。
    const changes: UndoChange[] = [];
    for (const r of records) {
      const prev = r.tags || [];
      const added = [...new Set(applyTags)].filter((tag) => !prev.includes(tag));
      if (!added.length) continue;
      const next = [...prev, ...added];
      let res: Awaited<ReturnType<typeof postsUpdateTags>> | null = null;
      try {
        res = await postsUpdateTags(r.image || r.video || r.captureId, next);
      } catch {
        /* 続ける */
      }
      const rec = deps.getPostById(r.captureId); // O(1) の引き当て。allPosts は同じレコードの参照を共有している
      if (rec) applyTagWrite(rec, next, res);
      changes.push({ kind: 'post-tags', target: r.captureId, image: r.image || r.video || r.captureId, added, removed: [] });
    }
    const undoFn = deps.pushUndo(changes);
    deps.markPostsMutated();
    deps.renderPosts(true); // keepLimit＝選択はそのまま、アニメーションの再生も無し
    const n = records.length;
    deps.showToast(n > 1 ? deps.t('tagsSavedN', [n]) : deps.t('tagsSaved'), deps.undoAction(undoFn));
  }

  function openBulkTagDialog() {
    const records = deps.selectedRecords();
    if (!records.length) return;
    bulkTagOpen({
      count: records.length,
      // ダイアログに積まれたタグから、打鍵のたびに導く＝語彙も共起の候補も、そこまでに
      // 積まれたものに依存する。
      pickerData: (tags: string[]) => deps.inspectorTagPickerData(tags, records, 'post'),
      tagLabels: {
        tagsLabel: deps.t('detailTags'),
        newTagPlaceholder: deps.t('tagNewName'),
        addBtn: deps.t('tagAddBtn'),
        noTags: deps.t('editNoTags'),
        noMatch: deps.t('tagPalNoMatch'),
        noVocab: deps.t('tagNoTags'),
        adoptSource: deps.t('editAdoptSource'),
        removeTag: deps.t('tagRemove'),
      },
      labels: {
        title: deps.t('tagSelected'),
        additiveHint: deps.t('additiveHint'),
        apply: deps.t('tagApplyN', [records.length]),
        cancel: deps.t('confirmCancel'),
      },
      onKindMenu: (tag, x, y, onChange) => deps.showKindMenu(tag, x, y, onChange),
      // `records` を開いた時点で捕まえるのは意図してのこと。ダイアログはモーダルなので、
      // それが「$1 件に適用」で名指す選択は、出ている間は変わりようがない。
      onApply: (tags) => void applyTagsToSelection(records, tags),
    });
  }

  return {
    openBulkTagDialog,
  };
}

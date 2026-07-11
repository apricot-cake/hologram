// Date/engagement/poster-date-range popover builder — extracted from viewer.ts
// as the viewer.ts decomposition's V4 slice (see memory
// corpus-react-purity-execution-map, Wave18/V4 "フィルタフライアウト・日付/エンゲージ
// ポップオーバー"). The glass popup itself (open/close/get/subscribe) already
// lives in filter-popover.ts (Wave4) — this module is the view-specific glue
// that used to live inline in viewer.ts: which leaf (if any) is being edited,
// building the field model, and the apply/remove actions. postQB/posterQB are
// still owned by viewer.ts, so the handful of mutations each popover needs are
// injected as deps — same ctx pattern as query-builder.ts/kind-menu-builder.ts.
//
// 日付/エンゲージのポップオーバーは値フライアウト(qf-pop)と同じ「行クリックで開閉・
// 外側クリックで閉じる」挙動に統一する。旧実装は全画面 .qf-backdrop(z999) が
// クリックを奪い、開いている間は他の行へワンクリックで切り替えられなかった
// （クリックが backdrop に吸われて closeAll するだけ＝ユーザー報告のバグ）。
// backdrop は撤去し、行ハンドラ（viewer.ts側）+ 本モジュールの開閉のみで開閉する。
import { treeLeaves } from './query.ts';
import { open as filterPopoverOpen, close as filterPopoverClose } from './filter-popover.ts';

export interface FilterPopoverDeps {
  MSG: { [k: string]: any };
  engTypeLabels: Record<string, string>;
  addFilter(filter: { type: string; [k: string]: any }): void;
  removeNode(node: CorpusQueryLeaf): void;
  removeCondsMatching(pred: (c: CorpusQueryLeaf) => boolean): void;
  afterQueryChange(): void;
  posterGetTree(): CorpusQueryGroup;
  posterAddFilter(filter: { type: string; [k: string]: any }): void;
  posterRemoveByType(type: string): void;
  posterRefresh(): void;
}

export function makeFilterPopover(deps: FilterPopoverDeps) {
  function closeAll() {
    filterPopoverClose();
  }

  // Date popover. editingDateNode = the date cond being edited (null = new).
  let editingDateNode: CorpusQueryLeaf | null = null;

  function openDate(node: CorpusQueryLeaf | null) {
    closeAll(); // close the other popover if open (no backdrop anymore)
    editingDateNode = node || null;
    const existing = editingDateNode;
    const anchor = document.querySelector('#filterRows [data-qfrow="date"]') as HTMLElement;
    const r = anchor.getBoundingClientRect();
    filterPopoverOpen({
      kind: 'date',
      anchorRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      editing: !!editingDateNode,
      fields: { dateField: existing?.dateField || 'date', from: existing?.from || '', to: existing?.to || '' },
      labels: { typeDate: deps.MSG.qfDatePost, typeCaptured: deps.MSG.qfDateCaptured, removeLabel: deps.MSG.qfDelete, applyLabel: deps.MSG.qfApply },
      onApply({ dateField, from, to }: { dateField?: string; from?: string; to?: string }) {
        if (!from && !to) return;
        if (editingDateNode) {
          Object.assign(editingDateNode, { dateField, from, to });
          deps.afterQueryChange();
        } // edit in place (keeps its position / group in the tree)
        else deps.addFilter({ type: 'date', dateField, from, to }); // replaces any existing date
      },
      onRemove() {
        if (editingDateNode) deps.removeNode(editingDateNode);
      },
    });
  }

  // Poster date-range popover (3 dims: 最終投稿日 / 最終取得日 / アカウント作成日).
  // Separate from the post date popover — writes the transient posterDate state.
  // arg = the date leaf to edit (from openLeafEditor) OR the row element (from the row click).
  // Range only — the 並べ替え方向 moved to the sort select (フィルタとソートの分離).
  let editingPosterDateNode: CorpusQueryLeaf | null = null;

  function openPosterDate(arg: any) {
    closeAll();
    const editNode = arg && arg.kind === 'cond' ? arg : null;
    editingPosterDateNode = editNode;
    const anchor = document.querySelector('#posterFilterRows [data-qfrow="poster-date"]') as HTMLElement;
    if (!anchor) return;
    const existing = editNode || treeLeaves(deps.posterGetTree()).find((c) => c.type === 'date');
    const r = anchor.getBoundingClientRect();
    filterPopoverOpen({
      kind: 'posterDate',
      anchorRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      editing: !!existing,
      fields: { dateField: (existing && existing.dateField) || 'latest', from: (existing && existing.from) || '', to: (existing && existing.to) || '' },
      labels: { dimLabel: deps.MSG.posterDateDimLabel, rangeLabel: deps.MSG.posterDateRangeLabel, removeLabel: deps.MSG.posterDateClear, applyLabel: deps.MSG.qfApply },
      dimOptions: [
        { value: 'latest', label: deps.MSG.posterDateLastPost },
        { value: 'lastCapture', label: deps.MSG.posterDateLastCapture },
        { value: 'authorCreatedAt', label: deps.MSG.posterDateCreated },
      ],
      onApply({ dateField, from, to }: { dateField?: string; from?: string; to?: string }) {
        if (!from && !to) return;
        if (editingPosterDateNode) {
          Object.assign(editingPosterDateNode, { dateField, from, to });
          deps.posterRefresh();
        } else deps.posterAddFilter({ type: 'date', dateField, from, to }); // date is single-valued (replaces)
      },
      onRemove() {
        deps.posterRemoveByType('date');
      },
    });
  }

  // Engagement popover. editingEngNode = the engagement cond being edited (null = new).
  let editingEngNode: CorpusQueryLeaf | null = null;

  function openEng(node: CorpusQueryLeaf | null) {
    closeAll(); // close the other popover if open (no backdrop anymore)
    editingEngNode = node || null;
    const existing = editingEngNode;
    const anchor = document.querySelector('#filterRows [data-qfrow="engagement"]') as HTMLElement;
    const r = anchor.getBoundingClientRect();
    filterPopoverOpen({
      kind: 'eng',
      anchorRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      editing: !!editingEngNode,
      fields: { engType: existing?.engType || 'likes', min: existing?.min || '', op: existing?.op || 'gte' },
      labels: { removeLabel: deps.MSG.qfDelete, applyLabel: deps.MSG.qfApply, opGte: deps.MSG.qfEngGte, opLte: deps.MSG.qfEngLte },
      typeOptions: Object.entries(deps.engTypeLabels).map(([value, label]) => ({ value, label })),
      onApply({ engType, min, op }: { engType?: string; min?: string | number; op?: string }) {
        if (!min || Number(min) <= 0) return;
        if (editingEngNode) {
          Object.assign(editingEngNode, { engType, min, op });
          deps.afterQueryChange();
        } // edit in place (keeps its position / group in the tree)
        else {
          deps.removeCondsMatching((c) => c.type === 'engagement' && c.engType === engType); // no gte+lte on one type
          deps.addFilter({ type: 'engagement', engType, min, op });
        }
      },
      onRemove() {
        if (editingEngNode) deps.removeNode(editingEngNode);
      },
    });
  }

  return { closeAll, openDate, openPosterDate, openEng };
}

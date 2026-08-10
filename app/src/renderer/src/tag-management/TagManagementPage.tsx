// タグ管理ページ（#21）＝設計の 2026-07-18/07-19/07-23 のコメントで確定した、タブの帯
// から開く行き先。語彙を手入れするための2ペインの画面（左: 表示の切り替え＝すべて／未分類／
// 孤立／親タグ、右: 一覧表）で、tabs-builder.ts の openTagManagementTab から開く（タグの
// 絞り込みフライアウトの足元のリンク。配線は orchestrator.ts と filterbar）。
//
// 範囲についての注記（2026-08-02）: ここで出すのは改名（確定した2方向の衝突分岐つき）・
// 統合・親タグの CRUD（循環を検査する）・孤立タグの掃除・種別メニューの使い回し＝
// 書き込み側の設計。問い合わせ時に親子関係を効かせること（親タグでの検索を、子タグの
// 付いた投稿まで広げる。ファセット・共起・提案のすべてにわたって）はまだやっていない。
// それは読み取り経路のもっと大きな変更（アプリ内のタグを読むところすべてを、生の tagId
// から計算した閉包へ切り替える必要がある）で、後続として追っている。ページ内のヒント
// （tagMgmtHint）もそう書いてある。ここで実際以上のことを言っているものは無い。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { t } from '../_shared/i18n.ts';
import { hologramIpc } from '../services/ipc.ts';
import { open as kindMenuOpen } from '../services/kind-menu.ts';
import { getTagLabels } from '../services/tags.ts';
import { open as confirmOpen } from '../services/confirm.ts';
import { notify } from '../services/ui.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { includesNormalized } from '../services/search.ts';
import { TagSplitDialog } from './TagSplitDialog.tsx';
import { TagAliasDialog } from './TagAliasDialog.tsx';
import type { TagAliasRow, TagParentRowResolved, TagVocabRow } from '../../../main/ipc-payloads.ts';

type ViewKey = 'all' | 'unclassified' | 'orphan' | 'parents';

function kindLabel(kind: string): string {
  if (!kind) return t('kindGeneral');
  const labels = getTagLabels();
  return (labels && labels[kind]) || (kind === 'work' ? t('kindWork') : kind === 'character' ? t('kindCharacter') : kind);
}

// 改名の衝突ダイアログ。既存の実体へ統合するか、表示用の親タグを必須にしたうえで
// 同名の別タグとして残すか＝確定した2方向の分岐（2026-07-18 のコメントの項目2）。
function RenameCollisionDialog({
  open,
  collision,
  allTags,
  onMerge,
  onKeepSeparate,
  onClose,
}: {
  open: boolean;
  collision: { tagId: number; name: string; postCount: number; posterCount: number; oldName: string } | null;
  allTags: TagVocabRow[];
  onMerge: (keepOldNameAsAlias: boolean) => void;
  onKeepSeparate: (parentTagId: number) => void;
  onClose: () => void;
}) {
  // リセットは effect ではなく載せ直しで行う。呼び出し側がこのコンポーネントの key に
  // collision?.tagId を取っている（下）ので、別の衝突なら必ずローカル状態が新しくなる。
  const [parentId, setParentId] = useState<string>('');
  // #86: 意味を持つのは統合の分岐だけ（keepSeparate は両方の名前を実体のあるタグとして
  // 残す＝別名にするものが無い）。
  const [keepOldName, setKeepOldName] = useState(false);
  if (!collision) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tagMgmtRenameCollisionTitle')}</DialogTitle>
          <DialogDescription>{t('tagMgmtRenameCollisionDesc', [collision.name, collision.postCount, collision.posterCount])}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 py-2">
          <label className="text-sm font-medium" htmlFor="tag-mgmt-keep-separate-parent">
            {t('tagMgmtKeepSeparateParentLabel')}
          </label>
          <select id="tag-mgmt-keep-separate-parent" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t('tagMgmtKeepSeparateParentPh')}</option>
            {allTags.map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName}
              </option>
            ))}
          </select>
          {collision.oldName && collision.oldName !== collision.name && (
            <label className="flex items-center gap-1.5 pt-1 text-sm">
              <Checkbox checked={keepOldName} onCheckedChange={(v) => setKeepOldName(!!v)} />
              {t('tagMgmtKeepOldNameAsAlias', [collision.oldName])}
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('tagMgmtCancel')}
          </Button>
          <Button variant="outline" disabled={!parentId} onClick={() => parentId && onKeepSeparate(Number(parentId))}>
            {t('tagMgmtKeepSeparateConfirm')}
          </Button>
          <Button onClick={() => onMerge(keepOldName)}>{t('tagMgmtMergeBtn')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NameCell({ row, onRename }: { row: TagVocabRow; onRename: (tagId: number, name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.name);
  useEffect(() => {
    setValue(row.name);
  }, [row.name]);
  if (!editing) {
    return (
      <button type="button" className="max-w-full truncate text-left hover:underline" title={row.displayName} onClick={() => setEditing(true)}>
        {row.displayName}
      </button>
    );
  }
  return (
    <Input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setValue(row.name);
          setEditing(false);
        } else if (e.key === 'Enter') {
          setEditing(false);
          if (value.trim() && value.trim() !== row.name) onRename(row.id, value.trim());
        }
      }}
      className="h-7 px-1 py-0"
    />
  );
}

export function TagManagementPage() {
  const [rows, setRows] = useState<TagVocabRow[] | null>(null);
  const [edges, setEdges] = useState<TagParentRowResolved[] | null>(null);
  const [aliases, setAliases] = useState<TagAliasRow[] | null>(null);
  const [view, setView] = useState<ViewKey>('all');
  const [query, setQuery] = useState('');
  const [selectedOrphans, setSelectedOrphans] = useState<Set<number>>(new Set());
  const [collision, setCollision] = useState<{ tagId: number; name: string; postCount: number; posterCount: number; renamedTagId: number; oldName: string } | null>(null);
  const [splitTagRow, setSplitTagRow] = useState<{ id: number; name: string } | null>(null);
  const [aliasTagRow, setAliasTagRow] = useState<{ id: number; name: string } | null>(null);
  const [addChild, setAddChild] = useState('');
  const [addParent, setAddParent] = useState('');
  const [addDisplay, setAddDisplay] = useState(false);

  const refresh = useCallback(async () => {
    const [v, e, a] = await Promise.all([hologramIpc.getTagVocab(), hologramIpc.getTagParentEdges(), hologramIpc.getTagAliases()]);
    setRows(v);
    setEdges(e);
    setAliases(a);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // #86: 別名の行を正規のタグ id ごとにまとめる。一覧表の「別名」列のためのもので、
  // 1つの索きを全行のセルで共有する。
  const aliasesByTag = useMemo(() => {
    const m = new Map<number, TagAliasRow[]>();
    for (const a of aliases || []) {
      const list = m.get(a.tagId);
      if (list) list.push(a);
      else m.set(a.tagId, [a]);
    }
    return m;
  }, [aliases]);

  const removeAlias = useCallback(
    (row: TagAliasRow) => {
      confirmOpen({
        message: t('tagMgmtAliasRemoveConfirm', [row.alias]),
        okLabel: t('tagMgmtDelete'),
        cancelLabel: t('tagMgmtCancel'),
        async onOk() {
          await hologramIpc.removeTagAlias(row.id);
          refresh();
        },
      });
    },
    [refresh],
  );

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    let base = rows;
    if (view === 'unclassified') base = base.filter((r) => r.postCount > 0 && !r.kind);
    else if (view === 'orphan') base = base.filter((r) => r.isOrphan);
    if (!query.trim()) return base;
    return base.filter((r) => includesNormalized(r.displayName, query) || includesNormalized(r.name, query));
  }, [rows, view, query]);

  const handleRename = useCallback(
    async (tagId: number, name: string) => {
      // #86: この試行の前の行の名前。renameTag は衝突を報告する時に新しい名前を
      // 適用しない（lib-db-tag-vocab.ts）ので、行はまだ元の名前を持っている。
      //「旧名を別名として残す」のチェックボックスのためにここで押さえておく。
      const oldName = rows?.find((r) => r.id === tagId)?.name ?? '';
      const result = await hologramIpc.renameTag(tagId, name);
      if (result.ok) {
        refresh();
        return;
      }
      if ('collision' in result) {
        setCollision({ ...result.collision, renamedTagId: tagId, oldName });
      } else {
        notify(t('tagMgmtErrorGeneric'));
      }
    },
    [rows, refresh],
  );

  const handleMerge = useCallback(
    async (keepOldNameAsAlias: boolean) => {
      if (!collision) return;
      const res = await hologramIpc.mergeTags(collision.renamedTagId, collision.tagId, keepOldNameAsAlias);
      setCollision(null);
      if (!res.ok) notify(t('tagMgmtErrorGeneric'));
      refresh();
    },
    [collision, refresh],
  );

  const handleKeepSeparate = useCallback(
    async (parentTagId: number) => {
      if (!collision) return;
      const res = await hologramIpc.keepSeparateRenameTag(collision.renamedTagId, collision.name, parentTagId);
      setCollision(null);
      if (!res.ok) notify(res.error === 'cycle' ? t('tagMgmtCycleError') : t('tagMgmtErrorGeneric'));
      refresh();
    },
    [collision, refresh],
  );

  const openKindMenu = useCallback(
    (row: TagVocabRow, e: React.MouseEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const rowFn = (k: string, label: string) => ({ kind: k, label, dot: !!k, checked: (k || null) === (row.kind || null) });
      kindMenuOpen({
        x: rect.left,
        y: rect.bottom + 4,
        header: t('tagKindHeader'),
        renameTitle: '',
        rows: [rowFn('work', kindLabel('work')), rowFn('character', kindLabel('character')), { sep: true }, rowFn('', t('kindGeneral'))],
        async onPick(kind: string) {
          if ((row.kind || '') === kind) return;
          await hologramIpc.setTagKind(row.id, kind || null);
          refresh();
        },
        onRename() {
          /* 作品・キャラのラベルを全体で改名する操作は、アプリの他所にある既存の
             種別メニューの画面が持っている（kind-menu-builder.ts）＝ここには重複させない */
        },
      });
    },
    [refresh],
  );

  const toggleOrphan = (id: number) => {
    setSelectedOrphans((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteSelectedOrphans = useCallback(async () => {
    const ids = [...selectedOrphans];
    if (!ids.length) return;
    confirmOpen({
      message: t('tagMgmtOrphanDeleteConfirm', [ids.length]),
      okLabel: t('tagMgmtDelete'),
      cancelLabel: t('tagMgmtCancel'),
      async onOk() {
        await hologramIpc.deleteOrphanTags(ids);
        setSelectedOrphans(new Set());
        refresh();
      },
    });
  }, [selectedOrphans, refresh]);

  const handleAddParent = useCallback(async () => {
    if (!addChild || !addParent) return;
    const res = await hologramIpc.addTagParent(Number(addChild), Number(addParent), addDisplay);
    if (!res.ok) {
      notify(res.error === 'cycle' ? t('tagMgmtCycleError') : t('tagMgmtErrorGeneric'));
      return;
    }
    setAddChild('');
    setAddParent('');
    setAddDisplay(false);
    refresh();
  }, [addChild, addParent, addDisplay, refresh]);

  const removeParentEdge = useCallback(
    (tagId: number, parentTagId: number) => {
      confirmOpen({
        message: t('tagMgmtParentsRemoveConfirm'),
        okLabel: t('tagMgmtParentsDelete'),
        cancelLabel: t('tagMgmtCancel'),
        async onOk() {
          await hologramIpc.removeTagParent(tagId, parentTagId);
          refresh();
        },
      });
    },
    [refresh],
  );

  const views: { key: ViewKey; label: string }[] = [
    { key: 'all', label: t('tagMgmtViewAll') },
    { key: 'unclassified', label: t('tagMgmtViewUnclassified') },
    { key: 'orphan', label: t('tagMgmtViewOrphan') },
    { key: 'parents', label: t('tagMgmtViewParents') },
  ];

  if (rows === null || edges === null) {
    return <div className="p-6 text-sm text-muted-foreground">{t('tagMgmtLoading')}</div>;
  }

  return (
    <div className="flex h-full min-h-0 gap-4">
      <nav className="w-44 shrink-0 border-r border-border pr-3">
        <ul className="flex flex-col gap-0.5">
          {views.map((v) => (
            <li key={v.key}>
              <button type="button" onClick={() => setView(v.key)} className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${view === v.key ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}>
                {v.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {view !== 'parents' ? (
          <>
            <div className="flex items-center gap-2">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('tagMgmtSearchPh')} className="max-w-xs" />
              {view === 'orphan' && (
                <Button variant="destructive" size="sm" disabled={!selectedOrphans.size} onClick={deleteSelectedOrphans} className="ml-auto">
                  <Trash2 className="size-4" /> {t('tagMgmtOrphanDeleteBtn')} ({selectedOrphans.size})
                </Button>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                  <tr>
                    {view === 'orphan' && <th className="w-8 p-2" />}
                    <th className="p-2 text-left">{t('tagMgmtColName')}</th>
                    <th className="p-2 text-left">{t('tagMgmtColKind')}</th>
                    <th className="p-2 text-right">{t('tagMgmtColPosts')}</th>
                    <th className="p-2 text-right">{t('tagMgmtColPosters')}</th>
                    <th className="p-2 text-left">{t('tagMgmtColParent')}</th>
                    <th className="p-2 text-left">{t('tagMgmtColAliases')}</th>
                    <th className="w-8 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-muted-foreground">
                        {view === 'orphan' ? t('tagMgmtOrphanEmpty') : t('tagMgmtEmpty')}
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((row) => {
                    const displayParent = row.parents.find((p) => p.isDisplay);
                    const rowAliases = aliasesByTag.get(row.id) || [];
                    return (
                      <tr key={row.id} className="border-t border-border hover:bg-accent/30">
                        {view === 'orphan' && (
                          <td className="p-2">
                            <Checkbox checked={selectedOrphans.has(row.id)} onCheckedChange={() => toggleOrphan(row.id)} />
                          </td>
                        )}
                        <td className="max-w-[22rem] truncate p-2">
                          <NameCell row={row} onRename={handleRename} />
                        </td>
                        <td className="p-2">
                          <button type="button" className="rounded px-1.5 py-0.5 text-xs hover:bg-accent" onClick={(e) => openKindMenu(row, e)}>
                            {kindLabel(row.kind || '')}
                          </button>
                        </td>
                        <td className="p-2 text-right tabular-nums">{row.postCount}</td>
                        <td className="p-2 text-right tabular-nums">{row.posterCount}</td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:underline"
                            onClick={() => {
                              setView('parents');
                              setAddChild(String(row.id));
                            }}
                          >
                            {displayParent ? displayParent.name : t('tagMgmtSetParent')}
                          </button>
                        </td>
                        <td className="max-w-[16rem] p-2">
                          {rowAliases.length === 0 ? (
                            <span className="text-xs text-muted-foreground">{t('tagMgmtAliasNone')}</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {rowAliases.map((a) => (
                                <span key={a.id} className="inline-flex h-5 items-center gap-1 rounded-4xl bg-secondary px-2 text-xs font-medium text-secondary-foreground">
                                  {a.alias}
                                  <button type="button" className="-mr-0.5 cursor-pointer rounded-full text-muted-foreground hover:text-foreground" aria-label={t('tagMgmtAliasRemoveLabel')} onClick={() => removeAlias(a)}>
                                    <X className="size-3" aria-hidden="true" />
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="p-2 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="ghost" size="icon-sm" aria-label={t('tagMgmtRowMenuLabel')}>
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setAliasTagRow({ id: row.id, name: row.name })}>{t('tagMgmtAddAliasMenuItem')}</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setSplitTagRow({ id: row.id, name: row.name })}>{t('tagMgmtSplitMenuItem')}</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="text-xs text-muted-foreground">{t('tagMgmtHint')}</div>
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="tag-mgmt-add-child">
                  {t('tagMgmtParentsChild')}
                </label>
                <select id="tag-mgmt-add-child" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={addChild} onChange={(e) => setAddChild(e.target.value)}>
                  <option value="" />
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="tag-mgmt-add-parent">
                  {t('tagMgmtParentsParent')}
                </label>
                <select id="tag-mgmt-add-parent" className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={addParent} onChange={(e) => setAddParent(e.target.value)}>
                  <option value="" />
                  {rows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 pb-1.5 text-sm">
                <Checkbox checked={addDisplay} onCheckedChange={(v) => setAddDisplay(!!v)} />
                {t('tagMgmtParentsDisplay')}
              </label>
              <Button size="sm" disabled={!addChild || !addParent} onClick={handleAddParent}>
                <Plus className="size-4" /> {t('tagMgmtParentsAddBtn')}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left">{t('tagMgmtParentsChild')}</th>
                    <th className="p-2 text-left">{t('tagMgmtParentsParent')}</th>
                    <th className="p-2 text-left">{t('tagMgmtParentsDisplay')}</th>
                    <th className="w-16 p-2" />
                  </tr>
                </thead>
                <tbody>
                  {edges.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-muted-foreground">
                        {t('tagMgmtParentsEmpty')}
                      </td>
                    </tr>
                  )}
                  {edges.map((edge) => (
                    <tr key={`${edge.tagId}-${edge.parentTagId}`} className="border-t border-border hover:bg-accent/30">
                      <td className="p-2">{edge.tagName}</td>
                      <td className="p-2">{edge.parentName}</td>
                      <td className="p-2">{edge.isDisplay ? '✓' : ''}</td>
                      <td className="p-2 text-right">
                        <Button variant="ghost" size="icon-sm" aria-label={t('tagMgmtParentsDelete')} onClick={() => removeParentEdge(edge.tagId, edge.parentTagId)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <RenameCollisionDialog key={collision?.tagId ?? 'none'} open={!!collision} collision={collision} allTags={rows} onMerge={handleMerge} onKeepSeparate={handleKeepSeparate} onClose={() => setCollision(null)} />
      {splitTagRow && <TagSplitDialog key={splitTagRow.id} tagId={splitTagRow.id} tagName={splitTagRow.name} allTags={rows} onClose={() => setSplitTagRow(null)} onDone={refresh} />}
      {aliasTagRow && <TagAliasDialog key={aliasTagRow.id} tagId={aliasTagRow.id} tagName={aliasTagRow.name} onClose={() => setAliasTagRow(null)} onDone={refresh} />}
    </div>
  );
}

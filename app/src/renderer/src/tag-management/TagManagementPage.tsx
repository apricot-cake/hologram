// Tag management page (#21) -- the tab-strip destination the design's
// 2026-07-18/07-19/07-23 comments confirm: a 2-pane vocabulary maintenance
// surface (left: view -- all/unclassified/orphaned/parent tags, right: the
// overview table), opened via tabs-builder.ts's openTagManagementTab (footer
// link in the tag filter flyout, wired in orchestrator.ts / filterbar).
//
// Scope note (2026-08-02): this ships rename (with the confirmed 2-way
// collision branch), merge, parent-tag CRUD (cycle-checked), orphan cleanup,
// and the kind-menu reuse -- the write-side design. It does NOT yet apply
// parent relationships at query time (expanding a search for the parent tag
// to include child-tagged posts, across facets/cooc/suggestions) -- that is
// a much larger read-path change (every tag reader in the app would need to
// switch from raw tagIds to a computed closure) tracked as a follow-up. The
// in-page hint (tagMgmtHint) says so; nothing here overclaims it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { includesNormalized } from '../services/search.ts';
import type { TagParentRowResolved, TagVocabRow } from '../../../main/ipc-payloads.ts';

type ViewKey = 'all' | 'unclassified' | 'orphan' | 'parents';

function kindLabel(kind: string): string {
  if (!kind) return t('kindGeneral');
  const labels = getTagLabels();
  return (labels && labels[kind]) || (kind === 'work' ? t('kindWork') : kind === 'character' ? t('kindCharacter') : kind);
}

// The rename-collision dialog: merge into the existing entity, or keep this
// one as a separate (same-name) tag with a required display parent -- the
// confirmed 2-way branch (2026-07-18 comment item 2).
function RenameCollisionDialog({ open, collision, allTags, onMerge, onKeepSeparate, onClose }: { open: boolean; collision: { tagId: number; name: string; postCount: number; posterCount: number } | null; allTags: TagVocabRow[]; onMerge: () => void; onKeepSeparate: (parentTagId: number) => void; onClose: () => void }) {
  // Reset via remount, not an effect: the caller keys this component on
  // collision?.tagId (below), so a NEW collision always gets fresh local state.
  const [parentId, setParentId] = useState<string>('');
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('tagMgmtCancel')}
          </Button>
          <Button variant="outline" disabled={!parentId} onClick={() => parentId && onKeepSeparate(Number(parentId))}>
            {t('tagMgmtKeepSeparateConfirm')}
          </Button>
          <Button onClick={onMerge}>{t('tagMgmtMergeBtn')}</Button>
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
  const [view, setView] = useState<ViewKey>('all');
  const [query, setQuery] = useState('');
  const [selectedOrphans, setSelectedOrphans] = useState<Set<number>>(new Set());
  const [collision, setCollision] = useState<{ tagId: number; name: string; postCount: number; posterCount: number; renamedTagId: number } | null>(null);
  const [addChild, setAddChild] = useState('');
  const [addParent, setAddParent] = useState('');
  const [addDisplay, setAddDisplay] = useState(false);

  const refresh = useCallback(async () => {
    const [v, e] = await Promise.all([hologramIpc.getTagVocab(), hologramIpc.getTagParentEdges()]);
    setRows(v);
    setEdges(e);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
      const result = await hologramIpc.renameTag(tagId, name);
      if (result.ok) {
        refresh();
        return;
      }
      if ('collision' in result) {
        setCollision({ ...result.collision, renamedTagId: tagId });
      } else {
        notify(t('tagMgmtErrorGeneric'));
      }
    },
    [refresh],
  );

  const handleMerge = useCallback(async () => {
    if (!collision) return;
    const res = await hologramIpc.mergeTags(collision.renamedTagId, collision.tagId);
    setCollision(null);
    if (!res.ok) notify(t('tagMgmtErrorGeneric'));
    refresh();
  }, [collision, refresh]);

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
          /* the global work/character label rename lives on the existing kind-menu
             surfaces elsewhere in the app (kind-menu-builder.ts) -- not duplicated here */
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
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-muted-foreground">
                        {view === 'orphan' ? t('tagMgmtOrphanEmpty') : t('tagMgmtEmpty')}
                      </td>
                    </tr>
                  )}
                  {filteredRows.map((row) => {
                    const displayParent = row.parents.find((p) => p.isDisplay);
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
    </div>
  );
}

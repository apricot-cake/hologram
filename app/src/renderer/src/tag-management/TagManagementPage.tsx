import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Triangle } from 'lucide-react';
import { t } from '../_shared/i18n.ts';
import { hologramIpc } from '../services/ipc.ts';
import { promptName } from '../prompt/Prompt.tsx';
import { open as confirmOpen } from '../services/confirm.ts';
import { notify } from '../services/ui.ts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { includesNormalized } from '../services/search.ts';
import type { TagVocabRow, TagGroupsState } from '../../../main/ipc-payloads.ts';

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

type SortColumn = 'name' | 'postCount' | 'posterCount';

const reportError = () => notify(t('tagMgmtErrorGeneric'));

export function TagManagementPage() {
  const [rows, setRows] = useState<TagVocabRow[]>([]);
  const [groups, setGroups] = useState<TagGroupsState>({ memberships: [], labels: {} });
  const [view, setView] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ column: SortColumn; ascending: boolean }>({ column: 'name', ascending: true });
  const [loaded, setLoaded] = useState(false);
  const [collision, setCollision] = useState<{ tagId: number; name: string; postCount: number; posterCount: number; sourceId: number } | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [vocab, state] = await Promise.all([hologramIpc.getTagVocab(), hologramIpc.getTagGroups()]);
      setRows(vocab);
      setGroups(state);
      setLoaded(true);
    } catch {
      reportError();
    }
  }, []);
  useEffect(() => {
    void refresh();
    return hologramIpc.onOrgChanged((groupId) => {
      if (groupId === 'tag-groups') void refresh();
    });
  }, [refresh]);
  const saveGroups = async (next: TagGroupsState) => {
    const result = await hologramIpc.setTagGroups(next.memberships, next.labels);
    if (!result.ok) throw new Error('save failed');
    await refresh();
  };
  const createGroup = () =>
    promptName(t('tagGroupCreate'), '', async (name) => {
      try {
        const id = crypto.randomUUID();
        const current = await hologramIpc.getTagGroups();
        await saveGroups({ ...current, labels: { ...current.labels, [id]: name } });
        setView('group:' + id);
      } catch {
        reportError();
      }
    });
  const groupId = view.startsWith('group:') ? view.slice(6) : null;
  const renameGroup = () =>
    groupId &&
    promptName(t('tagGroupRename'), groups.labels?.[groupId] || '', async (name) => {
      try {
        const current = await hologramIpc.getTagGroups();
        await saveGroups({ ...current, labels: { ...current.labels, [groupId]: name } });
      } catch {
        reportError();
      }
    });
  const deleteGroup = () =>
    groupId &&
    confirmOpen({
      message: t('tagGroupDeleteConfirm', { name: groups.labels?.[groupId] || '' }),
      okLabel: t('tagMgmtDelete'),
      cancelLabel: t('tagMgmtCancel'),
      async onOk() {
        try {
          const current = await hologramIpc.getTagGroups();
          const labels = { ...current.labels };
          delete labels[groupId];
          await saveGroups({ memberships: current.memberships.filter((row) => row.groupId !== groupId), labels });
          setView('all');
        } catch {
          reportError();
        }
      },
    });
  const rename = async (id: number, name: string) => {
    try {
      const result = await hologramIpc.renameTag(id, name);
      if (result.ok) await refresh();
      else if ('collision' in result) {
        setCollision({ ...result.collision, sourceId: id });
      } else reportError();
    } catch {
      reportError();
    }
  };
  const filtered = rows.filter((row) => (view === 'all' || (view === 'unclassified' && !row.groupId) || (groupId && row.groupId === groupId)) && includesNormalized(row.name, query));
  filtered.sort((a, b) => {
    const compared = sort.column === 'name' ? a.name.localeCompare(b.name, 'ja', { numeric: true }) : a[sort.column] - b[sort.column];
    return (sort.ascending ? compared : -compared) || a.name.localeCompare(b.name, 'ja', { numeric: true }) || a.id - b.id;
  });
  const sortHeader = (column: SortColumn, label: string) => {
    const active = sort.column === column;
    return (
      <th scope="col" aria-sort={active ? (sort.ascending ? 'ascending' : 'descending') : undefined} className="p-2">
        <button type="button" className="flex items-center gap-1 rounded text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setSort({ column, ascending: active ? !sort.ascending : true })}>
          {label}
          <span className="inline-flex w-3.5 flex-col items-center gap-0.5" aria-hidden="true">
            <Triangle className={'h-[7px] w-2 fill-current stroke-1 ' + (active && sort.ascending ? 'text-foreground' : 'text-muted-foreground/55')} />
            <Triangle className={'h-[7px] w-2 rotate-180 fill-current stroke-1 ' + (active && !sort.ascending ? 'text-foreground' : 'text-muted-foreground/55')} />
          </span>
        </button>
      </th>
    );
  };
  const nav = (id: string, name: string, count: number) => (
    <button
      key={id}
      type="button"
      aria-current={view === id ? 'true' : undefined}
      onClick={() => setView(id)}
      className={
        'flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
        (view === id ? 'bg-[var(--sidebar-active)] font-medium text-sidebar-accent-foreground' : 'text-[var(--sidebar-item-foreground)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground')
      }
    >
      <span className="truncate">{name}</span>
      <span className="ml-2 text-xs font-normal text-muted-foreground">{count}</span>
    </button>
  );
  return (
    <div className="flex h-full min-h-0" data-testid="tag-management">
      <aside className="w-52 shrink-0 overflow-y-auto border-r p-3">
        {nav('all', t('tagMgmtViewAll'), rows.length)}
        {nav('unclassified', t('tagMgmtViewUngrouped'), rows.filter((r) => !r.groupId).length)}
        <div className="mt-5 flex items-center justify-between px-3 text-sm text-muted-foreground">
          <span>{t('tagGroups')}</span>
          <Button variant="ghost" size="icon" title={t('tagGroupCreate')} onClick={createGroup}>
            <Plus className="size-4" />
          </Button>
        </div>
        {Object.entries(groups.labels || {}).map(([id, name]) => nav('group:' + id, name, rows.filter((r) => r.groupId === id).length))}
      </aside>
      <section className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mb-4 flex items-center gap-2">
          <Input className="max-w-sm" placeholder={t('tagMgmtSearchPh')} value={query} onChange={(e) => setQuery(e.target.value)} />
          {groupId && (
            <>
              <Button variant="outline" onClick={renameGroup}>
                {t('tagGroupRename')}
              </Button>
              <Button variant="ghost" title={t('tagGroupDelete')} onClick={deleteGroup}>
                <Trash2 className="size-4" />
              </Button>
            </>
          )}
        </div>
        <div className="min-h-0 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                {sortHeader('name', t('tagMgmtColName'))}
                <th scope="col" className="p-2">
                  {t('tagGroupHeader')}
                </th>
                {sortHeader('postCount', t('tagMgmtColPosts'))}
                {sortHeader('posterCount', t('tagMgmtColPosters'))}
                <th className="p-2">{t('tagMgmtActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="p-2">
                    <NameCell row={row} onRename={rename} />
                  </td>
                  <td className="p-2">
                    <select
                      aria-label={t('tagGroupHeader')}
                      className="max-w-44 rounded border border-input bg-background px-2 py-1"
                      value={row.groupId || ''}
                      onChange={async (e) => {
                        try {
                          const result = await hologramIpc.setTagGroup(row.id, e.target.value || null);
                          if (!result.ok) reportError();
                          await refresh();
                        } catch {
                          reportError();
                        }
                      }}
                    >
                      <option value="">{t('tagMgmtViewUnclassified')}</option>
                      {Object.entries(groups.labels || {}).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">{row.postCount}</td>
                  <td className="p-2">{row.posterCount}</td>
                  <td>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="bg-transparent hover:bg-destructive/10 dark:bg-transparent dark:hover:bg-destructive/20"
                      title={t('tagMgmtDelete')}
                      onClick={() =>
                        confirmOpen({
                          message: t('tagMgmtDeleteConfirm', { name: row.name }),
                          okLabel: t('tagMgmtDelete'),
                          cancelLabel: t('tagMgmtCancel'),
                          async onOk() {
                            try {
                              const result = await hologramIpc.deleteTags([row.id]);
                              if (!result.ok) throw new Error('delete failed');
                              await refresh();
                            } catch {
                              reportError();
                            }
                          },
                        })
                      }
                    >
                      {t('tagMgmtDelete')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p className="p-4 text-sm text-muted-foreground">{t(loaded ? 'tagMgmtEmpty' : 'tagMgmtLoading')}</p>}
        </div>
      </section>
      {collision && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCollision(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('tagMgmtRenameCollisionTitle')}</DialogTitle>
              <DialogDescription>{t('tagMgmtRenameCollisionDesc', collision)}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCollision(null)}>
                {t('tagMgmtCancel')}
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const result = await hologramIpc.mergeTags(collision.sourceId, collision.tagId);
                    if (!result.ok) reportError();
                    setCollision(null);
                    await refresh();
                  } catch {
                    reportError();
                  }
                }}
              >
                {t('tagMgmtMergeBtn')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

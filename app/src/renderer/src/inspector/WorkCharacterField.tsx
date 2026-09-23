import { useEffect, useState } from 'react';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandItem } from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import type { TagVocabRow } from '../../../main/ipc-payloads.ts';
import type { TagAssignment } from '../../../shared/tag-classification.ts';
import { hologramIpc } from '../services/ipc.ts';
import { onChange } from '../services/tags.ts';
import { t } from '../_shared/i18n.ts';
import { includesNormalized } from '../services/search.ts';
import { normalizeTagName } from '../../../../../native-host/tag-normalize.mts';

type Row = TagVocabRow;
type Edit = { name: string; category: 'general' | 'work' | 'character'; workId: number | null; id?: number; replaceWorkId?: number | null };

function Picker({
  label,
  rows,
  selected,
  multiple,
  disabled,
  onPick,
  onCreate,
  onEdit,
  children,
  chips,
}: {
  label: string;
  rows: Row[];
  selected: number[];
  multiple?: boolean;
  disabled: boolean;
  onPick: (row: Row) => Promise<void>;
  onCreate: (name: string) => void;
  onEdit?: (row: Row) => void;
  children: React.ReactNode;
  chips?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = rows.filter((row) => includesNormalized(row.name, query));
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setQuery('');
      }}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-lg border bg-background p-1">
        {chips}
        <PopoverTrigger render={<Button variant="ghost" disabled={disabled} aria-label={label} className="h-auto min-h-7 min-w-0 flex-1 justify-between whitespace-normal text-left" />}>
          {children}
          <ChevronDown className="size-4 shrink-0" />
        </PopoverTrigger>
      </div>
      <PopoverContent align="start" className="w-[var(--anchor-width)] min-w-60 max-w-[calc(100vw-24px)] p-1">
        <Command shouldFilter={false}>
          <CommandInput aria-label={label} placeholder={t('classificationSearch')} value={query} onValueChange={setQuery} />
          <CommandList>
            {matches.map((row) => (
              <CommandItem
                key={row.id}
                value={String(row.id)}
                disabled={disabled}
                onContextMenu={(event) => {
                  if (onEdit) {
                    event.preventDefault();
                    setOpen(false);
                    onEdit(row);
                  }
                }}
                onSelect={() => {
                  void onPick(row);
                  if (!multiple) setOpen(false);
                }}
              >
                {multiple && (
                  <span aria-hidden className="flex size-4 shrink-0 items-center justify-center rounded border">
                    {selected.includes(row.id) && <Check className="size-3" />}
                  </span>
                )}
                <span className="min-w-0 break-words">
                  {row.name}
                  {row.displayName !== row.name && <span className="block text-xs text-muted-foreground">{row.displayName}</span>}
                </span>
                {!multiple && selected.includes(row.id) && <Check className="ml-auto size-4" />}
              </CommandItem>
            ))}
            {!matches.length && normalizeTagName(query) && (
              <CommandItem
                value="create"
                disabled={disabled}
                onSelect={() => {
                  setOpen(false);
                  onCreate(normalizeTagName(query));
                }}
              >
                <Plus />
                {t('classificationCreate', { name: normalizeTagName(query) })}
              </CommandItem>
            )}
            {!matches.length && !query && <div className="p-3 text-xs text-muted-foreground">{t('classificationTypeToCreate')}</div>}
          </CommandList>
        </Command>
        {multiple && (
          <div className="flex justify-end border-t p-1">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('classificationClose')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function WorkCharacterField({ postIds, rows, reload }: { postIds: string[]; rows: Row[]; reload: () => Promise<void> }) {
  const [assignments, setAssignments] = useState<TagAssignment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [extra, setExtra] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [undo, setUndo] = useState<TagAssignment[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const value = await hologramIpc.getClassifiedAssignments(postIds);
      if (alive) setAssignments(value);
    };
    void load().catch(() => {
      if (alive) setError(true);
    });
    const unsub = onChange(() => {
      void load().catch(() => {});
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [postIds]);
  const works = rows.filter((row) => row.category === 'work');
  const characters = rows.filter((row) => row.category === 'character');
  const selectedIds = [...new Set(assignments.flatMap((a) => a.tagIds))];
  const selectedCharacters = characters.filter((row) => selectedIds.includes(row.id));
  const workIds = [...new Set([...works.filter((row) => selectedIds.includes(row.id)).map((row) => row.id), ...selectedCharacters.flatMap((row) => (row.workId ? [row.workId] : []))])];
  const groups: Array<number | null> = [...workIds];
  if (!groups.length || extra || selectedCharacters.some((row) => !row.workId)) groups.push(null);

  async function apply(mutate: (ids: number[]) => number[]) {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const previous = await hologramIpc.getClassifiedAssignments(postIds);
      const next = previous.map((a) => ({ ...a, tagIds: [...new Set(mutate(a.tagIds))] }));
      await hologramIpc.setClassifiedAssignments(next);
      setAssignments(next);
      setUndo(previous);
      setExtra(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const toggleCharacter = (row: Row) => apply((ids) => (selectedIds.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id]));
  const editRow = (row: Row) => setEdit({ id: row.id, name: row.name, category: row.category || 'general', workId: row.workId ?? null });

  return (
    <section className="flex shrink-0 flex-col gap-4" aria-label={t('classificationHeading')}>
      {groups.map((workId, index) => {
        const work = works.find((row) => row.id === workId);
        const selected = selectedCharacters.filter((row) => (row.workId ?? null) === workId);
        const candidates = characters.filter((row) => workId === null || row.workId === workId).map((row) => ({ ...row, displayName: works.find((w) => w.id === row.workId)?.name || t('classificationNoWork') }));
        return (
          <div key={index} className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span>{t('classificationWork')}</span>
              {work && (
                <Button variant="ghost" size="icon-xs" aria-label={t('classificationRemoveWork')} disabled={busy} onClick={() => void apply((ids) => ids.filter((id) => id !== workId && !characters.some((c) => c.id === id && c.workId === workId)))}>
                  <X />
                </Button>
              )}
            </div>
            <Picker
              label={t('classificationWork')}
              rows={works.filter((row) => row.id === workId || !workIds.includes(row.id))}
              selected={workId ? [workId] : []}
              disabled={busy}
              onEdit={editRow}
              onCreate={(name) => setEdit({ name, category: 'work', workId: null, replaceWorkId: workId })}
              onPick={(row) => apply((ids) => [...ids.filter((id) => id !== workId && !characters.some((c) => c.id === id && c.workId === workId && workId !== null)), row.id])}
            >
              {work?.name || t('classificationSelectWork')}
            </Picker>
            <div className="mt-1 text-sm">{t('classificationCharacter')}</div>
            <Picker
              label={t('classificationCharacter')}
              multiple
              rows={candidates}
              selected={selectedIds}
              disabled={busy}
              onEdit={editRow}
              onPick={toggleCharacter}
              onCreate={(name) => setEdit({ name, category: 'character', workId })}
              chips={selected.map((row) => (
                <span
                  key={row.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    editRow(row);
                  }}
                >
                  <span className="break-words">{row.name}</span>
                  <button type="button" disabled={busy} aria-label={t('classificationRemove', { name: row.name })} onClick={() => void toggleCharacter(row)}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            >
              {selected.length ? null : t('classificationSelectCharacter')}
            </Picker>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {!!workIds.length && !extra && (
          <Button variant="ghost" size="sm" onClick={() => setExtra(true)}>
            <Plus />
            {t('classificationAnotherWork')}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setEdit({ name: '', category: 'general', workId: null })}>
          {t('classificationManage')}
        </Button>
        {undo && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await hologramIpc.setClassifiedAssignments(undo);
                setAssignments(undo);
                setUndo(null);
              } catch {
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('classificationUndo')}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t('tagMgmtErrorGeneric')}
        </p>
      )}
      {edit && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setEdit(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('classificationManage')}</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy || !normalizeTagName(edit.name)) return;
                setBusy(true);
                setError(false);
                try {
                  const existing = !edit.id ? rows.filter((row) => row.name === normalizeTagName(edit.name) && (!row.category || row.category === 'general')) : [];
                  const id = await hologramIpc.saveClassifiedTag({ ...edit, id: edit.id ?? (existing.length === 1 ? existing[0].id : undefined) });
                  if (!edit.id && edit.category !== 'general') {
                    const prev = await hologramIpc.getClassifiedAssignments(postIds);
                    const next = prev.map((a) => ({ ...a, tagIds: [...new Set([...a.tagIds.filter((existingId) => !edit.replaceWorkId || (existingId !== edit.replaceWorkId && !characters.some((c) => c.id === existingId && c.workId === edit.replaceWorkId))), id])] }));
                    await hologramIpc.setClassifiedAssignments(next);
                    setAssignments(next);
                    setUndo(prev);
                  }
                  await reload();
                  setEdit(null);
                } catch {
                  setError(true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="flex flex-col gap-2">
                {t('classificationExisting')}
                <select
                  className="rounded border bg-background p-2"
                  disabled={busy}
                  value={edit.id || ''}
                  onChange={(e) => {
                    const row = rows.find((r) => r.id === Number(e.target.value));
                    if (row) editRow(row);
                    else setEdit({ name: '', category: edit.category, workId: edit.workId });
                  }}
                >
                  <option value="">{t('classificationNew')}</option>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                      {row.workId ? ` — ${works.find((w) => w.id === row.workId)?.name || ''}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="classified-tag-name" className="flex flex-col gap-2">
                {t('tagName')}
                <Input id="classified-tag-name" value={edit.name} autoFocus disabled={busy} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </label>
              <label className="flex flex-col gap-2">
                {t('classificationType')}
                <select className="rounded border bg-background p-2" disabled={busy} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as Edit['category'], workId: null })}>
                  <option value="general">{t('classificationOther')}</option>
                  <option value="work">{t('classificationWork')}</option>
                  <option value="character">{t('classificationCharacter')}</option>
                </select>
              </label>
              {edit.category === 'character' && (
                <label className="flex flex-col gap-2">
                  {t('classificationWork')}
                  <select className="rounded border bg-background p-2" disabled={busy} value={edit.workId || ''} onChange={(e) => setEdit({ ...edit, workId: Number(e.target.value) || null })}>
                    <option value="">{t('classificationNoWork')}</option>
                    {works.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {t('tagMgmtErrorGeneric')}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" type="button" disabled={busy} onClick={() => setEdit(null)}>
                  {t('tagMgmtCancel')}
                </Button>
                <Button type="submit" disabled={busy || !normalizeTagName(edit.name)}>
                  {t('classificationSave')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

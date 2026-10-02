import * as contextMenu from '../services/menu';
import { isComposing } from '../_shared/composition.ts';
import * as groupMenu from '../services/tag-group-menu';
import { TagDragProvider, TagDragLabel, TagDropDetails } from '../_shared/TagDrag';
import { Plus, Search, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { normalizeTagName } from '../../../../../native-host/tag-normalize.mts';
import { includesNormalized } from '../services/search.ts';
import { t } from '../_shared/i18n.ts';
import { CreateTagDialog } from './CreateTagDialog.tsx';
import { createTagGroup, showGroupActions } from '../services/tag-group-actions.ts';
import { hologramIpc } from '../services/ipc.ts';
import { onChange as onTagsChanged } from '../services/tags.ts';
import { WorkCharacterField } from './WorkCharacterField.tsx';
import type { TagVocabRow } from '../../../main/ipc-payloads.ts';
export interface TagPickItem {
  tag: string;
  kind?: string | null;
  title?: string;
}
export interface TagPickGroup {
  id?: string | null;
  name: string;
  items: TagPickItem[];
}
export interface TagFieldProps {
  tags: string[];
  vocabGroups?: TagPickGroup[] | null;
  labels: Record<string, string>;
  onAdd: (tag: string) => void | Promise<void>;
  onRemove: (tag: string) => void;
  onContextMenu: (tag: string, x: number, y: number) => void;
  /** 載せた時点でキャレットを欄に入れる＝カード／投稿者のコンテキストメニューの「タグを編集」。 */
  autoFocus?: boolean;
  management?: boolean;
  postIds?: string[];
}

export function TagField({ tags, vocabGroups, labels, onAdd, onRemove, onContextMenu, autoFocus, management = true, postIds }: TagFieldProps) {
  const [vocab, setVocab] = useState<TagVocabRow[]>([]);
  const [query, setQuery] = useState('');
  const [contextTarget, setContextTarget] = useState<string | null>(null);
  const menu = useSyncExternalStore(contextMenu.subscribe, contextMenu.get);
  const submenu = useSyncExternalStore(groupMenu.subscribe, groupMenu.get);
  useEffect(() => {
    if (!menu && !submenu) setContextTarget(null);
  }, [menu, submenu]);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [ids, setIds] = useState<Map<string, number>>(() => new Map());
  const [liveGroups, setLiveGroups] = useState<TagPickGroup[] | null>(null);
  useEffect(() => {
    if (!vocabGroups) return;
    let alive = true;
    const load = async () => {
      try {
        const [rows, state] = await Promise.all([hologramIpc.getTagVocab(), hologramIpc.getTagGroups()]);
        if (!alive) return;
        setVocab(rows);
        const next = new Map<string, number>();
        const ambiguous = new Set<string>();
        for (const row of rows) {
          if (next.has(row.name)) ambiguous.add(row.name);
          else next.set(row.name, row.id);
        }
        for (const name of ambiguous) next.delete(name);
        setIds(next);
        const visible = new Set([...vocabGroups.flatMap((g) => g.items.map((it) => it.tag)), ...tags]);
        const all: TagPickGroup[] = Object.entries(state.labels || {}).map(([id, name]) => ({ id, name, items: rows.filter((row) => row.groupId === id && visible.has(row.name)).map((row) => ({ tag: row.name, kind: id })) }));
        all.push({ id: null, name: t('tagUncategorized'), items: rows.filter((row) => !row.groupId && visible.has(row.name)).map((row) => ({ tag: row.name })) });
        setLiveGroups(all);
      } catch {
        if (alive) setIds(new Map());
      }
    };
    void load();
    const unsubscribe = onTagsChanged(() => {
      void load();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [vocabGroups, tags]);
  const displayedGroups = liveGroups || vocabGroups || [];

  const q = query.trim();
  const isGeneral = (name: string) => !postIds || !vocab.some((row) => row.name === name && row.category && row.category !== 'general');
  const generalTags = tags.filter(isGeneral);
  const groups: TagPickGroup[] = displayedGroups.map((g) => ({ ...g, items: g.items.filter((it) => isGeneral(it.tag) && (includesNormalized(g.name, q) || includesNormalized(it.tag, q))) })).filter((g) => g.items.length || (!q && g.id !== undefined));
  const typed = normalizeTagName(query);
  const exists = tags.includes(typed) || (vocabGroups || []).some((g) => g.items.some((it) => it.tag === typed));
  return (
    <TagDragProvider>
      <section data-slot="inspector-tags" className={'flex min-h-0 flex-1 flex-col gap-3' + (postIds ? ' overflow-y-auto pr-1' : '')}>
        {postIds && (
          <>
            <WorkCharacterField
              postIds={postIds}
              rows={vocab}
              reload={async () => {
                setVocab(await hologramIpc.getTagVocab());
              }}
            />
            <h3 className="border-t pt-4 text-sm">{t('classificationOther')}</h3>
          </>
        )}
        {management && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t('tagCreate')}
            </Button>
          </div>
        )}
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            data-slot="tag-input"
            type="search"
            autoFocus={autoFocus}
            aria-label={t('searchTags')}
            placeholder={t('searchTags')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
            onKeyDown={(e) => {
              if (isComposing(e.nativeEvent)) return;
              if (e.key === 'Enter' && typed && !exists) {
                e.preventDefault();
                onAdd(typed);
                setQuery('');
              }
            }}
          />
        </div>
        {!!generalTags.length && (
          <div className="flex shrink-0 flex-wrap gap-1 border-b pb-3">
            {generalTags.map((tag) => (
              <span
                key={tag}
                data-slot="tag-chip"
                data-tag={tag}
                className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs text-[color:var(--text-muted-strong)]"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextTarget('tag:' + tag);
                  onContextMenu(tag, e.clientX, e.clientY);
                }}
              >
                {tag}
                <button type="button" aria-label={labels.removeTag + ': ' + tag} className="rounded text-muted-foreground hover:text-foreground" onClick={() => onRemove(tag)}>
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div data-slot="tag-groups" className={postIds ? 'shrink-0 pr-2' : 'min-h-0 flex-1 overscroll-contain pr-2'} style={{ overflowY: postIds ? 'visible' : menu || submenu ? 'hidden' : 'auto', scrollbarGutter: 'stable' }}>
          {groups.map((g, index) => (
            <TagDropDetails
              groupId={g.id}
              key={index + ':' + g.name}
              open={!!q || !closed.has(g.name)}
              className="mb-2 rounded-md"
              onToggle={(e) => {
                if (q) return;
                const open = e.currentTarget.open;
                setClosed((prev) => {
                  if (prev.has(g.name) === !open) return prev;
                  const next = new Set(prev);
                  if (open) next.delete(g.name);
                  else next.add(g.name);
                  return next;
                });
              }}
            >
              <summary
                onContextMenu={(e) => {
                  if (!g.id) return;
                  e.preventDefault();
                  setContextTarget('group:' + g.id);
                  showGroupActions(g.id, g.name, e.clientX, e.clientY);
                }}
                className={'cursor-pointer rounded-md py-2 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ' + (contextTarget === 'group:' + g.id ? 'bg-muted' : '')}
              >
                {g.name}
              </summary>
              {g.items.map((it) => (
                <TagDragLabel
                  key={it.tag}
                  tagId={ids.get(it.tag)}
                  tagName={it.tag}
                  data-context-active={contextTarget === 'tag:' + it.tag || undefined}
                  className={'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[color:var(--text-muted-strong)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ' + (contextTarget === 'tag:' + it.tag ? 'bg-muted' : contextTarget ? '' : 'hover:bg-muted')}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextTarget('tag:' + it.tag);
                    onContextMenu(it.tag, e.clientX, e.clientY);
                  }}
                >
                  <Checkbox className="border-2 data-unchecked:border-[color:var(--text-muted)]" checked={tags.includes(it.tag)} onCheckedChange={(checked) => (checked ? onAdd(it.tag) : onRemove(it.tag))} />
                  <span className="min-w-0 break-words">{it.tag}</span>
                </TagDragLabel>
              ))}
            </TagDropDetails>
          ))}
          {!groups.length && !(typed && !exists) && <p className="py-2 text-xs text-muted-foreground">{q ? labels.noMatch : labels.noVocab}</p>}
          {typed && !exists && (
            <Button
              variant="outline"
              className="h-auto max-w-full justify-start whitespace-normal py-2 text-left"
              onClick={() => {
                onAdd(typed);
                setQuery('');
              }}
            >
              <Plus className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{t('tagCreateAndAdd', { name: typed })}</span>
            </Button>
          )}
        </div>
        {management && (
          <Button variant="outline" size="sm" className="shrink-0 self-start" onClick={() => createTagGroup()}>
            <Plus />
            {t('tagGroupCreate')}
          </Button>
        )}
        {creating && <CreateTagDialog groups={displayedGroups} onAdd={onAdd} onClose={() => setCreating(false)} />}
      </section>
    </TagDragProvider>
  );
}

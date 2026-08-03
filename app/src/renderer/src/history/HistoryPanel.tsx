// Global history page (#145) — the Popover's content. Rendered inline by
// LeftSidebar.tsx (the Popover's Trigger is the sidebar footer row it anchors
// to), unlike the body-level modals (Settings/Palette) that mount a permanent
// Host at the App root — a Popover's Trigger and Popup have to live in the same
// component tree for Base UI's default (element-anchored) positioning to work.
//
// Row click semantics mirror the tab strip's own convention (left = current tab,
// middle = background tab) — see tabs-builder.ts's openHistoryEntry /
// openHistoryEntryInBackgroundTab for what each does to the nav stack.
import { Image as ImageIcon, Rss, Search, Trash2, Users, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, KeyboardEvent as ReactKeyboardEvent, UIEvent as ReactUIEvent } from 'react';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { localeDate } from '../services/format.ts';
import { fileSrc } from '../services/asset-src.ts';
import { open as confirmOpen } from '../services/confirm.ts';
import { close as closePanel } from '../services/history-panel.ts';
import { clearHistory, deleteHistoryRow, queryHistory } from '../services/history.ts';
import { getPostById, openHistoryEntry, openHistoryEntryInBackgroundTab } from '../services/orchestrator.ts';
import type { HistoryRow } from '../../../main/ipc-payloads.ts';

const KIND_ICON: Record<string, ComponentType<{ className?: string }>> = {
  posts: Search,
  timeline: Rss,
  posters: Users,
};

const SEARCH_DEBOUNCE_MS = 150; // same debounce the palette's full-text face uses
const SCROLL_LOAD_MARGIN_PX = 80;

const _clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

function dayHeading(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return t('historyToday');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return t('historyYesterday');
  return localeDate(d);
}

interface Section {
  label: string;
  items: { row: HistoryRow; index: number }[];
}

function groupByDay(rows: HistoryRow[]): Section[] {
  const out: Section[] = [];
  rows.forEach((row, index) => {
    const label = dayHeading(row.ts);
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push({ row, index });
    else out.push({ label, items: [{ row, index }] });
  });
  return out;
}

// The first capture of an image entry, resolved to a live post for its thumbnail
// (#145 design §5's "image＝サムネイル" row icon) — the same lookup
// tabs-builder.ts's entryTitleOf uses for the title, via the same orchestrator
// export. A post can be gone (trashed/deleted since the visit); undefined falls
// back to the generic media icon, same convention as records.ts's imageTabGroup.
function historyThumbFile(row: HistoryRow): string | null {
  if (row.kind !== 'image') return null;
  const state = row.state as { recs?: unknown } | null;
  const recs = state && Array.isArray(state.recs) ? state.recs : [];
  const first = recs[0];
  if (typeof first !== 'string') return null;
  const post = getPostById(first);
  return post ? post.image || (Array.isArray(post.media) && post.media[0]?.file) || null : null;
}

function toEntry(row: HistoryRow): HologramNavEntry {
  return { u: row.u, kind: row.kind as HologramNavEntry['kind'], state: row.state as HologramNavEntry['state'] };
}

export function HistoryPanelBody() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadingMoreRef = useRef(false);
  const seqRef = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Re-query on every search change (debounced) — a fresh page 1, keyset reset.
  useEffect(() => {
    setLoading(true);
    const seq = ++seqRef.current;
    const timer = setTimeout(
      () => {
        queryHistory({ search: query.trim() || undefined }).then((res) => {
          if (seqRef.current !== seq) return;
          setRows(res.rows);
          setHasMore(res.hasMore);
          setLoading(false);
        });
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function loadMore() {
    if (!hasMore || loadingMoreRef.current || !rows.length) return;
    loadingMoreRef.current = true;
    const last = rows[rows.length - 1];
    const seq = seqRef.current;
    queryHistory({ search: query.trim() || undefined, before: { ts: last.ts, id: last.id } }).then((res) => {
      loadingMoreRef.current = false;
      if (seqRef.current !== seq) return;
      setRows((prev) => [...prev, ...res.rows]);
      setHasMore(res.hasMore);
    });
  }

  function onScroll(e: ReactUIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_LOAD_MARGIN_PX) loadMore();
  }

  function openRow(row: HistoryRow, opts?: { background?: boolean }) {
    if (opts?.background) {
      openHistoryEntryInBackgroundTab(toEntry(row), row.title);
      return;
    }
    openHistoryEntry(toEntry(row));
    closePanel();
  }

  function removeRow(id: number) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    deleteHistoryRow(id);
  }

  function onClearAll() {
    confirmOpen({
      message: t('historyClearAllConfirm'),
      okLabel: t('historyClearAll'),
      cancelLabel: t('confirmCancel'),
      onOk: () => {
        setRows([]);
        setHasMore(false);
        clearHistory();
      },
    });
  }

  function focusRow(index: number) {
    const row = rows[index];
    if (row) rowRefs.current.get(row.id)?.focus();
  }

  function onSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault();
      focusRow(0);
    } else if (e.key === 'Enter' && rows[0]) {
      openRow(rows[0]);
    }
  }

  function onRowKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, row: HistoryRow, index: number) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusRow(Math.min(index + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index === 0) searchRef.current?.focus();
      else focusRow(index - 1);
    } else if (e.key === 'Enter') {
      openRow(row);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeRow(row.id);
    }
  }

  const sections = useMemo(() => groupByDay(rows), [rows]);
  const empty = !loading && rows.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onSearchKeyDown} placeholder={t('historySearchPlaceholder')} aria-label={t('historyTitle')} className="flex-1" />
        <button type="button" onClick={onClearAll} title={t('historyClearAll')} aria-label={t('historyClearAll')} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <Trash2 className="size-4" />
        </button>
      </div>
      {empty ? (
        <Empty className="border-none p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>{t('historyEmptyTitle')}</EmptyTitle>
            <EmptyDescription>{query.trim() ? t('historyEmptySearchDescription') : t('historyEmptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollAreaPrimitive.Root className="relative min-h-0 flex-1">
          <ScrollAreaPrimitive.Viewport className="size-full max-h-[min(70vh,24rem)] rounded-[inherit] outline-none" onScroll={onScroll}>
            <div className="flex flex-col gap-1 pr-1">
              {sections.map((section) => (
                <div key={section.label}>
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">{section.label}</div>
                  {section.items.map(({ row, index }) => {
                    const Icon = KIND_ICON[row.kind] || ImageIcon;
                    const thumbFile = historyThumbFile(row);
                    return (
                      <button
                        key={row.id}
                        ref={(el) => {
                          if (el) rowRefs.current.set(row.id, el);
                          else rowRefs.current.delete(row.id);
                        }}
                        type="button"
                        onClick={() => openRow(row)}
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            openRow(row, { background: true });
                          }
                        }}
                        onKeyDown={(e) => onRowKeyDown(e, row, index)}
                        className="group flex w-full min-w-0 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                      >
                        {thumbFile ? <img data-slot="history-thumb" src={fileSrc(thumbFile, 32)} alt="" className="size-6 shrink-0 rounded object-cover" /> : <Icon className="size-4 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate">{row.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground group-focus-within:hidden group-hover:hidden">{_clockFmt.format(row.ts)}</span>
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={t('historyDeleteRow')}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRow(row.id);
                          }}
                          className={cn('hidden size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground', 'group-hover:flex group-focus-within:flex')}
                        >
                          <X className="size-3.5" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </ScrollAreaPrimitive.Viewport>
          <ScrollAreaPrimitive.Scrollbar orientation="vertical" className="flex w-2.5 touch-none border-l border-l-transparent p-px select-none">
            <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-border" />
          </ScrollAreaPrimitive.Scrollbar>
        </ScrollAreaPrimitive.Root>
      )}
    </div>
  );
}

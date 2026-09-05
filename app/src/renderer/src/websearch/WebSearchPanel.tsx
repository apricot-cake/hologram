// #207＝「ウェブで探す」のポップオーバー。今の条件の木を、採用したサイト（X・Bluesky・
// pixiv）ごとの検索 URL へ変換し、1つでも複数でもまとめて開けるように
// する。`tree` の既定は生きている投稿のクエリの木（services/store.ts の 'postQueryTree' の
// キー）なので、ツールバーからの入口には追加の配線が要らない。行・ホストの入力欄・チェック
// したものを開く、という中身は WebSearchPanelBody に切り出してある。投稿者やタグの文脈
// メニューからの入口（下の WebSearchContextPanelHost）が、自前の PopoverTrigger ではなく
// websearch/context-panel.ts の使い切りの木を受け取って、クリック地点を基準に同じ中身を
// 描けるようにするため。
import { ExternalLink, Globe, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { hologramIpc } from '../services/ipc.ts';
import { treeLeaves } from '../services/query.ts';
import { store } from '../services/store.ts';
import { buildWebSearchState } from './adapter.ts';
import { close as contextClose, get as contextGet, subscribe as contextSubscribe } from './context-panel.ts';
import { buildGoogleFallback } from './googleFallback.ts';
import { ALL_PLATFORMS } from './platforms/index.ts';
import { loadWebSearchChecked, saveWebSearchChecked } from './prefs.ts';
import { resolveAll, type ResolvedRow } from './resolve.ts';
import { buildUserHandleIndex } from './resolve-user.ts';
import type { PlatformId, QueryState, ResolvedUser } from './types.ts';

const noopResolveUser = (): ResolvedUser | null => null;

function useCheckedSites() {
  const [checked, setChecked] = useState<Set<PlatformId>>(new Set());
  useEffect(() => {
    let live = true;
    loadWebSearchChecked().then((ids) => {
      if (live) setChecked(new Set(ids));
    });
    return () => {
      live = false;
    };
  }, []);
  const toggle = (id: PlatformId) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveWebSearchChecked([...next]);
      return next;
    });
  };
  return { checked, toggle };
}

/** 木に実際に 'user' の葉がある時だけ取りに行く＝変換に投稿のスナップショットが要る唯一の
 * 条件（resolve-user.ts を参照）。他の条件はすべて木からそのまま変換する。 */
function useUserResolver(tree: HologramQueryGroup | null): (userKey: string) => ResolvedUser | null {
  const [resolver, setResolver] = useState<(userKey: string) => ResolvedUser | null>(() => noopResolveUser);
  const needsUsers = useMemo(() => !!tree && treeLeaves(tree).some((l) => l.type === 'user'), [tree]);
  useEffect(() => {
    if (!needsUsers) {
      setResolver(() => noopResolveUser);
      return;
    }
    let live = true;
    hologramIpc.listPosts().then((snap) => {
      if (!live) return;
      const index = buildUserHandleIndex(snap.posts);
      setResolver(() => (key: string) => index.get(key) ?? null);
    });
    return () => {
      live = false;
    };
  }, [needsUsers]);
  return resolver;
}

function domainFor(platformId: PlatformId): string | null {
  switch (platformId) {
    case 'x':
      return 'x.com';
    case 'bluesky':
      return 'bsky.app';
    case 'pixiv':
      return 'pixiv.net';
    default:
      return null;
  }
}

function Row({ row, state, checked, onToggle }: { row: ResolvedRow; state: QueryState; checked: boolean; onToggle: () => void }) {
  const hasWarning = row.approximated.length > 0 || row.dropped.length > 0;
  const google = hasWarning ? buildGoogleFallback(state, domainFor(row.platform.id)) : null;
  return (
    <div className="flex items-center gap-2 py-1">
      <Checkbox checked={checked} onCheckedChange={onToggle} disabled={!row.url} aria-label={t('websearchOpenChecked')} />
      <Tooltip>
        <TooltipTrigger render={<button type="button" disabled={!row.url} onClick={() => row.url && hologramIpc.openExternal(row.url)} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-sm disabled:text-muted-foreground disabled:opacity-60" />}>
          <span className="truncate font-medium">{row.platform.label}</span>
          {row.url ? <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        </TooltipTrigger>
        <TooltipContent>{row.url || t('websearchNothingToSearch')}</TooltipContent>
      </Tooltip>
      {hasWarning && (
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex shrink-0 items-center text-amber-500" />}>
            <TriangleAlert className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-64 whitespace-normal">
            <ul className="list-disc space-y-0.5 pl-3">
              {row.approximated.map((a, i) => (
                <li key={`a${i}`}>{a.note}</li>
              ))}
              {row.dropped.map((d, i) => (
                <li key={`d${i}`}>{d.reason}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      )}
      {google?.url && (
        <Tooltip>
          <TooltipTrigger render={<button type="button" onClick={() => google.url && hologramIpc.openExternal(google.url)} className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline" />}>{t('websearchGoogleFallback')}</TooltipTrigger>
          <TooltipContent>{google.url}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function WebSearchPanelBody({ tree }: { tree: HologramQueryGroup | null }) {
  const { checked, toggle } = useCheckedSites();
  const resolveUser = useUserResolver(tree);

  const { state, rows } = useMemo(() => {
    const built = buildWebSearchState(tree, { resolveUser });
    const resolvedRows = resolveAll(built.state, ALL_PLATFORMS, () => ({}), built.treeDrops);
    return { state: built.state, rows: resolvedRows };
  }, [tree, resolveUser]);

  const openChecked = () => {
    for (const row of rows) {
      if (checked.has(row.platform.id) && row.url) hologramIpc.openExternal(row.url);
    }
  };
  const anyOpenable = rows.some((r) => checked.has(r.platform.id) && r.url);

  return (
    <>
      <div className="flex flex-col">
        {rows.map((row) => (
          <Row key={row.platform.id} row={row} state={state} checked={checked.has(row.platform.id)} onToggle={() => toggle(row.platform.id)} />
        ))}
      </div>
      <Button size="sm" disabled={!anyOpenable} onClick={openChecked}>
        {t('websearchOpenChecked')}
      </Button>
    </>
  );
}

export function WebSearchPanel({ tree }: { tree?: HologramQueryGroup | null }) {
  const [open, setOpen] = useState(false);
  const activeTree = (tree ?? store.getState().postQueryTree) || null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Globe />
        <span>{t('websearchToolbarLabel')}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2">
        <WebSearchPanelBody tree={activeTree} />
      </PopoverContent>
    </Popover>
  );
}

// 投稿者・タグの文脈メニューからの入口（#207「投稿者・タグの文脈メニュー...パネル1個・入口複数」）。
// KindMenuHost と同じ形をした、常に載っているただ1つのインスタンスで、websearch/context-panel.ts
// が今持っているものを描く（何も無ければ何も描かない）。位置はクリック地点にある仮想の要素を
// 基準にする（Base UI の Popover の `anchor` はそれを受け取れる。KindMenuHost が DropdownMenu
// に使っているのと同じ手）。呼び出し側は poster-grid-builder.ts と kind-menu-builder.ts。
export function WebSearchContextPanelHost() {
  const menu = useSyncExternalStore(contextSubscribe, contextGet);
  const anchor = useMemo(() => {
    if (!menu) return null;
    const { x, y } = menu;
    return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
  }, [menu]);
  if (!menu) return null;
  return (
    <Popover open onOpenChange={(o) => !o && contextClose()}>
      <PopoverContent anchor={anchor} align="start" className="w-80 gap-2">
        <WebSearchPanelBody tree={menu.tree} />
      </PopoverContent>
    </Popover>
  );
}

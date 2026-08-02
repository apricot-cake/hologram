// #207 - "ウェブで探す" popover: translates the current condition tree into a search URL
// per adopted site (X/Bluesky/Misskey/Mastodon/pixiv) and lets the user open one or
// several at once. `tree` defaults to the live post query tree (services/store.ts's
// 'postQueryTree' key) so the toolbar entry point needs no extra wiring; a future
// context-menu entry point (poster/tag rows - #207's own scope, not part of this slice,
// see the Issue/PR for why) can reuse this same component by passing a one-off tree.
import { ExternalLink, Globe, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { hologramIpc } from '../services/ipc.ts';
import { treeLeaves } from '../services/query.ts';
import { get as storeGet } from '../services/store.ts';
import { buildWebSearchState } from './adapter.ts';
import { buildGoogleFallback } from './googleFallback.ts';
import { ALL_PLATFORMS } from './platforms/index.ts';
import { type FediverseHomeHosts, loadFediverseHomeHosts, loadWebSearchChecked, saveFediverseHomeHosts, saveWebSearchChecked, suggestHomeHost } from './prefs.ts';
import { resolveAll, type ResolvedRow } from './resolve.ts';
import { buildUserHandleIndex } from './resolve-user.ts';
import type { PlatformCtx, PlatformId, QueryState, ResolvedUser } from './types.ts';

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

function useHomeHosts() {
  const [hosts, setHosts] = useState<FediverseHomeHosts>({ misskey: null, mastodon: null });
  useEffect(() => {
    let live = true;
    loadFediverseHomeHosts().then((h) => {
      if (!live) return;
      setHosts(h);
      // A configured host may still be empty on first open - propose the library's own
      // most-common host per fediverse platform (#207's design comment) without
      // overwriting a value the user already set.
      (['misskey', 'mastodon'] as const).forEach((p) => {
        if (h[p]) return;
        suggestHomeHost(p).then((proposed) => {
          if (!live || !proposed) return;
          setHosts((prev) => (prev[p] ? prev : { ...prev, [p]: proposed }));
        });
      });
    });
    return () => {
      live = false;
    };
  }, []);
  const setHost = (p: 'misskey' | 'mastodon', host: string) => {
    setHosts((prev) => {
      const next = { ...prev, [p]: host.trim() || null };
      saveFediverseHomeHosts(next);
      return next;
    });
  };
  return { hosts, setHost };
}

/** Only fetched when the tree actually contains a 'user' leaf - the one condition whose
 * translation needs the posts snapshot (see resolve-user.ts). Every other condition is
 * adapted straight from the tree. */
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

function ctxFor(platformId: PlatformId, hosts: FediverseHomeHosts): PlatformCtx {
  if (platformId === 'misskey') return { instanceHost: hosts.misskey };
  if (platformId === 'mastodon') return { instanceHost: hosts.mastodon };
  return {};
}

function domainFor(platformId: PlatformId, hosts: FediverseHomeHosts): string | null {
  switch (platformId) {
    case 'x':
      return 'x.com';
    case 'bluesky':
      return 'bsky.app';
    case 'pixiv':
      return 'pixiv.net';
    case 'misskey':
      return hosts.misskey;
    case 'mastodon':
      return hosts.mastodon;
    default:
      return null;
  }
}

function Row({ row, state, checked, onToggle, hosts }: { row: ResolvedRow; state: QueryState; checked: boolean; onToggle: () => void; hosts: FediverseHomeHosts }) {
  const needsHost = !!row.platform.needsInstanceHost && !(row.platform.id === 'misskey' ? hosts.misskey : hosts.mastodon);
  const hasWarning = row.approximated.length > 0 || row.dropped.length > 0;
  const google = hasWarning ? buildGoogleFallback(state, domainFor(row.platform.id, hosts)) : null;
  return (
    <div className="flex items-center gap-2 py-1">
      <Checkbox checked={checked} onCheckedChange={onToggle} disabled={!row.url} aria-label={t('websearchOpenChecked')} />
      <Tooltip>
        <TooltipTrigger render={<button type="button" disabled={!row.url} onClick={() => row.url && hologramIpc.openExternal(row.url)} className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-sm disabled:text-muted-foreground disabled:opacity-60" />}>
          <span className="truncate font-medium">{row.platform.label}</span>
          {row.url ? <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        </TooltipTrigger>
        <TooltipContent>{row.url || (needsHost ? t('websearchNoHost') : t('websearchNothingToSearch'))}</TooltipContent>
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

export function WebSearchPanel({ tree }: { tree?: HologramQueryGroup | null }) {
  const [open, setOpen] = useState(false);
  const activeTree = (tree ?? (storeGet('postQueryTree') as HologramQueryGroup | undefined)) || null;
  const { checked, toggle } = useCheckedSites();
  const { hosts, setHost } = useHomeHosts();
  const resolveUser = useUserResolver(activeTree);

  const { state, rows } = useMemo(() => {
    const built = buildWebSearchState(activeTree, { resolveUser });
    const resolvedRows = resolveAll(built.state, ALL_PLATFORMS, (p) => ctxFor(p.id, hosts), built.treeDrops);
    return { state: built.state, rows: resolvedRows };
  }, [activeTree, resolveUser, hosts]);

  const openChecked = () => {
    for (const row of rows) {
      if (checked.has(row.platform.id) && row.url) hologramIpc.openExternal(row.url);
    }
  };
  const anyOpenable = rows.some((r) => checked.has(r.platform.id) && r.url);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Globe />
        <span>{t('websearchToolbarLabel')}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2">
        <div className="flex flex-col">
          {rows.map((row) => (
            <Row key={row.platform.id} row={row} state={state} checked={checked.has(row.platform.id)} onToggle={() => toggle(row.platform.id)} hosts={hosts} />
          ))}
        </div>
        <Separator />
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{t('websearchHomeMisskey')}</span>
            <Input value={hosts.misskey ?? ''} placeholder="misskey.io" onChange={(e) => setHost('misskey', e.target.value)} className="h-7 text-xs" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{t('websearchHomeMastodon')}</span>
            <Input value={hosts.mastodon ?? ''} placeholder="mastodon.social" onChange={(e) => setHost('mastodon', e.target.value)} className="h-7 text-xs" />
          </div>
        </div>
        <Separator />
        <Button size="sm" disabled={!anyOpenable} onClick={openChecked}>
          {t('websearchOpenChecked')}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

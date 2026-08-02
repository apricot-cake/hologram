// Persisted popover state (#207): which site rows "まとめて開く" targets, and the
// per-fediverse-platform home instance (Misskey/Mastodon search is login-gated, so the
// URL must target a host the user can actually log into - never the saved post's own
// origin host). Both ride the ordinary config.json pref channel (hologramIpc.getPrefs/
// setPref), the same two-call shape every other toolbar popover pref uses - no new
// storage mechanism.
import { hologramIpc } from '../services/ipc.ts';
import { hostOf } from '../services/query.ts';
import type { PlatformId } from './types.ts';

export interface FediverseHomeHosts {
  misskey: string | null;
  mastodon: string | null;
}

const DEFAULT_CHECKED: PlatformId[] = ['x', 'bluesky', 'misskey', 'mastodon', 'pixiv'];

export async function loadWebSearchChecked(): Promise<PlatformId[]> {
  const prefs = await hologramIpc.getPrefs();
  const v = prefs.webSearchChecked;
  if (!Array.isArray(v) || !v.length) return DEFAULT_CHECKED.slice();
  const known = new Set(DEFAULT_CHECKED);
  const filtered = v.filter((x): x is PlatformId => typeof x === 'string' && known.has(x as PlatformId));
  return filtered.length ? filtered : DEFAULT_CHECKED.slice();
}

export function saveWebSearchChecked(ids: readonly PlatformId[]): void {
  hologramIpc.setPref('webSearchChecked', ids as PlatformId[]);
}

export async function loadFediverseHomeHosts(): Promise<FediverseHomeHosts> {
  const prefs = await hologramIpc.getPrefs();
  const v = prefs.fediverseHomeHosts;
  return { misskey: v?.misskey ?? null, mastodon: v?.mastodon ?? null };
}

export function saveFediverseHomeHosts(hosts: FediverseHomeHosts): void {
  hologramIpc.setPref('fediverseHomeHosts', hosts);
}

/** Proposes the home-instance host as the library's own most-common host for that
 * platform (#207's design comment: "初期値はライブラリ内最多ホストを提案表示") - a fresh
 * IPC read of the raw posts snapshot, independent of the live (filtered) listing
 * pipeline, so this stays a standalone call with no orchestrator.ts wiring. */
export async function suggestHomeHost(platform: 'misskey' | 'mastodon'): Promise<string | null> {
  const snap = await hologramIpc.listPosts();
  const counts = new Map<string, number>();
  for (const p of snap.posts) {
    if ((p as { platform?: string }).platform !== platform) continue;
    const host = hostOf((p as { url?: string | null }).url);
    if (!host) continue;
    counts.set(host, (counts.get(host) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [host, count] of counts) {
    if (count > bestCount) {
      best = host;
      bestCount = count;
    }
  }
  return best;
}

// 永続化するポップオーバーの状態（#207）: 「まとめて開く」がどのサイトの行を対象にするか、
// そして fediverse のプラットフォームごとのホームインスタンス（Misskey/Mastodon の検索は
// ログインのゲートの内側にあるので、URL は利用者が実際にログインできるホストを指さなければ
// ならない＝保存した投稿自身のオリジンのホストでは決してない）。どちらも通常の config.json の
// 設定の経路（hologramIpc.getPrefs/setPref）に乗る＝他のツールバーのポップオーバーの設定が
// どれも使っているのと同じ2呼び出しの形で、新しい保管の仕組みは持ち込まない。
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

/** ホームインスタンスのホストとして、そのプラットフォームでライブラリ内に最も多いホストを
 * 提案する（#207 の設計コメント「初期値はライブラリ内最多ホストを提案表示」）。生の投稿の
 * スナップショットを IPC で読み直す＝生きた（絞り込み済みの）一覧のパイプラインとは独立
 * なので、orchestrator.ts への配線を持たない単独の呼び出しのままでいられる。 */
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

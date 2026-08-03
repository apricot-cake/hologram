'use strict';

// #289: the shared identity + "appearance" hash for the poster-profile
// snapshot store (poster_profiles / poster_profile_snapshots — the
// add-poster-profiles migration in lib-db.ts). Used by both the live write
// path (lib-db-record-writer.ts's writePost, one poster observation per post
// save) and the one-time backfill (lib-backfill-poster-profiles.ts, seeding
// existing libraries from their posts table), so the two can never compute a
// different key or a different notion of "unchanged" for the same poster.
//
// posterKeyOf/posterInstanceOf duplicate services/query.ts's userKey()/hostOf
// rather than importing them: that module lives in the RENDERER bundle
// (app/src/renderer/src/...) and this file runs in the ELECTRON MAIN process,
// a separate electron-vite bundle. lib-migrate-poster-key-host.ts already
// made the same call for the same reason (see its own header) — both copies
// move together whenever userKey()'s formula changes (#791 added the host
// qualification below).

import { createHash } from 'node:crypto';

const INSTANCE_SCOPED_PLATFORMS = new Set(['misskey', 'mastodon']);

function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export interface PosterIdentity {
  platform: string | null;
  userId: string | null;
  screenName: string | null;
  url: string | null;
}

// Mirrors services/query.ts's userKey() exactly (see module comment above).
export function posterKeyOf(p: PosterIdentity): string {
  const id = p.userId || '@' + (p.screenName || '');
  if (!p.platform) return 'web:' + hostOf(p.url) + ':' + id;
  if (INSTANCE_SCOPED_PLATFORMS.has(p.platform)) {
    const host = hostOf(p.url);
    if (host) return `${p.platform}:${host}:${id}`;
  }
  return `${p.platform}:${id}`;
}

// The instance host for the two instance-scoped platforms, recorded on
// poster_profiles as a descriptive (non-key) column, same as the DDL comment
// in lib-db.ts describes — null for every other platform, which has no such
// concept.
export function posterInstanceOf(p: PosterIdentity): string | null {
  if (!p.platform || !INSTANCE_SCOPED_PLATFORMS.has(p.platform)) return null;
  return hostOf(p.url) || null;
}

// Whether a record carries enough identity to be worth a poster_profiles row
// at all. A bookmark or platform-less record with neither a stable id nor a
// handle would otherwise collapse onto the one garbage key posterKeyOf falls
// back to ('web:<host>:@'), piling up every such record under one fake
// poster — the same identity gate services/query.ts's own comment describes
// buildUsers applying on the renderer side for exactly this shape of record.
export function hasPosterIdentity(p: PosterIdentity): boolean {
  return !!(p.userId || p.screenName);
}

export interface PosterAppearance {
  displayName: string | null;
  screenName: string | null;
  bio: string | null;
  links: string | null; // already-normalized JSON text, or null
  avatar: string | null;
  avatarFile: string | null;
  banner: string | null;
  bannerFile: string | null;
}

// SHA-256 over the poster's "appearance" fields only — NOT followers/
// authorCreatedAt, which are point-in-time counters that would otherwise mint
// a new history row on nearly every save of a popular poster's posts (#289's
// 2026-08-02 design comment #4). A fixed key order makes the digest depend
// only on the values.
export function posterAppearanceHash(a: PosterAppearance): string {
  const json = JSON.stringify([a.displayName, a.screenName, a.bio, a.links, a.avatar, a.avatarFile, a.banner, a.bannerFile]);
  return createHash('sha256').update(json).digest('hex');
}

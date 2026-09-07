'use strict';

// #289: 投稿者プロフィール（poster_profiles）の識別子と「見た目」のハッシュ。
// 稼働中の書き込み経路（lib-db-record-writer.ts の writePost）が使う。
//
// posterKeyOf は services/query.ts の userKey()/hostOf を
// import するのではなく複製している: あちらのモジュールは「レンダラー」の
// バンドル（app/src/renderer/src/...）に住み、このファイルは「Electron の
// main」プロセス、つまり別の electron-vite バンドルで動く。
// userKey() の計算式が変わるたびに、両方のコピーを一緒に動かす。

import { createHash } from 'node:crypto';

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

// services/query.ts の userKey() を正確に写す（上のモジュールコメント参照）。
export function posterKeyOf(p: PosterIdentity): string {
  const id = p.userId || '@' + (p.screenName || '');
  if (!p.platform) return 'web:' + hostOf(p.url) + ':' + id;
  return `${p.platform}:${id}`;
}

// レコードが poster_profiles の行を作るに値するだけの識別情報を持っているか。
// 安定した id もハンドルも持たないブックマークやプラットフォーム無しの
// レコードは、そうしなければ posterKeyOf がフォールバックする1つのゴミキー
// （'web:<host>:@'）へすべて潰れてしまい、そうしたレコードすべてが1つの
// 偽の投稿者の下に積み上がる——services/query.ts 自身のコメントが、まさに
// この形のレコードに対して buildUsers がレンダラー側で適用すると説明している
// のと同じ識別性のゲート。
export function hasPosterIdentity(p: PosterIdentity): boolean {
  return !!(p.userId || p.screenName);
}

export interface PosterAppearance {
  displayName: string | null;
  screenName: string | null;
  bio: string | null;
  links: string | null; // 既に正規化済みの JSON テキスト、または null
  avatar: string | null;
  avatarFile: string | null;
  banner: string | null;
  bannerFile: string | null;
  followers?: number | null;
  following?: number | null;
  authorCreatedAt?: string | null;
}

// 現在の公開プロフィールの内容を識別する SHA-256。
export function posterAppearanceHash(a: PosterAppearance): string {
  const json = JSON.stringify([a.displayName, a.screenName, a.bio, a.links, a.avatar, a.avatarFile, a.banner, a.bannerFile, a.followers ?? null, a.following ?? null, a.authorCreatedAt ?? null]);
  return createHash('sha256').update(json).digest('hex');
}

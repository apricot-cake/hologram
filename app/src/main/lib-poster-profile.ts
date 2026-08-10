'use strict';

// #289: 投稿者プロフィールのスナップショットストア（poster_profiles /
// poster_profile_snapshots——lib-db.ts の add-poster-profiles マイグレーション）
// が共有する、識別子と「見た目」のハッシュ。稼働中の書き込み経路
// （lib-db-record-writer.ts の writePost。投稿の保存1回につき投稿者の観測1件）と、
// 一度限りの遡及処理（lib-backfill-poster-profiles.ts。既存ライブラリの posts
// テーブルから種を蒔く）の両方が使うので、この2つが同じ投稿者について異なる
// キーや「変化なし」の異なる基準を計算することは絶対に無い。
//
// posterKeyOf/posterInstanceOf は services/query.ts の userKey()/hostOf を
// import するのではなく複製している: あちらのモジュールは「レンダラー」の
// バンドル（app/src/renderer/src/...）に住み、このファイルは「Electron の
// main」プロセス、つまり別の electron-vite バンドルで動く。
// lib-migrate-poster-key-host.ts も同じ理由で既に同じ選択をしている（その
// ヘッダー参照）——userKey() の計算式が変わるたびに、両方のコピーを一緒に
// 動かす（#791 が下のホスト限定を加えた）。

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

// services/query.ts の userKey() を正確に写す（上のモジュールコメント参照）。
export function posterKeyOf(p: PosterIdentity): string {
  const id = p.userId || '@' + (p.screenName || '');
  if (!p.platform) return 'web:' + hostOf(p.url) + ':' + id;
  if (INSTANCE_SCOPED_PLATFORMS.has(p.platform)) {
    const host = hostOf(p.url);
    if (host) return `${p.platform}:${host}:${id}`;
  }
  return `${p.platform}:${id}`;
}

// インスタンス単位の2プラットフォームについてのインスタンスホスト。
// poster_profiles には lib-db.ts の DDL コメントが説明するとおり、説明用の
// （キーではない）列として記録される——それ以外のすべてのプラットフォームは
// この概念自体を持たないので null。
export function posterInstanceOf(p: PosterIdentity): string | null {
  if (!p.platform || !INSTANCE_SCOPED_PLATFORMS.has(p.platform)) return null;
  return hostOf(p.url) || null;
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
}

// 投稿者の「見た目」の欄だけに対する SHA-256——followers/authorCreatedAt は
// 含めない。これらはある時点でのカウンタで、含めてしまうと人気の投稿者の
// 投稿をほぼ保存するたびに新しい履歴行を鋳造することになる（#289 の
// 2026-08-02 設計コメント #4）。キーの順序を固定することで、ダイジェストが
// 値だけに依存するようにする。
export function posterAppearanceHash(a: PosterAppearance): string {
  const json = JSON.stringify([a.displayName, a.screenName, a.bio, a.links, a.avatar, a.avatarFile, a.banner, a.bannerFile]);
  return createHash('sha256').update(json).digest('hex');
}

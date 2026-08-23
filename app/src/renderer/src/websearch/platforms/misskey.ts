// Misskey の検索への変換。凍結した姉妹プロジェクト apricot-cake/dialect と
// scripts/check-websearch-equivalence.cts で機械的に突き合わせてある（#822、2026-08-03）。
// dialect 自身の misskey.ts（GUI とルート表の調査、2026-07-03/07-08）が見つけたのは、
// ただの全文検索欄より多いもの＝/search?q= の裏は Meilisearch なので、先頭の "-word" は
// ちゃんと除外として効く（文書化されていないが動作を確認済み）。さらにフロントエンドの
// ルーターが、投稿者の絞り込み用に公開されていない &username=/&host= のパラメータを
// 出している。一方で引用符の構文は壊れていることを確認済み（語を "..." で囲むと検索全体
// が0件になる。他の AND の語と組み合わせても同じ）＝だから X・Bluesky と違い、
// このモジュールは複数語の語を決して引用符で囲まない。
//
// needsInstanceHost: たいていのインスタンスで検索はログインしないと使えないので、URL は
// 常に利用者が設定したホームインスタンス（websearch/prefs.ts）へ向ける。保存した投稿の
// 元のホストへは決して向けない。
import { isEmptyState, type PlatformDef, type PlatformQueryState, type PlatformResult } from '../types.ts';
import { encodeQueryTokens, stripAt, stripHash, stripQuerySyntax } from '../text.ts';

function build(state: PlatformQueryState, host: string, applied: string[], dropped: PlatformResult['dropped']): string | null {
  const terms = state.terms.map((t) => stripQuerySyntax(t).trim()).filter(Boolean);
  const tags = state.hashtag.map(stripHash).filter(Boolean);
  const handle = state.fromUser ? stripAt(state.fromUser) : '';
  const excludeToks = state.exclude.map((t) => `-${stripQuerySyntax(t).trim()}`).filter((t) => t !== '-');

  if (state.keywordsOr.length || state.hashtagOr.length || state.excludeHashtag.length) {
    dropped.push({ reason: 'Misskey の検索は「いずれか」条件・除外ハッシュタグに対応していません' });
  }
  if (state.excludeUser.length) dropped.push({ reason: 'Misskey の検索URLは投稿者の除外に対応していません' });
  if (state.since || state.until) dropped.push({ reason: 'Misskey の検索は期間の絞り込みに対応していません' });
  if (state.mediaOnly || state.videoOnly) dropped.push({ reason: 'Misskey の検索はメディア絞り込みに対応していません' });
  if (state.repliesOnly || state.excludeReplies) dropped.push({ reason: 'Misskey の検索は返信の絞り込みに対応していません' });
  if (state.minLikes != null || state.minReposts != null || state.minReplies != null) dropped.push({ reason: 'Misskey の検索はエンゲージメント数の下限に対応していません' });

  // タグが1つだけで、他に条件が無い場合。タグのページ（/tags/<name>）は、Misskey が
  // ログインしていない訪問者に見せる唯一の経路。そこへ除外を足しても黙って落ちる
  //（運ぶための q= が無い）ので、その組み合わせは代わりに /search へ流す＝dialect の
  // 2026-07-10 の修正と一致する（以前は除外が黙って失われていた）。
  if (tags.length === 1 && terms.length === 0 && !handle && excludeToks.length === 0) {
    applied.push('ハッシュタグ');
    return `https://${host}/tags/${encodeURIComponent(tags[0])}`;
  }

  const toks = [...terms, ...tags.map((t) => `#${t}`)];
  // Misskey では利用者の絞り込みだけでは検索が走らない＝キーワードかハッシュタグが要る
  //（dialect 自身のゲートと一致する:「ユーザー指定だけでは検索が実行されない」）。
  if (toks.length === 0) return null;
  if (terms.length) applied.push('キーワード');
  if (tags.length) applied.push('ハッシュタグ');

  toks.push(...excludeToks);
  if (excludeToks.length) applied.push('除外キーワード');

  // type=note は Misskey 自身の検索フォームが常に送る固定の定数。あってもなくても
  // Hologram の変換には差が出ない＝dialect の実測した出力と URL の形を揃えるために残す。
  let url = `https://${host}/search?q=${encodeQueryTokens(toks)}&type=note`;
  if (handle) {
    // リモートのハンドル（user@host）は username= と host= の別々のパラメータに分かれる。
    // ローカルのハンドルは username= だけを送る。
    const [user, remoteHost] = handle.split('@');
    url += `&username=${encodeURIComponent(user)}`;
    if (remoteHost) url += `&host=${encodeURIComponent(remoteHost)}`;
    applied.push('投稿者');
  }
  return url;
}

export const misskeyPlatform: PlatformDef = {
  id: 'misskey',
  label: 'Misskey',
  needsInstanceHost: true,
  build(state, ctx) {
    const applied: string[] = [];
    const approximated: PlatformResult['approximated'] = [];
    const dropped: PlatformResult['dropped'] = [];
    const host = ctx.instanceHost || '';
    if (!host) {
      dropped.push({ reason: 'ホームインスタンス（Misskey）が未設定です' });
      return { url: null, applied, approximated, dropped };
    }
    if (isEmptyState(state)) return { url: null, applied, approximated, dropped };
    const url = build(state, host, applied, dropped);
    return { url, applied, approximated, dropped };
  },
};

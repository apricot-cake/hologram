// Misskey。
//
// API は <instance>/api/notes/show（公式。既定で CORS *）。インスタンスは投稿 URL から取る
// 任意のホストで、だからこの extractor は derivedApiHost を宣言している＝index.ts の SSRF の
// 防ぎを参照。

import { normalizeRect, prepareScopedCaptureState } from './dom.ts';
import { parseCount } from './dom-meta.ts';
import { fileBasenameKey } from './media.ts';
import { emptyRecord, normalizeHashtags, readJsonKeepingRaw, toIso } from './record.ts';
import type { DomMeta, Extractor, MediaIdentity, Poll, PostMediaElement, PostRect, PostRecord } from './types.ts';

// === DOM ===

function looksLikeMisskey(): boolean {
  const misskeyAccent = getComputedStyle(document.documentElement).getPropertyValue('--MI_THEME-accent').trim();

  if (!misskeyAccent) {
    return false;
  }

  return Boolean(document.querySelector('div[tabindex="0"] a[href] time'));
}

function findMisskeyPostElement(target: EventTarget | null): Element | null {
  let el: Element | null = target instanceof Element ? target : ((target as Node | null)?.parentElement ?? null);
  while (el) {
    if (isMisskeyNoteElement(el)) {
      return el;
    }

    el = el.parentElement;
  }

  return null;
}

function isMisskeyNoteElement(element: Element): boolean {
  return element instanceof HTMLElement && element.matches('div[tabindex="0"]') && Boolean(getMisskeyPrimaryArticle(element)) && Boolean(getMisskeyPermalink(element));
}

function getMisskeyPrimaryArticle(post: Element | null): Element | null {
  if (!(post instanceof Element)) {
    return null;
  }

  return post.querySelector('article');
}

function getMisskeyCaptureRect(post: Element): PostRect {
  const rootRect = normalizeRect(post.getBoundingClientRect());
  const article = getMisskeyPrimaryArticle(post);
  if (!article) {
    return rootRect;
  }

  const articleRect = normalizeRect(article.getBoundingClientRect());
  return {
    x: rootRect.x,
    y: rootRect.y,
    top: rootRect.top,
    left: rootRect.left,
    width: rootRect.width,
    height: Math.max(articleRect.bottom - rootRect.top, articleRect.height),
    right: rootRect.right,
    bottom: Math.max(articleRect.bottom, rootRect.top + articleRect.height),
  };
}

function getMisskeyPermalink(post: Element): string {
  // リンクの走査は、そのノート自身の <article> の中に限る。返信先の親のプレビュー
  // （MkNoteSub）と、詳細ページの祖先の連なりは article より前に描かれるので、根の全体を
  // 文書順で走査すると、どの返信でも親のノートの permalink を返していた。(audit 2026-06-11)
  const scope = getMisskeyPrimaryArticle(post) || post;

  const timeLink = getMisskeyTimeLink(scope);
  if (timeLink) {
    return timeLink.url;
  }

  const links = scope instanceof Element ? Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href]')) : [];

  for (const link of links) {
    const parsed = parseMisskeyNoteLink(link.href);
    if (parsed) {
      return parsed.url;
    }
  }

  const currentPageNote = parseMisskeyNoteLink(location.href);
  return currentPageNote?.url || '';
}

interface MisskeyNoteLink {
  id: string;
  url: string;
}

function getMisskeyTimeLink(scope: Element): MisskeyNoteLink | null {
  if (!(scope instanceof Element)) {
    return null;
  }

  const links = Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const link of links) {
    if (!link.querySelector('time')) {
      continue;
    }

    const parsed = parseMisskeyNoteLink(link.href);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function parseMisskeyNoteLink(href: string): MisskeyNoteLink | null {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^\/notes\/([^/?#]+)\/?$/);
    if (!match) {
      return null;
    }
    const id = match[1];
    if (id === undefined) return null;

    return {
      id: decodeURIComponent(id),
      url: url.href,
    };
  } catch {
    return null;
  }
}

// #202 の段2。このノートについてページ自身が出しているもの。misskey.io の API が null の
// まま残した欄（フォロワー限定のノート、または匿名の API アクセスを切っているインスタンス）
// も、これで保存できるようにする。これが流し込む先の合流の規則は dom-meta.ts の冒頭を参照。
// サイト側の仕事は、正しい要素を見つけることだけ。
//
// X と違い、ここで賄えるのは投稿者とエンゲージメントの数だけで、ノート自身の本文は決して
// 取れない。misskey.io のビルド（MisskeyIO/misskey の main ブランチを 2026-08-03 に確認）は、
// どのノートのスタイルも Vue の CSS Modules として描く＝MkNote.vue が本文の div へ
// `:class="$style.text"` と書き、それが不透明なハッシュのトークンへコンパイルされる（同じ
// 日に misskey.io の実物で確認＝無関係なウィジェットのクラス名は `xoIiV`/`xBHTS` として
// 返り、ソース自身の名前に似たものは何も無かった）。本文の div を兄弟（閲覧注意の段落、
// メディアの一覧、アンケート、埋め込みの引用）と区別する属性もタグも他に無い。どれも印の
// 無い <div> で、位置から推し量れば、この機能がまさに避けるために在る「別の投稿と取り違え
// る」壊れ方の危険を冒すことになる。投稿者名とエンゲージメントの数がこれを免れるのは、
// MkNoteHeader.vue の <header> と MkNote.vue の <footer> が素の意味づけされた要素であり、
// 数のボタンが Tabler のアイコンのクラス（ti-arrow-back-up / ti-repeat / ti-heart /
// ti-plus / ti-minus）を持つから。あれはバージョン付きのアイコンフォントとして同梱されて
// いて、ビルドごとにハッシュ化されない。
//
// これも X と違い、日付は抽出しない。MkTime.vue の <time> は datetime 属性をそもそも持たず、
// 持つのは Intl で整形した閲覧者のロケールの文字列を入れた `title` と、同じ調子の相対／絶対
// のテキストだけ。dom-meta.ts の冒頭が X の <time> の面について述べている「人間向けの日付は
// 決して解析しない」の規則が、ここでは退避先の ISO の属性が無いまま当てはまる。
const MISSKEY_REPLY_ICON = 'ti-arrow-back-up';
const MISSKEY_RENOTE_ICON = 'ti-repeat';

function misskeyReadText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (tag === 'img') out += child.getAttribute('alt') || '';
    else if (tag === 'br') out += '\n';
    else out += misskeyReadText(child);
  }
  return out;
}

// 自分のアイコンが、渡された手掛かりのどれかを部分文字列として持つ footer のボタン。
// クラスの一致では決して見ない。`ti-plus` のような手掛かりは、複数クラスの属性値にも当たら
// なければならないし、`heart` は `ti-heart` にも `ti-filled-heart` にも当たらなければ
// ならないから。
function misskeyFooterButton(article: Element, iconHints: readonly string[]): Element | null {
  for (const btn of article.querySelectorAll('footer button')) {
    const icon = btn.querySelector('i');
    const cls = icon?.className || '';
    if (iconHints.some((hint) => cls.includes(hint))) return btn;
  }
  return null;
}

function misskeyFooterCount(article: Element, iconHints: readonly string[]): number | null {
  const p = misskeyFooterButton(article, iconHints)?.querySelector('p');
  return p ? parseCount(p.textContent) : null;
}

// MkReactionsViewer のリアクションごとのチップ。Tabler のアイコンをまったく持たない唯一の
// footer のボタンの形（返信・リノート・リアクション・その他という動作のボタンはどれも
// アイコンを持つが、チップは持たない）。専用の testid やクラスではなく「<i> が無い」で読む
// のは、misskeyFooterButton がアイコンを持つ側に対して取っているのと同じ、構造を印として
// 使うやり方。
function isMisskeyReactionChip(btn: Element): boolean {
  return !btn.querySelector('i');
}

// チップ自身のテキストは `<emoji><count>` の形。文字列の末尾から読む。先頭からの
// parseCount(button.textContent) は使わない。parseCount は ^\d に錨を下ろすが、組み込みの
// 絵文字は数字の前に素の文字として描かれるから（カスタム絵文字は <img alt=":name:"> として
// 描かれ、textContent には何も足さないので、これが要るのは組み込みの場合だけ）。
function misskeyReactionChipCount(btn: Element): number | null {
  const m = (btn.textContent || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

// misskeyFooterCount（リアクションのボタン）では見えないリアクションの総数。あちらは
// ti-plus/heart のボタン自身の <p> を読むが、そこに数が出るのは閲覧者が showReactionsCount
// を入れているときだけ（既定は false）。一方、リアクションごとのチップはその設定にかかわらず
// 描かれる（#916。2026-08-05 に misskey.io の実物で確認＝API では合計113のリアクションが
// 付いたノートで、チップのボタンが12個並び、それぞれ `84` `11` `4` `3` `2` `2` `2` `1`
// `1` `1` `1` `1` と読めた。合計は同じ113。その隣のリアクションのボタンには数がまったく
// 出ていなかった）。ここで合計するのは、meta.likes に fetchMisskeyNote 自身のリアクション
// 合計と同じ定義を持たせるため＝API が答えなかったノートが、取得に失敗したというだけの
// 理由で別のノートと食い違ってはいけない。
function misskeyReactionTotal(article: Element): number | null {
  let total = 0;
  let any = false;
  for (const btn of article.querySelectorAll('footer button')) {
    if (!isMisskeyReactionChip(btn)) continue;
    const n = misskeyReactionChipCount(btn);
    if (n == null) continue;
    any = true;
    total += n;
  }
  return any ? total : null;
}

function extractMisskeyDomMeta(post: Element): DomMeta {
  const meta: DomMeta = {};
  const article = getMisskeyPrimaryArticle(post);
  if (!(article instanceof Element)) return meta;

  const header = article.querySelector('header');
  if (header) {
    // 名前のリンク。MkNoteHeader.vue はこの要素の中にちょうど2つの <a> を描く。投稿者の
    // もの（MkUserName を包む）と permalink のもの（MkTime を包む）で、<time> の子を持たない
    // 方が投稿者のもの。
    for (const link of header.querySelectorAll('a')) {
      if (link.querySelector('time')) continue;
      const label = misskeyReadText(link).trim();
      if (label) meta.displayName ??= label;
    }
    // MkAcct.vue は `@user` を描き、連合先のユーザーならその後ろに2つ目の `@host` の span を
    // 描く。包んでいる要素自身のテキストは2つを繋げたもの（`@user@host`）で、文書順では
    // どちらの子の span より先に訪れる。だから header の中でテキストが '@' で始まる最初の
    // 要素は必ずその包み側になり、単独の span になることはない。先頭の '@' を1つ落とせば、
    // fetchMisskeyNote 自身の screenName がすでに使っている `user@host` / `user` の形に
    // ちょうどなる。
    for (const el of header.querySelectorAll('div, span')) {
      const label = misskeyReadText(el).trim();
      if (label.startsWith('@')) {
        meta.screenName ??= label.slice(1);
        break;
      }
    }
  }

  const replies = misskeyFooterCount(article, [MISSKEY_REPLY_ICON]);
  if (replies != null) meta.replies = replies;
  const reposts = misskeyFooterCount(article, [MISSKEY_RENOTE_ICON]);
  if (reposts != null) meta.reposts = reposts;
  const likes = misskeyReactionTotal(article);
  if (likes != null) meta.likes = likes;

  return meta;
}

// === メディアの素性（#238・misskey.io でのドラッグ保存とホバー保存） ===

// ポインタの下のノートを見つけるために capture.ts が使うのと同じ祖先の遡り。ここで使い回す
// のは、ドラッグと（#94 が入れば）ホバーボタンが、Alt+S でスクリーンショットを撮るのとは
// 別のノートに絵を結び付けることが決してないようにするため。保存の経路2つは、その保存が
// 何を記録するかについて食い違ってはいけない（drag.ts 自身の冒頭のコメント）。
function extractMisskeyIdentity(el: PostMediaElement): MediaIdentity | null {
  const post = findMisskeyPostElement(el);
  if (!post) return null;
  const link = getMisskeyPermalink(post);
  if (!link) return null;
  const parsed = parseMisskeyNoteLink(link);
  return parsed ? { postId: parsed.id, link } : null;
}

// アバターは同じノートの中に在り、ノート自身の絵と同じ permalink へ解決する（extractIdentity
// は両者を区別しないし、types.ts の MediaIdentitySite の契約からして区別してはいけない）。
// そのための別の門が isPostMedia で、他のサイトの isPostMedia が自分のところのアバターを
// 扱うのとまったく同じ。Misskey の DriveFile 由来の URL では、投稿のメディアとアバターに
// 区別の付く CDN のパスが無い（X の profile_images/ や Bluesky の img/avatar/ と違い、
// どちらも `<instance>/files/...`）。だからここで使う信号は構造の側にある＝Misskey は
// アバターを投稿者のプロフィール（`/@user`）へリンクし、ノートへはリンクしない。DOM の形の
// うち、内部の（Vue でスコープされた、バージョン固有の）クラス名ではなく、文書化された
// 安定した Misskey の URL の作法に当たるのがここだけ。実インスタンスでの確認は取れていない
// （#238 の制約でできなかった）＝実物で確かめる価値がある。
function isMisskeyPostMedia(el: PostMediaElement): boolean {
  return !el.closest('a[href^="/@"]');
}

// === API ===

function misskeyItemType(f) {
  const t = f && f.type ? f.type : '';
  if (t.startsWith('video/')) return /gif/i.test(t) ? 'gif' : 'video';
  if (t === 'image/gif') return 'gif';
  if (t.startsWith('image/')) return 'image';
  return null;
}
function misskeyMediaType(files) {
  return misskeyItemType(files && files[0]);
}

// ダウンロードと表示のための type。上の misskeyItemType とは別物（あちらは本物の image/gif
// も UI 上は 'gif' と名付ける）。本物の image/gif は静止画で、jpg/png とまったく同じように
// 転送してサムネイルを作る（ネイティブホストの MEDIA_MIME_EXT がすでに image/gif を扱う）。
// ここでの undefined は「静止画として扱う」の意味で、写真のエントリで type が未設定なのと
// 同じ。動画のダウンロード経路とポスターが要るのは、実際に video/* で運ばれるものだけ
// (#119 St1)。
function misskeyDownloadType(f): 'video' | 'gif' | undefined {
  const t = f && f.type ? f.type : '';
  if (t.startsWith('video/')) return /gif/i.test(t) ? 'gif' : 'video';
  return undefined;
}

// DriveFile はどの添付の型（image でも video でも）にも直接の `url` を出す＝X と違って
// 変種を選ぶ必要が無い。`thumbnailUrl` は、動画の経路が要るエントリでのポスターのコマ。
function misskeyMedia(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => f && f.url && misskeyItemType(f))
    .map((f) => {
      const type = misskeyDownloadType(f);
      return {
        url: f.url,
        alt: f.comment || null,
        width: (f.properties && f.properties.width) || null,
        height: (f.properties && f.properties.height) || null,
        type,
        poster: type ? f.thumbnailUrl || null : undefined,
      };
    });
}

// #180: このエンドポイントでは、リノート・返信の相手が完全な Note オブジェクトとして届く
// （note.renote / note.reply）。最上位のノートと同じ形なので、サイドカーのサブレコードは
// 親とまったく同じ欄の読み方で組み立てられ、追加の要求も要らない。
function misskeyQuotedRef(note, host): { url: string | null; displayName: string | null; screenName: string | null; userId: string | null; avatar: string | null; text: string | null; date: string | null; cw: string | null; media: ReturnType<typeof misskeyMedia> } | null {
  if (!note) return null;
  return {
    url: note.url || note.uri || `https://${host}/notes/${note.id}`,
    displayName: (note.user && note.user.name) || null,
    screenName: note.user ? (note.user.host ? `${note.user.username}@${note.user.host}` : note.user.username) : null,
    userId: (note.user && note.user.id) || null,
    avatar: (note.user && note.user.avatarUrl) || null,
    text: note.text || null,
    date: toIso(note.createdAt),
    cw: note.cw || null,
    media: misskeyMedia(note.files),
  };
}

// #179: note.poll は {multiple, expiresAt, choices[{text, votes, isVoted}]}（実物で確認＝
// scripts/canary/snapshots/misskey.json の 'poll' の出所）。choices[].isVoted は閲覧者自身の
// 状態で、こちらは常に匿名なので、アンケートについて何も語らない「未投票」を永久に保存する
// のではなく落とす。締切の無いアンケートでは expiresAt が null になり、Misskey はそれを許す。
function misskeyPoll(poll): Poll | null {
  if (!poll || !Array.isArray(poll.choices)) return null;
  return {
    choices: poll.choices.filter((c) => c && typeof c.text === 'string').map((c) => ({ text: c.text as string, votes: typeof c.votes === 'number' ? c.votes : null })),
    multiple: typeof poll.multiple === 'boolean' ? poll.multiple : null,
    expiresAt: toIso(poll.expiresAt),
    // Misskey に重複を除いた投票者の数は無く、選択肢ごとの集計しか無い。
    votersCount: null,
  };
}

// #289: users/show の fields[] は {name, value} の対（Mastodon の fields[].verified_at と
// 違い、Misskey に確認の概念は無い）。misskey.io の実物で確認、2026-08-02。
function misskeyProfileLinks(fields: unknown): { name: string; value: string; verifiedAt: string | null }[] | null {
  if (!Array.isArray(fields) || !fields.length) return null;
  const out = fields.filter((f) => f && typeof f.name === 'string' && f.name && typeof f.value === 'string' && f.value).map((f) => ({ name: f.name as string, value: f.value as string, verifiedAt: null }));
  return out.length ? out : null;
}

// #290: note.emojis は shortcode → URL の対応表＝packedNoteSchema 自身の 'emojis' プロパティ
// で、reactionEmojis（リアクションの選択画面のアイコン）や user.emojis（投稿者の名前欄の
// 絵文字）とは別物。misskey.io のローカルタイムラインの実物で確認、2026-08-02＝:shortcode:
// のテキストを使うノートは {"ha_to":"https://media.niri.la/misskey/....png"} のような値を
// 持ち、1つも使っていないノートは空のオブジェクトを送るのではなくキーごと省く。だから
// typeof で守っている（undefined に Object.entries を掛けると例外が飛ぶ）。
function misskeyCustomEmojis(emojis) {
  if (!emojis || typeof emojis !== 'object') return [];
  return Object.entries(emojis)
    .filter(([shortcode, emojiUrl]) => shortcode && typeof emojiUrl === 'string' && emojiUrl)
    .map(([shortcode, emojiUrl]) => ({ shortcode, url: emojiUrl as string }));
}

async function fetchMisskeyNote(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'misskey');
  // 正規の permalink。保存された URL はクエリやハッシュを持ちうるので、素の
  // https://<instance>/notes/<id> の形へ組み直す（利用者が見ていたインスタンスで開く）。
  rec.url = `https://${parsed.host}/notes/${parsed.noteId}`;
  try {
    const res = await fetch(`https://${parsed.host}/api/notes/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: parsed.noteId }),
    });
    if (!res.ok) return rec;
    const note = await readJsonKeepingRaw(rec, 'api:misskey/notes-show', res);
    rec.text = note.text || null;
    rec.customEmojis = misskeyCustomEmojis(note.emojis);
    // #178: 投稿者が書いた閲覧注意の文言（misskey.io の実際のノート、2026-07-30＝
    // scripts/canary/snapshots/misskey.json の 'cw' の出所）。このエンドポイントにノート
    // 単位の配慮の真偽値は無い（添付ファイルごとの isSensitive があるだけで、それは別の
    // 事実）＝rec.sensitive は null のまま。
    rec.cw = note.cw || null;
    rec.poll = misskeyPoll(note.poll);
    rec.date = toIso(note.createdAt);
    if (note.user) {
      rec.displayName = note.user.name || null;
      // 連合先の投稿者は、自分のホームのサーバーを user.host に持つ。これを残す
      // （Mastodon の acct と同じ user@host の形）ことで、別のインスタンスにいる同名の
      // ユーザーが1つの素性に潰れないようにする。
      rec.screenName = note.user.username ? (note.user.host ? `${note.user.username}@${note.user.host}` : note.user.username) : null;
      rec.userId = note.user.id || null;
      rec.avatar = note.user.avatarUrl || null; // UserLite がアバターの URL を持っている
    }
    // フォロワー数とアカウントの作成日。ノートに載る UserLite はこれらを持たないので、
    // 同じインスタンスから id でユーザー全体を取りにいく（expectedHost の SSRF の防ぎで
    // すでにホストは固定されているので、新しいホストへは接触しない）。フォロワー数を隠して
    // いるユーザーは null か0を返す → 穏当に済む。失敗してもアバターは残る。
    if (note.user && note.user.id) {
      try {
        const ures = await fetch(`https://${parsed.host}/api/users/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: note.user.id }),
        });
        if (ures.ok) {
          const u = await readJsonKeepingRaw(rec, 'api:misskey/users-show', ures);
          rec.avatar = u.avatarUrl || rec.avatar;
          rec.followers = u.followersCount ?? null;
          rec.authorCreatedAt = toIso(u.createdAt);
          // #289: 自己紹介・リンク・バナーは、上の followers/authorCreatedAt のためにすでに
          // 取得している同じ users/show のレスポンスに相乗りする＝追加の要求は無い。
          rec.bio = u.description || null;
          rec.profileLinks = misskeyProfileLinks(u.fields);
          rec.banner = u.bannerUrl || null;
        }
      } catch {
        /* note.user から得たアバターはそのまま残す */
      }
    }
    if (note.reactions) {
      const total: number = Object.values(note.reactions as Record<string, number>).reduce((s: number, n: number) => s + n, 0);
      rec.likes = total > 0 ? total : 0;
    }
    rec.reposts = note.renoteCount ?? null;
    rec.replies = note.repliesCount ?? null;
    if (note.lang) rec.lang = note.lang;
    // note.tags[] はサーバー自身が抽出したもの (#177)。Misskey は投稿の時点で本文・閲覧
    // 注意・アンケートの選択肢の MFM を解析し、ハッシュタグを裸の文字列として保存する＝
    // '#' は付かず、小文字化する normalizeForSearch を通してある。本文を解析し直さずこの欄を
    // 読むことが、閲覧注意の文言に書かれたタグを取り落とさない鍵。
    rec.hashtags = normalizeHashtags(Array.isArray(note.tags) ? note.tags : []);
    rec.mediaType = misskeyMediaType(note.files);
    rec.media = misskeyMedia(note.files);
    if (note.replyId) {
      rec.isReply = true;
      rec.replyToId = note.replyId;
      if (note.reply && note.reply.userId && note.reply.userId === note.userId) {
        rec.isThread = true;
        rec.isReply = null;
      }
      // #180: 返信の相手は、このレスポンスの中にすでに中身ごと届いている（note.reply）。
      // 他にどのプラットフォームがこれを得るか（#806 以降は X）、Bluesky と Mastodon が
      // なぜ得ないかは、types.ts の PostRecord.replyToPost を参照。
      rec.replyToPost = misskeyQuotedRef(note.reply, parsed.host);
    }
    // リノートは、自分自身のものを何か足しているとき引用と数える＝本文、閲覧注意、
    // ファイル、アンケートのいずれか（misskey-js の isPureRenote と同じ意味）。本文だけを
    // 見る検査では、画像だけの引用を取りこぼしていた。(audit 2026-06-11)
    if (note.renoteId && (note.text || note.cw || (Array.isArray(note.files) && note.files.length) || (Array.isArray(note.fileIds) && note.fileIds.length) || note.poll)) {
      rec.isQuote = true;
      // 引用されたノート自身の正規の URL を優先する。連合先のノートは url/uri を出すが、
      // このインスタンスにローカルなノートはどちらも持たないので、ローカルのホストの
      // permalink へ退避する。
      if (note.renote) {
        rec.quotedUrl = note.renote.url || note.renote.uri || `https://${parsed.host}/notes/${note.renoteId}`;
        rec.quotedPost = misskeyQuotedRef(note.renote, parsed.host);
      }
    }
  } catch {
    // 部分的なまま残す
  }
  return rec;
}

// === extractor 本体 ===

const misskey: Extractor = {
  platform: 'misskey',

  parseUrl(u) {
    const m = u.pathname.match(/^\/notes\/([^/?#]+)/);
    if (!m) return null;
    return { platform: 'misskey', host: u.hostname, noteId: m[1] };
  },
  // インスタンスは任意のホストなので、照合すべき許可一覧が無い＝どの https のオリジンも
  // 頼んでよい。敵対的なページがこちらの特権付きバックグラウンド fetch を好きな先へ向ける
  // のを止めているのは、derivedApiHost と呼び出し元の expectedHost。
  isAllowedOrigin: (tabUrl) => /^https:/i.test(tabUrl || ''),
  derivedApiHost: (parsed) => parsed.host ?? null,

  fetchPost: fetchMisskeyNote,

  mediaKey: fileBasenameKey,

  matchesPage: looksLikeMisskey,

  capture: {
    platform: 'misskey',
    captureStyleText: `
        .__snsCaptureMisskeyNoHover,
        .__snsCaptureMisskeyNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }

        .__snsCaptureMisskeyNoHover a,
        .__snsCaptureMisskeyNoHover a:hover,
        .__snsCaptureMisskeyNoHover button,
        .__snsCaptureMisskeyNoHover button:hover {
          color: inherit !important;
          text-decoration: none !important;
        }
      `,
    findPostElement(target: EventTarget | null) {
      return findMisskeyPostElement(target);
    },
    getPermalink(post: Element): string {
      return getMisskeyPermalink(post);
    },
    getCaptureRect(post: Element): PostRect {
      return getMisskeyCaptureRect(post);
    },
    prepareForCapture(post: Element) {
      return prepareScopedCaptureState('__snsCaptureMisskeyNoHover', [post, getMisskeyPrimaryArticle(post)]);
    },
    extractDomMeta: extractMisskeyDomMeta,
  },

  mediaIdentity: {
    platform: 'misskey',
    extractIdentity: extractMisskeyIdentity,
    isPostMedia: isMisskeyPostMedia,
  },

  overlay: {
    // isMisskeyNoteElement の article の検査を写したもの（permalink の側は
    // capture.getPermalink/extractIdentity に任せる。あちらはノートの詳細ページで URL バー
    // へ退避する仕組みをすでに持つ＝getMisskeyPermalink を参照）。これが、自分の <article>
    // を持たない返信先の親のプレビューを締め出している。
    unitSelector: 'div[tabindex="0"]:has(article)',
    // getMisskeyPermalink と同じく、そのノート自身の <article> の中に限る。返信先の親の
    // プレビューはその前に描かれ、メディアを供出してはいけない。保存ボタンの門を張るだけ
    // でなくここで isPostMedia を掛けているのは（X の LI タイルの分岐も同じ）、Misskey には
    // 後から絞り込める CDN のパスの信号が無いから。
    mediaIn: (unit) => {
      const scope = getMisskeyPrimaryArticle(unit) || unit;
      return [...scope.querySelectorAll<PostMediaElement>('img, video')].filter((el) => isMisskeyPostMedia(el));
    },
  },

  // #238: misskey.io だけ。「どの Misskey インスタンスでも」という一般の場合は #204 の担当
  // （任意のホスト権限＋利用者による登録）。Mastodon のインスタンスには必須のホスト権限を
  // 与えないのに misskey.io だけには与える価値がある理由は、#238 の決定の記録を参照。
  residentMatches: ['https://misskey.io/*'],
};

export default misskey;
export { extractMisskeyDomMeta, extractMisskeyIdentity, fetchMisskeyNote, findMisskeyPostElement, getMisskeyPermalink, isMisskeyPostMedia, looksLikeMisskey, misskeyCustomEmojis, misskeyMedia, parseMisskeyNoteLink };
export type { MisskeyNoteLink };

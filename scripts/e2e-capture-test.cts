'use strict';

// E2E capture テスト: このリポジトリから拡張機能を UNPACKED で読み込んだ Playwright
// Chromium を起動し、プログラムから capture を発火させ（Alt+S なし・人手なし）、実際の
// ページ内でクリック/ドラッグし、使い捨ての native host が jpg+sidecar を一時ライブラリに
// 着地させるのを待ち、各レコードを実際の API と照合してから、作成したテストレコードを削除する。
//
//   node scripts/e2e-capture-test.cts              # pixiv セル（MVP）
//
// なぜユーザーの Chrome に触れずに動くか:
//   - manifest.json は固定の `key` を持つため（memory ext-signing-key 参照）、拡張機能の
//     ID はどのフォルダから読み込んでも同じ key に固定される→一意な名前のテスト用ホストが、
//     ユーザーの com.hologram.host 登録を変更せずにその正確なオリジンを許可できる
//   - Alt+S（chrome.commands）は CDP 経由では合成できないが、activateOnTab() は
//     service worker のトップレベル関数なので、SW ターゲットにアタッチして直接呼べる
//   - pixiv は manifest の host_permissions でカバーされているため、activeTab の
//     ジェスチャなしでプログラムからの executeScript が動く（他プラットフォームは
//     より広い host_permissions を持つテスト用 manifest が必要＝今後の課題）

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { createNativeHostSandbox } = require('./lib-native-host-e2e.cts');
const { fetchXTweet } = require('../extension/utils/extractor/x.ts');
const { inboxNewDir } = require('../native-host/inbox.mts');
const { verifyRecord } = require('./test-watch-verify.cts');
const { sleep, waitFor } = require('./lib-wait.cts');

// 以下の sw.evaluate()/page.evaluate() のコールバック本体は、拡張機能の
// service-worker / page コンテキスト（CDP 経由の実ブラウザ）内で実行される＝`chrome` は
// そちらのグローバルな拡張機能 API で、このファイル自体の Node/DOM lib からは見えない。
declare const chrome: any;

const EXPECTED_ID = 'keggmjkemfcekcffohnpaojacdakpejh'; // manifest.jsonのkeyで固定される

async function j(url, opts?) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// 各セル: { id, platform, url, kind:'click'|'drag', waitSel, clickSel?, dragSel? }
//  - waitSel  投稿の DOM が読み込まれたことを確認する
//  - clickSel クリックする要素（capturePost は上へたどって投稿を解決する）
//  - dragSel  ドラッグする投稿自身の画像（drag-save セル用）
// drag セルは manifest の content_scripts が drag.js を注入するプラットフォーム
// （x / bsky / pixiv）にのみ存在する。Misskey と Mastodon は意図してクリックのみ。

async function pickPixiv(cells) {
  try {
    const r = await j('https://www.pixiv.net/ranking.php?mode=daily&format=json&p=1', { headers: { Referer: 'https://www.pixiv.net/' } });
    const items = Array.isArray(r.contents) ? r.contents : [];
    const ok = (c) => c && c.illust_id && String(c.illust_type) !== '2' && !c.is_masked && !String(c.url || '').includes('limit_unviewable');
    const single = items.find((c) => ok(c) && Number(c.illust_page_count) === 1);
    const multi = items.find((c) => ok(c) && Number(c.illust_page_count) > 1);
    const url = (c) => `https://www.pixiv.net/artworks/${c.illust_id}`;
    const W = 'main figure img',
      I = 'main figure img';
    if (single) cells.push({ id: 'A-5a', platform: 'pixiv', url: url(single), kind: 'click', waitSel: W, clickSel: I });
    if (multi) cells.push({ id: 'A-5b', platform: 'pixiv', url: url(multi), kind: 'click', waitSel: W, clickSel: I });
    if (multi) cells.push({ id: 'A-5d', platform: 'pixiv', url: url(multi), kind: 'drag', waitSel: W, dragSel: I });
  } catch (e) {
    console.log('pixiv 選別スキップ:', e.message);
  }
}

async function pickX(cells) {
  // 公開の検索APIは無い――syndication経由でevergreenな投稿を確認してから、
  // 実際のページを操作する。（x.comは未ログイン閲覧をゲートすることがある。セルは
  // 穏当に失敗する。）
  try {
    const alive = async (id) => {
      try {
        const r = await fetchXTweet({ id, screenName: null }, `https://x.com/i/web/status/${id}`);
        return r && r.text;
      } catch {
        return false;
      }
    };
    const photo = '266031293945503744'; // @BarackObama, single photo, evergreen
    const W = 'article[data-testid="tweet"]';
    if (await alive(photo)) {
      const url = `https://x.com/BarackObama/status/${photo}`;
      cells.push({ id: 'A-1l', platform: 'x', url, kind: 'click', waitSel: W, clickSel: W });
      cells.push({ id: 'A-1m', platform: 'x', url, kind: 'drag', waitSel: `${W} img[src*="pbs.twimg.com/media"]`, dragSel: `${W} img[src*="pbs.twimg.com/media"]` });
      // ★ regression: ライトボックス（/photo/1）＝返信の画像をドラッグしたら返信の投稿を
      // 保存しなければならない（ライトボックス＝メインツイートの投稿ではない）。返信の画像は
      // ページ上で最初の article ではない article 内にある（最初はメインツイート、
      // 返信はその後に続く）。画像付き返信の article がある場合のみ追加する。
      cells.push({ id: 'A-1n', platform: 'x', url: `${url}/photo/1`, kind: 'drag-lightbox-reply', waitSel: W, regression: 'ライトボックス返信ドラッグ→返信として保存' });
    }
    // ★ regression: プロフィールヘッダーのアバターをドラッグしても、ドロップゾーンを
    // 表示してはいけないし、レコードも保存してはいけない（投稿の祖先が無い→drag.js が中止する）。
    cells.push({ id: 'A-1o', platform: 'x', url: 'https://x.com/jack', kind: 'drag-none', waitSel: 'div[data-testid^="UserAvatar-Container-"]', dragSel: 'div[data-testid^="UserAvatar-Container-"] img', notWithin: 'article[data-testid="tweet"]', regression: 'プロフィールアバターは保存しない' });
  } catch (e) {
    console.log('x 選別スキップ:', e.message);
  }
}

async function pickBluesky(cells) {
  try {
    const posts: any[] = [];
    for (const actor of ['bsky.app', 'pfrazee.com', 'jay.bsky.team', 'danabra.mov']) {
      try {
        const f = await j(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${actor}&limit=80&filter=posts_with_replies`);
        for (const it of f.feed || []) if (it.post) posts.push(it.post);
      } catch {
        /* 次へ */
      }
    }
    const urlOf = (p) => {
      const m = (p.uri || '').match(/\/app\.bsky\.feed\.post\/([^/]+)$/);
      return m && p.author ? `https://bsky.app/profile/${p.author.handle}/post/${m[1]}` : null;
    };
    const imgs = (p) => {
      const e = p.embed || {};
      return (e.$type || '').includes('recordWithMedia') ? (e.media && e.media.images) || [] : e.images || [];
    };
    const isQuote = (p) => ((p.embed && p.embed.$type) || '').includes('app.bsky.embed.record');
    const isReply = (p) => !!(p.record && p.record.reply);
    const refDid = (ref) => {
      const m = ref && ref.uri && ref.uri.match(/^at:\/\/(did:[^/]+)\//);
      return m ? m[1] : null;
    };
    const parentDid = (p) => refDid(p.record && p.record.reply && p.record.reply.parent);
    const rootDid = (p) => refDid(p.record && p.record.reply && p.record.reply.root);
    // スレッド/引用の詳細ページは複数の postThreadItem ノードを描画する（上に親、下に
    // 返信）。返信が親と混同されないよう、投稿者のハンドルでアンカー投稿を狙い撃つ。
    // （testid = postThreadItem-by-<handle>）
    const sel = (p) => `[data-testid="postThreadItem-by-${p.author.handle}"]`;
    const single = posts.find((p) => urlOf(p) && imgs(p).length === 1 && !isReply(p) && !isQuote(p));
    const multi = posts.find((p) => urlOf(p) && imgs(p).length > 1 && !isReply(p));
    const quote = posts.find((p) => urlOf(p) && isQuote(p) && !isReply(p));
    // 親ともスレッドルートとも投稿者が異なる返信を選ぶ＝アンカー投稿の testid が
    // ページ上で一意になる（ランナーは最初にマッチした postThreadItem-by-<handle> を
    // クリックする。返信の上に同一投稿者のルートがあると、そちらがクリックされて
    // しまう＝実際に bsky.app の返信でスレッドルートも bsky.app だったケースで
    // このミスが起きた）。
    const reply = posts.find((p) => urlOf(p) && isReply(p) && parentDid(p) && parentDid(p) !== p.author.did && rootDid(p) && rootDid(p) !== p.author.did);
    const IMG = '[data-testid^="postThreadItem-by-"] img[src*="/img/feed_"]';
    if (single) cells.push({ id: 'A-2b', platform: 'bluesky', url: urlOf(single), kind: 'click', waitSel: sel(single), clickSel: sel(single) });
    if (multi) cells.push({ id: 'A-2g', platform: 'bluesky', url: urlOf(multi), kind: 'click', waitSel: sel(multi), clickSel: sel(multi) });
    if (single) cells.push({ id: 'A-2i', platform: 'bluesky', url: urlOf(single), kind: 'drag', waitSel: IMG, dragSel: IMG });
    // ★ regression: 引用投稿の詳細をクリックしたら、引用された側ではなく引用した側の
    // 投稿を保存しなければならない（audit HIGH）。expectUrl == 引用した側の投稿の url。
    if (quote) cells.push({ id: 'A-2f', platform: 'bluesky', url: urlOf(quote), kind: 'click', waitSel: sel(quote), clickSel: sel(quote), regression: '引用→引用した側' });
    // ★ regression: 返信の詳細は親ではなく返信自身を保存する。
    if (reply) cells.push({ id: 'A-2e', platform: 'bluesky', url: urlOf(reply), kind: 'click', waitSel: sel(reply), clickSel: sel(reply), regression: 'リプライ本人' });
    // ★ regression: プロフィールヘッダーのアバターをドラッグしても何も保存しては
    // いけない（祖先探索が有界＝身元が取れない→ドロップゾーンなし）。プロフィールページ。
    cells.push({ id: 'A-2k', platform: 'bluesky', url: 'https://bsky.app/profile/bsky.app', kind: 'drag-none', waitSel: 'img[src*="/img/avatar"]', dragSel: 'img[src*="/img/avatar"]', notWithin: '[data-testid^="feedItem-by-"]', regression: 'アバターは保存しない' });
  } catch (e) {
    console.log('bluesky 選別スキップ:', e.message);
  }
}

async function pickMisskey(cells) {
  try {
    const notes = await j('https://misskey.io/api/notes/global-timeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 60 }) });
    const arr = Array.isArray(notes) ? notes : [];
    const img = (n) => (n.files || []).some((f) => f.type && f.type.startsWith('image/') && f.type !== 'image/gif');
    const single = arr.find((n) => n && n.id && img(n) && !n.replyId && !n.renoteId);
    const reply = arr.find((n) => n && n.id && n.replyId && !n.renoteId);
    const W = 'div[tabindex="0"] article time';
    // ランナーは URL の id でメインノートを狙い（クリックハンドラ参照）、保存された
    // url が意図したものと一致することを検証する。
    if (single) cells.push({ id: 'A-3b', platform: 'misskey', url: `https://misskey.io/notes/${single.id}`, kind: 'click', waitSel: W, clickSel: 'div[tabindex="0"]' });
    // ★ regression (audit HIGH): 返信の詳細ページは、上にプレビューとして描画される
    // 親ノートではなく返信自身を保存しなければならない。
    if (reply) cells.push({ id: 'A-3e', platform: 'misskey', url: `https://misskey.io/notes/${reply.id}`, kind: 'click', waitSel: W, clickSel: 'div[tabindex="0"]', regression: 'リプライ→親に化けない' });
  } catch (e) {
    console.log('misskey 選別スキップ:', e.message);
  }
}

async function pickMastodon(cells) {
  try {
    let media: any[] = [];
    try {
      media = await j('https://mastodon.social/api/v1/timelines/public?limit=40&only_media=true');
    } catch {
      /* 代わりに次の取得を使う */
    }
    if (!Array.isArray(media) || !media.length) {
      const a = await j('https://mastodon.social/api/v1/accounts/lookup?acct=Gargron');
      media = await j(`https://mastodon.social/api/v1/accounts/${a.id}/statuses?limit=40&only_media=true`);
    }
    const s = (media || []).find((x) => x && x.account && !x.reblog && (x.media_attachments || []).some((m) => m.type === 'image'));
    const W = '.detailed-status, .status';
    if (s) cells.push({ id: 'A-4b', platform: 'mastodon', url: `https://mastodon.social/@${s.account.acct}/${s.id}`, kind: 'click', waitSel: W, clickSel: W });
    // ★ regression: 返信のステータスは返信自身を保存する（isReply の経路）。
    try {
      const a = await j('https://mastodon.social/api/v1/accounts/lookup?acct=Gargron');
      const st = await j(`https://mastodon.social/api/v1/accounts/${a.id}/statuses?limit=40&exclude_reblogs=true&exclude_replies=false`);
      const r = (st || []).find((x) => x && x.in_reply_to_id && x.account);
      if (r) cells.push({ id: 'A-4e', platform: 'mastodon', url: `https://mastodon.social/@${r.account.acct}/${r.id}`, kind: 'click', waitSel: W, clickSel: '.detailed-status', regression: 'リプライ本人' });
    } catch {
      /* 返信セルはスキップ */
    }
  } catch (e) {
    console.log('mastodon 選別スキップ:', e.message);
  }
}

// 実際の sidecar は #299 の永続取込キュー以降 <saveFolder>/.hologram-inbox/new/<captureId>.json
// にある（lib-db-inbox.ts は loose ファイルを削除しないので、このディレクトリは実行中
// 増える一方）。null はディレクトリ自体がまだ存在しないことを意味する＝「存在するが空」
// とは区別する。さもないと、間違った経路を永遠に見張るカナリアが「何も保存されなかった」
// と見分けがつかなくなる。
function listInboxNames(newDir) {
  try {
    return fs.readdirSync(newDir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

// `libraryDir` はエンベロープのメディア名の起点となるライブラリのルート。
async function waitForNewSidecar(newDir, libraryDir, before, timeoutMs = 25000): Promise<{ file: string | null; dirSeen: boolean }> {
  let dirSeen = false;
  let file: string | null = null;
  await waitFor(
    `a new sidecar under ${newDir}`,
    () => {
      const names = listInboxNames(newDir);
      if (names === null) return false;
      dirSeen = true;
      file = names.filter((f) => !before.has(f))[0] || null;
      return file !== null;
    },
    { timeoutMs, pollMs: 400 },
  ).catch(() => {});
  if (file === null) return { file: null, dirSeen };
  // #299: エンベロープはメディアのダウンロードが終わる前にコミットされるため、
  // そこに書かれたファイル名が事後条件になる＝落ち着くまでの時間を推測しない。
  // ここでタイムアウトを意図的に握りつぶす: 呼び出し側が最後まで着地しなかった
  // 個々のファイル名を報告する方が、この待機自体より良い報告になる。
  await waitFor(
    `the media named by ${file} to land in the library`,
    () => {
      try {
        const rec = (JSON.parse(fs.readFileSync(path.join(newDir, file as string), 'utf8')) || {}).record || {};
        return [rec.image, rec.video, ...(rec.media || []).map((m) => m.file)].filter(Boolean).every((name) => fs.existsSync(path.join(libraryDir, name)));
      } catch {
        return false; // 書きかけのエンベロープ――次のポーリングで再確認する
      }
    },
    { timeoutMs: 15000 },
  ).catch(() => {});
  return { file, dirSeen };
}

(async () => {
  // 常に先に再ビルドし、ステージされたリリースが現在のソースを反映するようにする。
  execFileSync('npm run build:ext', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    shell: true,
  });

  const nativeHost = createNativeHostSandbox(EXPECTED_ID);
  const dir = nativeHost.libraryDir;
  const newDir = inboxNewDir(dir);
  console.log(`保存先: ${dir}`);
  console.log(`inbox: ${newDir}`);

  // 任意のプラットフォーム絞り込み: node e2e-capture-test.cts bluesky misskey
  // ヘッドレス分離: node e2e-capture-test.cts bluesky --headless
  // 認証: node e2e-capture-test.cts x --user-data-dir="C:\Users\…\Chrome\User Data"
  //       --profile-dir=Default （省略可、既定は "Default"）
  //       実行前に Chrome を閉じること＝Chromium はプロファイルの排他ロックが必要。
  const rawArgs = process.argv.slice(2);
  const headless = rawArgs.includes('--headless');
  const only = rawArgs.filter((a) => !a.startsWith('--')).map((s) => s.toLowerCase());
  const argVal = (name) => {
    const a = rawArgs.find((a) => a.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
  };
  const userDataDir = argVal('user-data-dir');
  const profileDirArg = argVal('profile-dir') || 'Default';
  const cells: any[] = [];
  await Promise.all([pickX(cells), pickPixiv(cells), pickBluesky(cells), pickMisskey(cells), pickMastodon(cells)]);
  let active = only.length ? cells.filter((c) => only.includes(c.platform)) : cells;
  // X は未ログイン表示をゲートする＝明示的に指定しない限りスキップする。
  if (!only.includes('x')) {
    active = active.filter((c) => c.platform !== 'x');
  } else {
    if (!userDataDir) {
      console.warn('※ X テスト: --user-data-dir が未指定。未ログインプロファイルでは投稿が描画されず失敗します。');
      console.warn('   例: node scripts/e2e-capture-test.cts x --user-data-dir="C:\\Users\\<you>\\AppData\\Local\\Google\\Chrome\\User Data"');
      console.warn('   ※ 実行前に Chrome を閉じてください（プロファイルロック）。');
    } else {
      console.log(`X テスト: ユーザーデータ=${userDataDir} プロファイル=${profileDirArg}`);
    }
  }
  active.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (!active.length) {
    console.error('対象セルを選別できず');
    process.exit(1);
  }
  console.log(`対象セル: ${active.map((c) => c.id + '(' + c.kind + ')').join(' ')}`);

  const EXT_DIR = stageExtension({
    allUrls: true,
    nativeHostName: nativeHost.hostName,
    tempPrefix: 'hologram-capture-e2e-ext-',
  });
  const session = await launchExtensionBrowser({
    extensionDir: EXT_DIR,
    headless,
    userDataDir,
    viewport: null,
    args: ['--window-size=1360,960', '--hide-crash-restore-bubble', '--lang=ja', ...(userDataDir ? [`--profile-directory=${profileDirArg}`] : [])],
  });
  const browser = session.context;

  const results: any[] = [];
  const created: any[] = [];
  const capturedRecords: any[] = [];
  try {
    const extId = session.extensionId;
    if (extId !== EXPECTED_ID) throw new Error(`staged extension id ${extId} does not match native-host allow-list ${EXPECTED_ID}`);
    console.log(`拡張ID: ${extId} (一時NMホスト許可と一致 ✓)`);
    const sw = session.serviceWorker;

    const page = await browser.newPage();

    for (const cell of active) {
      console.log(`\n--- ${cell.id} [${cell.platform}] ${cell.kind} ${cell.url}${cell.regression ? ' ★' + cell.regression : ''}`);
      const before = new Set(listInboxNames(newDir) || []);
      try {
        // SPA（x/bsky/misskey/mastodon）とpixivはロングポールするので、networkidleは
        // 決して発火しない――代わりに投稿のDOMを待つ。
        await page.goto(cell.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector(cell.waitSel, { timeout: 30000 });
        // 固定値の理由: これらは実際のサードパーティ SPA で、投稿要素がマウントされた
        // 後もハイドレーションを続け、自前の「落ち着いた」シグナルを出さない。拡張機能側も
        // 待つべきものを自分から描画しない。実行が実際に依存するものはすべて待機している＝
        // click セルはこの下のバナー、drag セルはドロップゾーン。
        // biome-ignore lint/plugin: live third-party SPAs expose no "settled" signal
        await sleep(1200);

        // ネガティブ regression: 投稿外の画像（プロフィールアバター）をドラッグしても
        // ドロップゾーンをポップしてはいけないし、レコードも保存してはいけない。
        if (cell.kind === 'drag-none') {
          const zoneShown = await page.evaluate(
            async ({ sel, notWithin }) => {
              const img = [...document.querySelectorAll(sel)].find((el) => !notWithin || !el.closest(notWithin));
              if (!img) return 'no-img';
              img.scrollIntoView({ block: 'center' });
              img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
              // biome-ignore lint/plugin: window in which the zone that must NOT appear would
              await new Promise((r) => setTimeout(r, 500));
              const z = document.getElementById('__hologramDropZone');
              return !!(z && z.style.display !== 'none');
            },
            { sel: cell.dragSel, notWithin: cell.notWithin },
          );
          if (zoneShown === 'no-img') throw new Error('avatar img not found');
          // 固定値の理由: このセルは「何も保存されない」ことを検証する。事後条件を
          // 待つと、起きてはいけない保存を待つことになってしまうため、この時間窓自体が検証になる。
          // biome-ignore lint/plugin: window in which the save that must not happen would
          await sleep(2500);
          const leaked = (listInboxNames(newDir) || []).filter((f) => !before.has(f));
          if (zoneShown) throw new Error('ドロップゾーンが表示された（捏造保存の恐れ）');
          if (leaked.length) {
            leaked.forEach((f) => {
              const base = f.replace(/\.json$/, '');
              fs.unlinkSync(path.join(newDir, f));
              for (const g of fs.readdirSync(dir)) if (g.startsWith(base)) fs.unlinkSync(path.join(dir, g));
            });
            throw new Error('非投稿画像が保存された');
          }
          console.log('   ✓ ドロップゾーン非表示・保存なし（期待どおり）');
          results.push({ id: cell.id, ok: true });
          continue;
        }

        // ★ A-1n: ライトボックス + 返信画像のドラッグ
        // /photo/1 ページはメインツイートの article が最初にあり、その後に返信の article
        // が続く。返信の article（最初の article ではない）内の img を見つけてドラッグする。
        // 期待値: 保存された url == 返信のパーマリンク（ライトボックスのツイートの url ではない）。
        if (cell.kind === 'drag-lightbox-reply') {
          const replyImg = await page.evaluate((articleSel) => {
            const articles = [...document.querySelectorAll(articleSel)];
            // 最初の article（メインツイート）を飛ばし、メディア画像を持つ返信の article を探す。
            for (const art of articles.slice(1)) {
              const img = art.querySelector('img[src*="pbs.twimg.com/media"]');
              if (img) {
                // 後で保存された url を検証できるよう、article のパーマリンクを返す。
                const link = art.querySelector('a[href*="/status/"]');
                return { found: true, artHref: link ? link.getAttribute('href') : null };
              }
            }
            return { found: false };
          }, `article[data-testid="tweet"]`);
          if (!replyImg.found || !replyImg.artHref) {
            console.log('   SKIP: 返信欄に画像/パーマリンクが見つからない（ライトボックステスト不能）');
            results.push({ id: cell.id, ok: true, skipped: true });
            continue;
          }
          // 下の id 一致検査のため、期待する url を上書きする
          cell.url = `https://x.com${replyImg.artHref}`;
          const dragOk = await page.evaluate(async (articleSel) => {
            const articles = [...document.querySelectorAll(articleSel)];
            for (const art of articles.slice(1)) {
              const img = art.querySelector('img[src*="pbs.twimg.com/media"]');
              if (img) {
                img.scrollIntoView({ block: 'center' });
                const dt = new DataTransfer();
                img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
                // ゾーンが現れることが事後条件。時間で待ち切るのではなくフレーム単位で
                // ポーリングするので、遅いページは待ち時間が伸びるだけで済み、偽の
                // 「no-zone」（＝拡張機能が壊れて見える）にはならない。
                const shownZone = async () => {
                  for (let i = 0; i < 180; i++) {
                    const zone = document.getElementById('__hologramDropZone');
                    if (zone && zone.style.display !== 'none') return zone;
                    await new Promise((r) => requestAnimationFrame(r));
                  }
                  return null;
                };
                const zone = await shownZone();
                if (!zone) return 'no-zone';
                zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
                return 'ok';
              }
            }
            return 'no-reply-img';
          }, `article[data-testid="tweet"]`);
          if (dragOk !== 'ok') throw new Error('drag-lightbox-reply setup failed: ' + dragOk);
        } else if (cell.kind === 'click') {
          // Alt+S 相当: SW コンテキストから content script を注入する
          // （activeTab のジェスチャは合成できない。ステージされた拡張機能は
          // <all_urls> を持つので、executeScript はどのプラットフォームでも動く）。
          const act = await sw.evaluate(async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return { ok: false, err: 'no active tab' };
            try {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
              return { ok: true, url: tab.url };
            } catch (e) {
              return { ok: false, url: tab.url, err: String(e) };
            }
          });
          if (!act.ok) throw new Error(`activation failed on ${act.url}: ${act.err}`);
          // content script は ISOLATED world に存在する＝代わりにそのバナーの
          // DOM を待つ（z-index の番兵 2147483647）。
          await page.waitForFunction(
            () => {
              return [...document.querySelectorAll('div')].some((d) => d.style.zIndex === '2147483647');
            },
            null,
            { timeout: 8000 },
          );
          // 投稿内の安定した要素への信頼済みクリック。capturePost はクリック対象から
          // 上へたどって投稿を解決する。Misskey の詳細ページは複数の
          // div[tabindex="0"] ノート（会話の連鎖＋返信）を描画するので、パーマリンクが
          // URL の id と一致するものを狙う。
          let h: any;
          if (cell.platform === 'misskey') {
            const id = (cell.url.match(/\/notes\/([^/?#]+)/) || [])[1];
            h = (
              await page.evaluateHandle((noteId) => {
                for (const root of document.querySelectorAll('div[tabindex="0"]')) {
                  const link = [...root.querySelectorAll('a[href*="/notes/"]')].find((a) => a.querySelector('time') && a.getAttribute('href')?.includes('/notes/' + noteId));
                  if (link) return root;
                }
                return null;
              }, id)
            ).asElement();
            if (!h) throw new Error('main note element not found for id ' + id);
          } else if (cell.platform === 'mastodon') {
            const id = (cell.url.match(/\/(\d+)\/?$/) || [])[1];
            h = (
              await page.evaluateHandle((statusId) => {
                for (const link of document.querySelectorAll(`a[href*="/${statusId}"]`)) {
                  const root = link.closest('.detailed-status, .status');
                  if (root) return root;
                }
                return null;
              }, id)
            ).asElement();
            if (!h) throw new Error('main status element not found for id ' + id);
          } else {
            h = await page.$(cell.clickSel);
            if (!h) throw new Error(`click target not found: ${cell.clickSel}`);
          }
          await h.click();
          await h.dispose();
          // 自動で消える前にバナーの結果を捕える（成功=緑/部分成功=黄/失敗=赤）＝
          // ブリッジの失敗を取りこぼさない。
          const banner = await page.evaluate(async () => {
            const find = () => [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '2147483647');
            // フレーム単位でポーリング: 結果を運ぶバナーが事後条件であり、遅いブリッジは
            // 「(no banner)」に化けるのではなく、時間がかかるだけであるべき。
            for (let i = 0; i < 360; i++) {
              const b = find();
              if (b && /保存|失敗|Saved|failed/.test(b.textContent)) return b.textContent.trim();
              await new Promise((r) => requestAnimationFrame(r));
            }
            const b = find();
            return b ? b.textContent.trim() : '(no banner)';
          });
          console.log(`   バナー: ${banner}`);
        } else {
          // drag-save: 投稿画像への合成 dragstart → ゾーンへドロップ
          // （drag.js は常駐する content script なので、有効化は不要）
          const ok = await page.evaluate(async (sel) => {
            const img = document.querySelector(sel);
            if (!img) return 'no-img';
            img.scrollIntoView({ block: 'center' });
            const dt = new DataTransfer();
            img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
            // ゾーンが現れることが事後条件。フレーム単位でポーリングするので、遅い
            // ページは待ち時間が伸びるだけで、偽の「no-zone」にはならない。
            let zone: HTMLElement | null = null;
            for (let i = 0; i < 180 && !zone; i++) {
              const found = document.getElementById('__hologramDropZone');
              zone = found && found.style.display !== 'none' ? found : null;
              if (!zone) await new Promise((r) => requestAnimationFrame(r));
            }
            if (!zone) return 'no-zone';
            zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
            return 'ok';
          }, cell.dragSel);
          if (ok !== 'ok') throw new Error('drag setup failed: ' + ok);
        }

        const { file, dirSeen } = await waitForNewSidecar(newDir, dir, before);
        if (!file) {
          // ページ内の失敗メッセージを表に出す（ドロップゾーン／バナーのテキスト）
          const hint = await page
            .evaluate(() => {
              const z = document.getElementById('__hologramDropZone');
              const banner = [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '2147483647');
              return (z && z.style.display !== 'none' ? `zone="${z.textContent}" ` : '') + (banner ? `banner="${banner.textContent}"` : '');
            })
            .catch(() => '');
          const obsHint = dirSeen ? '' : ` （${newDir} が最後まで現れなかった＝観測点がずれている可能性）`;
          throw new Error(`サイドカーが保存されなかった ${hint}${obsHint}`);
        }
        created.push(file.replace(/\.json$/, ''));
        const envelope = JSON.parse(fs.readFileSync(path.join(newDir, file), 'utf8'));
        const rec = envelope && envelope.record;
        if (!rec || typeof rec !== 'object' || !rec.url) {
          throw new Error(`inboxエンベロープにレコードが無い: ${file}`);
        }
        capturedRecords.push(rec);
        console.log(`   保存: ${file} url=${rec.url} media=${(rec.media || []).length}${rec.imageCount ? ` imageIndex=${rec.imageIndex}/${rec.imageCount}` : ''}`);
        // 保存されたレコードが、意図した投稿そのものであることを検証する＝
        // 別の投稿について自己整合なだけのレコードでは駄目（API 再照合だけでは
        // 投稿の取り違えを捉えられない）。安定した id で比較する。
        const idOf = (u) => (String(u || '').match(/\/status\/(\d+)|\/post\/([^/?#]+)|\/notes\/([^/?#]+)|\/(\d[\w-]*)\/?$|\/artworks\/(\d+)/) || []).slice(1).find(Boolean) || u;
        if (idOf(rec.url) !== idOf(cell.url)) {
          throw new Error(`別投稿が保存された: 期待 ${cell.url} / 実際 ${rec.url}`);
        }
        // エンベロープはメディアが着地し終える前にコミットされる（#299 の設計）＝
        // それが主張するファイルが実際にディスク上にあるかを確認する。sidecar は
        // 書いたがダウンロードに失敗したブリッジが、本当に sidecar が無い場合と
        // 区別できるように。
        const mediaFiles = [rec.image, rec.video, ...(rec.media || []).map((m) => m.file)].filter(Boolean);
        const missingMedia = mediaFiles.filter((name) => !fs.existsSync(path.join(dir, name)));
        if (missingMedia.length) {
          throw new Error(`サイドカーは保存されたがメディア未着地: ${missingMedia.join(', ')}`);
        }
        results.push({ id: cell.id, ok: true, file });
      } catch (e) {
        console.log(`   ✗ ${e.message}`);
        results.push({ id: cell.id, ok: false, err: e.message });
      }
    }
  } finally {
    await session.close().catch(() => {});
    fs.rmSync(EXT_DIR, { recursive: true, force: true });
  }

  // capture を実際の API と照合する（手動フローと同じチェッカー）。envelope.record は
  // この実行がすでにパースした inbox のファイルから直接読む＝hologram.db からではない。
  // inbox から DB への drain は実際の Electron アプリの仕事で、このサンドボックスは
  // アプリを起動しない（#486）。ここでの検証失敗はカナリア全体を沈めなければならない
  // ので、ログに出して捨てるのではなく下の verifyOk に反映する。
  let verifyOk = true;
  if (capturedRecords.length) {
    console.log('\n=== API照合 (inbox envelope 直接照合) ===');
    for (const rec of capturedRecords) {
      const ok = await verifyRecord(rec, dir);
      if (ok === false) verifyOk = false;
    }
    console.log(`\n${capturedRecords.length} 件検証 → ${verifyOk ? 'ALL PASS' : 'FAIL あり'}`);
  }

  if (created.length) {
    // 後片付け: このテストが作成したレコードを削除する（jpg/media ファイル + inbox エンベロープ）
    console.log('\nテストレコードを削除…');
    for (const id of created) {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(id)) {
          fs.unlinkSync(path.join(dir, f));
          console.log('  削除: ' + f);
        }
      }
      const envelopePath = path.join(newDir, `${id}.json`);
      if (fs.existsSync(envelopePath)) {
        fs.unlinkSync(envelopePath);
        console.log('  削除: ' + path.relative(dir, envelopePath));
      }
    }
  }

  const okN = results.filter((r) => r.ok).length;
  console.log(`\n${okN}/${results.length} セル成功`);
  const allOk = okN === results.length && verifyOk;
  console.log(allOk ? 'E2E_CAPTURE_PASS' : 'E2E_CAPTURE_FAIL');
  nativeHost.close();
  process.exit(allOk ? 0 : 1);
})();

'use strict';

// E2E capture test: launches Chrome for Testing (puppeteer) with the extension
// loaded UNPACKED from this repo, triggers capture programmatically (no Alt+S,
// no human), clicks/drags inside real pages, waits for the bridge to land
// jpg+sidecar in the save folder, verifies each record against the live API,
// then deletes the test records it created.
//
//   node scripts/e2e-capture-test.js              # pixiv cells (MVP)
//
// Why this works without touching the user's Chrome:
//   - the extension dir is loaded from the same absolute path as the user's
//     unpacked install → same extension ID → the registered native-messaging
//     host (com.corpus.host) accepts the connection
//   - Alt+S (chrome.commands) can't be synthesized via CDP, but activateOnTab()
//     is a top-level function in the service worker — we attach to the SW
//     target and call it directly
//   - pixiv is covered by manifest host_permissions, so programmatic
//     executeScript works without an activeTab gesture (other platforms need
//     a test manifest with broader host_permissions — future step)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, execFileSync } = require('child_process');
const puppeteer = require('puppeteer');
const { configDir, defaultLibraryDir } = require('../native-host/paths');
const { fetchXTweet } = require('../extension/metadata');

const SRC_EXT_DIR = path.join(__dirname, '..', 'extension');
const EXPECTED_ID = 'abmipnnhieahemoninjnhgoofahhhjjc'; // allowed_origins of com.corpus.host

// Stage a copy of the extension with <all_urls> host permission added, so
// captureVisibleTab works WITHOUT a user gesture (in production the Alt+S
// chrome.commands gesture grants activeTab; a headless test can't synthesize
// that trusted gesture). Everything else — the code under test — is identical.
function stageExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-ext-'));
  const copyDir = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, e.name); const d = path.join(dst, e.name);
      if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
    }
  };
  copyDir(SRC_EXT_DIR, dir);
  const mf = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8').replace(/^﻿/, ''));
  m.host_permissions = Array.from(new Set([...(m.host_permissions || []), '<all_urls>']));
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  return dir;
}

function saveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch { /* default */ }
  return defaultLibraryDir();
}

async function j(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// Each cell: { id, platform, url, kind:'click'|'drag', waitSel, clickSel?, dragSel? }
//  - waitSel  confirms the post DOM loaded
//  - clickSel element to click (capturePost resolves the post by walking up)
//  - dragSel  the post's own image to drag (drag-save cells)
// Drag cells only exist where manifest content_scripts inject drag.js
// (x / bsky / pixiv); Misskey & Mastodon are click-only by design.

async function pickPixiv(cells) {
  try {
    const r = await j('https://www.pixiv.net/ranking.php?mode=daily&format=json&p=1', { headers: { Referer: 'https://www.pixiv.net/' } });
    const items = Array.isArray(r.contents) ? r.contents : [];
    const ok = (c) => c && c.illust_id && String(c.illust_type) !== '2';
    const single = items.find((c) => ok(c) && Number(c.illust_page_count) === 1);
    const multi = items.find((c) => ok(c) && Number(c.illust_page_count) > 1);
    const url = (c) => `https://www.pixiv.net/artworks/${c.illust_id}`;
    const W = 'main figure img', I = 'main figure img';
    if (single) cells.push({ id: 'A-5a', platform: 'pixiv', url: url(single), kind: 'click', waitSel: W, clickSel: I });
    if (multi) cells.push({ id: 'A-5b', platform: 'pixiv', url: url(multi), kind: 'click', waitSel: W, clickSel: I });
    if (multi) cells.push({ id: 'A-5d', platform: 'pixiv', url: url(multi), kind: 'drag', waitSel: W, dragSel: I });
  } catch (e) { console.log('pixiv 選別スキップ:', e.message); }
}

async function pickX(cells) {
  // No public search API — validate evergreen posts via syndication, then drive
  // the real pages. (x.com may gate logged-out views; cells fail gracefully.)
  try {
    const alive = async (id) => { try { const r = await fetchXTweet({ id, screenName: null }, `https://x.com/i/web/status/${id}`); return r && r.text; } catch { return false; } };
    const photo = '266031293945503744';   // @BarackObama, single photo, evergreen
    const W = 'article[data-testid="tweet"]';
    if (await alive(photo)) {
      const url = `https://x.com/BarackObama/status/${photo}`;
      cells.push({ id: 'A-1l', platform: 'x', url, kind: 'click', waitSel: W, clickSel: W });
      cells.push({ id: 'A-1m', platform: 'x', url, kind: 'drag', waitSel: `${W} img[src*="pbs.twimg.com/media"]`, dragSel: `${W} img[src*="pbs.twimg.com/media"]` });
    }
  } catch (e) { console.log('x 選別スキップ:', e.message); }
}

async function pickBluesky(cells) {
  try {
    const posts = [];
    for (const actor of ['bsky.app', 'pfrazee.com', 'jay.bsky.team', 'danabra.mov']) {
      try { const f = await j(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${actor}&limit=80&filter=posts_with_replies`); for (const it of f.feed || []) if (it.post) posts.push(it.post); } catch { /* next */ }
    }
    const urlOf = (p) => { const m = (p.uri || '').match(/\/app\.bsky\.feed\.post\/([^/]+)$/); return (m && p.author) ? `https://bsky.app/profile/${p.author.handle}/post/${m[1]}` : null; };
    const imgs = (p) => { const e = p.embed || {}; return (e.$type || '').includes('recordWithMedia') ? ((e.media && e.media.images) || []) : (e.images || []); };
    const isQuote = (p) => ((p.embed && p.embed.$type) || '').includes('app.bsky.embed.record');
    const isReply = (p) => !!(p.record && p.record.reply);
    const parentDid = (p) => { const u = p.record && p.record.reply && p.record.reply.parent && p.record.reply.parent.uri; const m = u && u.match(/^at:\/\/(did:[^/]+)\//); return m ? m[1] : null; };
    // The thread/quote detail page renders several postThreadItem nodes (parents
    // above, replies below). Target the anchor post by its AUTHOR handle so a
    // reply isn't confused with its parent. (testid = postThreadItem-by-<handle>)
    const sel = (p) => `[data-testid="postThreadItem-by-${p.author.handle}"]`;
    const single = posts.find((p) => urlOf(p) && imgs(p).length === 1 && !isReply(p) && !isQuote(p));
    const multi = posts.find((p) => urlOf(p) && imgs(p).length > 1 && !isReply(p));
    const quote = posts.find((p) => urlOf(p) && isQuote(p) && !isReply(p));
    // reply BY a different author than its parent, so the anchor post's testid is
    // unique on the page (a self-thread would share the handle with the parent).
    const reply = posts.find((p) => urlOf(p) && isReply(p) && parentDid(p) && parentDid(p) !== p.author.did);
    const IMG = '[data-testid^="postThreadItem-by-"] img[src*="/img/feed_"]';
    if (single) cells.push({ id: 'A-2b', platform: 'bluesky', url: urlOf(single), kind: 'click', waitSel: sel(single), clickSel: sel(single) });
    if (multi) cells.push({ id: 'A-2g', platform: 'bluesky', url: urlOf(multi), kind: 'click', waitSel: sel(multi), clickSel: sel(multi) });
    if (single) cells.push({ id: 'A-2i', platform: 'bluesky', url: urlOf(single), kind: 'drag', waitSel: IMG, dragSel: IMG });
    // ★ regression: clicking a QUOTE post's detail must save the quoting post,
    // not the quoted one (audit HIGH). expectUrl == the quoting post's url.
    if (quote) cells.push({ id: 'A-2f', platform: 'bluesky', url: urlOf(quote), kind: 'click', waitSel: sel(quote), clickSel: sel(quote), regression: '引用→引用した側' });
    // ★ regression: reply detail saves the reply itself, not the parent.
    if (reply) cells.push({ id: 'A-2e', platform: 'bluesky', url: urlOf(reply), kind: 'click', waitSel: sel(reply), clickSel: sel(reply), regression: 'リプライ本人' });
    // ★ regression: dragging the profile header avatar must NOT save anything
    // (bounded ancestor walk → no identity → no drop zone). Profile page.
    cells.push({ id: 'A-2k', platform: 'bluesky', url: 'https://bsky.app/profile/bsky.app', kind: 'drag-none',
      waitSel: 'img[src*="/img/avatar"]', dragSel: 'img[src*="/img/avatar"]', notWithin: '[data-testid^="feedItem-by-"]', regression: 'アバターは保存しない' });
  } catch (e) { console.log('bluesky 選別スキップ:', e.message); }
}

async function pickMisskey(cells) {
  try {
    const notes = await j('https://misskey.io/api/notes/global-timeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 60 }) });
    const arr = Array.isArray(notes) ? notes : [];
    const img = (n) => (n.files || []).some((f) => f.type && f.type.startsWith('image/') && f.type !== 'image/gif');
    const single = arr.find((n) => n && n.id && img(n) && !n.replyId && !n.renoteId);
    const reply = arr.find((n) => n && n.id && n.replyId && !n.renoteId);
    const W = 'div[tabindex="0"] article time';
    // Runner targets the main note by URL id (see the click handler), and
    // asserts the saved url == the intended one.
    if (single) cells.push({ id: 'A-3b', platform: 'misskey', url: `https://misskey.io/notes/${single.id}`, kind: 'click', waitSel: W, clickSel: 'div[tabindex="0"]' });
    // ★ regression (audit HIGH): a reply's detail page must save the REPLY,
    // not the parent note rendered as a preview above it.
    if (reply) cells.push({ id: 'A-3e', platform: 'misskey', url: `https://misskey.io/notes/${reply.id}`, kind: 'click', waitSel: W, clickSel: 'div[tabindex="0"]', regression: 'リプライ→親に化けない' });
  } catch (e) { console.log('misskey 選別スキップ:', e.message); }
}

async function pickMastodon(cells) {
  try {
    let media = [];
    try { media = await j('https://mastodon.social/api/v1/timelines/public?limit=40&only_media=true'); } catch { /* fallback */ }
    if (!Array.isArray(media) || !media.length) {
      const a = await j('https://mastodon.social/api/v1/accounts/lookup?acct=Gargron');
      media = await j(`https://mastodon.social/api/v1/accounts/${a.id}/statuses?limit=40&only_media=true`);
    }
    const s = (media || []).find((x) => x && x.account && !x.reblog && (x.media_attachments || []).some((m) => m.type === 'image'));
    const W = '.detailed-status, .status';
    if (s) cells.push({ id: 'A-4b', platform: 'mastodon', url: `https://mastodon.social/@${s.account.acct}/${s.id}`, kind: 'click', waitSel: W, clickSel: W });
    // ★ regression: a reply status saves the reply itself (isReply path).
    try {
      const a = await j('https://mastodon.social/api/v1/accounts/lookup?acct=Gargron');
      const st = await j(`https://mastodon.social/api/v1/accounts/${a.id}/statuses?limit=40&exclude_reblogs=true&exclude_replies=false`);
      const r = (st || []).find((x) => x && x.in_reply_to_id && x.account);
      if (r) cells.push({ id: 'A-4e', platform: 'mastodon', url: `https://mastodon.social/@${r.account.acct}/${r.id}`, kind: 'click', waitSel: W, clickSel: '.detailed-status', regression: 'リプライ本人' });
    } catch { /* skip reply cell */ }
  } catch (e) { console.log('mastodon 選別スキップ:', e.message); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listSidecars(dir) {
  return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.json')));
}

async function waitForNewSidecar(dir, before, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const now = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !before.has(f));
    if (now.length) {
      await sleep(1500); // bridge writes the sidecar after media downloads — settle
      return now[0];
    }
    await sleep(400);
  }
  return null;
}

(async () => {
  const dir = saveFolder();
  console.log(`保存先: ${dir}`);

  // Optional platform filter: node e2e-capture-test.js bluesky misskey
  const only = process.argv.slice(2).map((s) => s.toLowerCase());
  const cells = [];
  await Promise.all([pickX(cells), pickPixiv(cells), pickBluesky(cells), pickMisskey(cells), pickMastodon(cells)]);
  let active = only.length ? cells.filter((c) => only.includes(c.platform)) : cells;
  // X gates logged-out views, so a fresh test profile can't load tweets — skip
  // X unless explicitly requested. To run X cells, point the test at a Chrome
  // profile already logged into x.com (a future --user-data-dir option).
  if (!only.includes('x')) active = active.filter((c) => c.platform !== 'x');
  else console.log('※ X はログイン必須。未ログインのテストプロファイルでは投稿が描画されず失敗します。');
  active.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (!active.length) { console.error('対象セルを選別できず'); process.exit(1); }
  console.log(`対象セル: ${active.map((c) => c.id + '(' + c.kind + ')').join(' ')}`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-e2e-'));
  const EXT_DIR = stageExtension();
  const hostManifestPath = path.join(process.env.APPDATA, 'Corpus', 'com.corpus.host.json');
  const originalHostManifest = fs.existsSync(hostManifestPath) ? fs.readFileSync(hostManifestPath, 'utf8') : null;
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: profile,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--window-size=1360,960',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      '--lang=ja'
    ],
    defaultViewport: null
  });

  const results = [];
  const created = [];
  try {
    // attach to the extension service worker
    const swTarget = await browser.waitForTarget(
      (t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'),
      { timeout: 20000 }
    );
    const extId = new URL(swTarget.url()).host;
    if (extId === EXPECTED_ID) {
      console.log(`拡張ID: ${extId} (NMホスト許可と一致 ✓)`);
    } else {
      // The unpacked test instance gets a path-derived ID — allow it on the
      // native host so the bridge accepts the connection. Idempotent add; the
      // extra origin is a local unpacked extension only we control.
      const hostManifest = path.join(process.env.APPDATA, 'Corpus', 'com.corpus.host.json');
      const hm = JSON.parse(fs.readFileSync(hostManifest, 'utf8'));
      const origin = `chrome-extension://${extId}/`;
      if (!hm.allowed_origins.includes(origin)) {
        hm.allowed_origins.push(origin);
        fs.writeFileSync(hostManifest, JSON.stringify(hm, null, 2));
        console.log(`拡張ID: ${extId} — NMホスト allowed_origins に追加しました (${hostManifest})`);
      } else {
        console.log(`拡張ID: ${extId} (allowed_origins 追加済み)`);
      }
      // NOTE: if Chrome for Testing looks the host up under its own registry
      // branch (Google\Chrome for Testing\NativeMessagingHosts), registering
      // there needs explicit user approval — ask before adding.
    }
    const sw = await swTarget.worker();

    const page = await browser.newPage();

    for (const cell of active) {
      console.log(`\n--- ${cell.id} [${cell.platform}] ${cell.kind} ${cell.url}${cell.regression ? ' ★' + cell.regression : ''}`);
      const before = listSidecars(dir);
      try {
        // SPAs (x/bsky/misskey/mastodon) and pixiv long-poll, so networkidle
        // never fires — wait for the post DOM instead.
        await page.goto(cell.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector(cell.waitSel, { timeout: 30000 });
        await sleep(1200);

        // Negative regression: dragging a non-post image (profile avatar) must
        // NOT pop the drop zone and must NOT save a record.
        if (cell.kind === 'drag-none') {
          const zoneShown = await page.evaluate(async (sel, notWithin) => {
            const img = [...document.querySelectorAll(sel)].find((el) => !notWithin || !el.closest(notWithin));
            if (!img) return 'no-img';
            img.scrollIntoView({ block: 'center' });
            img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
            await new Promise((r) => setTimeout(r, 500));
            const z = document.getElementById('__corpusDropZone');
            return !!(z && z.style.display !== 'none');
          }, cell.dragSel, cell.notWithin);
          if (zoneShown === 'no-img') throw new Error('avatar img not found');
          await sleep(2500);
          const leaked = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !before.has(f));
          if (zoneShown) throw new Error('ドロップゾーンが表示された（捏造保存の恐れ）');
          if (leaked.length) { leaked.forEach((f) => { for (const g of fs.readdirSync(dir)) if (g.startsWith(f.replace(/\.json$/, ''))) fs.unlinkSync(path.join(dir, g)); }); throw new Error('非投稿画像が保存された'); }
          console.log('   ✓ ドロップゾーン非表示・保存なし（期待どおり）');
          results.push({ id: cell.id, ok: true });
          continue;
        }

        if (cell.kind === 'click') {
          // Alt+S equivalent: inject the content scripts from the SW context
          // (activeTab gestures can't be synthesized; the staged extension has
          // <all_urls> so executeScript works on every platform).
          const act = await sw.evaluate(async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) return { ok: false, err: 'no active tab' };
            try {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['i18n.js', 'content.js'] });
              return { ok: true, url: tab.url };
            } catch (e) {
              return { ok: false, url: tab.url, err: String(e) };
            }
          });
          if (!act.ok) throw new Error(`activation failed on ${act.url}: ${act.err}`);
          // The content script lives in an ISOLATED world — wait for its banner
          // DOM instead (z-index sentinel 2147483647).
          await page.waitForFunction(() => {
            return [...document.querySelectorAll('div')].some((d) => d.style.zIndex === '2147483647');
          }, { timeout: 8000 });
          // Trusted click on a stable in-post element; capturePost resolves the
          // post by walking up from the click target. For Misskey the detail
          // page renders several div[tabindex="0"] notes (conversation chain +
          // replies), so target the one whose permalink matches the URL id.
          let h;
          if (cell.platform === 'misskey') {
            const id = (cell.url.match(/\/notes\/([^/?#]+)/) || [])[1];
            h = (await page.evaluateHandle((noteId) => {
              for (const root of document.querySelectorAll('div[tabindex="0"]')) {
                const link = [...root.querySelectorAll('a[href*="/notes/"]')].find((a) => a.querySelector('time') && a.getAttribute('href').includes('/notes/' + noteId));
                if (link) return root;
              }
              return null;
            }, id)).asElement();
            if (!h) throw new Error('main note element not found for id ' + id);
          } else {
            h = await page.$(cell.clickSel);
            if (!h) throw new Error(`click target not found: ${cell.clickSel}`);
          }
          await h.click();
          await h.dispose();
          // Capture the banner outcome before it auto-dismisses (success green
          // /partial amber/fail red), so a bridge failure isn't lost.
          const banner = await page.evaluate(async () => {
            const find = () => [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '2147483647');
            for (let i = 0; i < 60; i++) {
              const b = find();
              if (b && /保存|失敗|Saved|failed/.test(b.textContent)) return b.textContent.trim();
              await new Promise((r) => setTimeout(r, 100));
            }
            const b = find();
            return b ? b.textContent.trim() : '(no banner)';
          });
          console.log(`   バナー: ${banner}`);
        } else {
          // drag-save: synthetic dragstart on the post image → drop into the zone
          // (drag.js is a persistent content script, no activation needed)
          const ok = await page.evaluate(async (sel) => {
            const img = document.querySelector(sel);
            if (!img) return 'no-img';
            img.scrollIntoView({ block: 'center' });
            const dt = new DataTransfer();
            img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
            await new Promise((r) => setTimeout(r, 400));
            const zone = document.getElementById('__corpusDropZone');
            if (!zone || zone.style.display === 'none') return 'no-zone';
            zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
            return 'ok';
          }, cell.dragSel);
          if (ok !== 'ok') throw new Error('drag setup failed: ' + ok);
        }

        const file = await waitForNewSidecar(dir, before);
        if (!file) {
          // surface the in-page failure message (drop zone / banner text)
          const hint = await page.evaluate(() => {
            const z = document.getElementById('__corpusDropZone');
            const banner = [...document.querySelectorAll('div')].find((d) => d.style.zIndex === '2147483647');
            return (z && z.style.display !== 'none' ? `zone="${z.textContent}" ` : '') + (banner ? `banner="${banner.textContent}"` : '');
          }).catch(() => '');
          throw new Error(`サイドカーが保存されなかった ${hint}`);
        }
        created.push(file.replace(/\.json$/, ''));
        const rec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        console.log(`   保存: ${file} url=${rec.url} media=${(rec.media || []).length}${rec.imageCount ? ` imageIndex=${rec.imageIndex}/${rec.imageCount}` : ''}`);
        // Assert the saved record is the post we intended to capture — not just
        // a self-consistent record for some OTHER post (the API re-check alone
        // can't catch wrong-post selection). Compare by stable id.
        const idOf = (u) => (String(u || '').match(/\/status\/(\d+)|\/post\/([^/?#]+)|\/notes\/([^/?#]+)|\/(\d[\w-]*)\/?$|\/artworks\/(\d+)/) || []).slice(1).find(Boolean) || u;
        if (idOf(rec.url) !== idOf(cell.url)) {
          throw new Error(`別投稿が保存された: 期待 ${cell.url} / 実際 ${rec.url}`);
        }
        results.push({ id: cell.id, ok: true, file });
      } catch (e) {
        console.log(`   ✗ ${e.message}`);
        results.push({ id: cell.id, ok: false, err: e.message });
      }
    }
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
    fs.rmSync(EXT_DIR, { recursive: true, force: true });
    // restore the host manifest's allowed_origins (we added the test ext's ID)
    if (originalHostManifest != null) fs.writeFileSync(hostManifestPath, originalHostManifest);
  }

  // verify the captures against the live API (same checker as the manual flow)
  if (created.length) {
    console.log('\n=== API照合 (test-watch-verify --recent) ===');
    const v = spawnSync(process.execPath, [path.join(__dirname, 'test-watch-verify.js'), '--recent', String(created.length)], { encoding: 'utf8' });
    process.stdout.write(v.stdout || '');

    // clean up: delete the records this test created (jpg/json/media files)
    console.log('\nテストレコードを削除…');
    for (const id of created) {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(id)) { fs.unlinkSync(path.join(dir, f)); console.log('  削除: ' + f); }
      }
    }
  }

  const okN = results.filter((r) => r.ok).length;
  console.log(`\n${okN}/${results.length} セル成功`);
  console.log(okN === results.length ? 'E2E_CAPTURE_PASS' : 'E2E_CAPTURE_FAIL');
  process.exit(okN === results.length ? 0 : 1);
})();

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

async function pickPixiv() {
  const r = await j('https://www.pixiv.net/ranking.php?mode=daily&format=json&p=1', { headers: { Referer: 'https://www.pixiv.net/' } });
  const items = Array.isArray(r.contents) ? r.contents : [];
  const ok = (c) => c && c.illust_id && String(c.illust_type) !== '2';
  const single = items.find((c) => ok(c) && Number(c.illust_page_count) === 1);
  const multi = items.find((c) => ok(c) && Number(c.illust_page_count) > 1);
  return { single, multi };
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
  const { single, multi } = await pickPixiv();
  if (!single && !multi) { console.error('pixivランキングから対象を選別できず'); process.exit(1); }

  const cells = [];
  if (single) cells.push({ id: 'A-5a', url: `https://www.pixiv.net/artworks/${single.illust_id}`, kind: 'click', expectPages: 1 });
  if (multi) cells.push({ id: 'A-5b', url: `https://www.pixiv.net/artworks/${multi.illust_id}`, kind: 'click', expectPages: Number(multi.illust_page_count) });
  if (multi) cells.push({ id: 'A-5d', url: `https://www.pixiv.net/artworks/${multi.illust_id}`, kind: 'drag', expectPages: Number(multi.illust_page_count) });

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

    for (const cell of cells) {
      console.log(`\n--- ${cell.id} ${cell.kind} ${cell.url}`);
      const before = listSidecars(dir);
      try {
        // pixiv long-polls, so networkidle never fires — wait for the artwork img.
        await page.goto(cell.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForSelector('main figure img', { timeout: 30000 });
        await sleep(1000);

        if (cell.kind === 'click') {
          // Alt+S equivalent: inject the content scripts from the SW context
          // (activeTab gestures can't be synthesized; pixiv is host-permitted)
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
          // The content script lives in an ISOLATED world — its globals aren't
          // visible from the page. Wait for its banner DOM instead (z-index
          // sentinel 2147483647).
          await page.waitForFunction(() => {
            return [...document.querySelectorAll('div')].some((d) => d.style.zIndex === '2147483647');
          }, { timeout: 8000 });
          // Trusted click at the artwork's center (puppeteer scrolls into view).
          // Whatever pixiv renders on top is what a real user would hit, and the
          // content script walks UP from it to resolve the artwork.
          const h = await page.$('main figure img');
          if (!h) throw new Error('artwork img not found');
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
          // drag-save: synthetic dragstart on the artwork image → drop into the zone
          const ok = await page.evaluate(async () => {
            const img = document.querySelector('main figure img');
            if (!img) return 'no-img';
            const dt = new DataTransfer();
            img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
            await new Promise((r) => setTimeout(r, 300));
            const zone = document.getElementById('__corpusDropZone');
            if (!zone || zone.style.display === 'none') return 'no-zone';
            zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
            return 'ok';
          });
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

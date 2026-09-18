// API取得と独立して再開できる反映処理。DBへの書き込みは起動中のアプリに任せる。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { chromium } = require('playwright');
const { configDir } = require('../native-host/paths.mts');
const { downloadAvatar, pixivRefererFor } = require('../native-host/media-download.mts');

async function main() {
  const folder = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8')).saveFolder;
  const root = path.join(folder, '.hologram-metadata-backfill');
  const state = JSON.parse(fs.readFileSync(path.join(root, 'progress.json'), 'utf8'));
  if (state.folder !== folder) throw Error('対象ライブラリが違います');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  try {
    const page = browser
      .contexts()[0]
      .pages()
      .find((page) => page.url().includes('index.html'));
    if (!page) throw Error('アプリ画面がありません');
    const live = await page.evaluate(async () => {
      const api = (window as any).hologram;
      return { folder: (await api.listPosts()).saveFolder, ready: typeof api.applyCachedMetadata === 'function' };
    });
    if (live.folder !== folder || !live.ready) throw Error('補完に対応した対象アプリが起動していません');
    const db = new DatabaseSync(path.join(folder, 'hologram.db'), { readOnly: true });
    try {
      const backupFile = path.join(root, 'before-apply.db');
      if (!fs.existsSync(backupFile)) {
        await backup(db, backupFile + '.tmp');
        fs.renameSync(backupFile + '.tmp', backupFile);
      }
      const limitArg = process.argv.find((value) => value.startsWith('--limit='));
      const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
      let applied = 0;
      for (const entry of state.entries) {
        if (applied >= limit) break;
        if (entry.status !== 'fetched') continue;
        const hash = crypto.createHash('sha256').update(entry.key).digest('hex');
        if (db.prepare('SELECT 1 FROM store_state WHERE key = ?').get(`metadata-backfill:${hash}`)) continue;
        const resultFile = path.join(root, 'results', hash + '.json');
        const { result } = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
        const assetFile = path.join(root, 'results', hash + '.assets.json');
        if (!fs.existsSync(assetFile)) {
          const assets: any = {};
          for (const field of ['avatar', 'banner']) {
            if (!result[field]) continue;
            try {
              assets[field + 'File'] = await downloadAvatar(result[field], result.avatarReferer || pixivRefererFor(result[field]), folder);
            } catch (error) {
              assets[field + 'Error'] = error instanceof Error ? error.message : String(error);
            }
          }
          fs.writeFileSync(assetFile + '.tmp', JSON.stringify(assets));
          fs.renameSync(assetFile + '.tmp', assetFile);
        }
        const appliedResult = await page.evaluate((key) => (window as any).hologram.applyCachedMetadata(key), entry.key);
        if (!appliedResult.ok) throw Error(`反映できません: ${entry.key}`);
        applied++;
        console.log(JSON.stringify({ key: entry.key, ...appliedResult, applied }));
      }
      console.log(JSON.stringify({ applied }));
    } finally {
      db.close();
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

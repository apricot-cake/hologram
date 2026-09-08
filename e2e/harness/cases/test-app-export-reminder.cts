'use strict';

// 手動エクスポートの通知を実アプリで確認する。
//
// - 指定件数に達するとサイドレールにだけ通知が現れる
// - 通知を開くと、現在件数とバックアップ作成・設定への入口が見える
// - 設定への入口はデータ画面を直接開き、通知と100件の既定値を表示する

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-export-reminder-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'library');
for (const dir of [configDir, saveFolder]) fs.mkdirSync(dir, { recursive: true });

fs.writeFileSync(
  path.join(configDir, 'config.json'),
  JSON.stringify({
    saveFolder,
    extensionId: 'testextensionidabcdefghijklmnop',
    libraries: [
      {
        path: saveFolder,
        libraryId: null,
        lastOpenedAt: '2026-08-26T00:00:00.000Z',
        exportReminder: { enabled: true, threshold: 100, changesSinceExport: 100, lastExportAt: null },
      },
    ],
  }),
);
seedLibrary(configDir, []);

const evalJs = evalSource(async ({ waitFor }) => {
  const buttonByLabel = (label: string) => Array.from(document.querySelectorAll('button')).find((el) => el.getAttribute('aria-label') === label) as HTMLButtonElement | undefined;
  const buttonByText = (text: string) => Array.from(document.querySelectorAll('button')).find((el) => el.textContent?.trim() === text) as HTMLButtonElement | undefined;

  const railReady = await waitFor('エクスポート通知がサイドレールに現れる', () => !!buttonByLabel('バックアップファイルを作成しませんか'));
  buttonByLabel('バックアップファイルを作成しませんか')?.click();

  const popoverReady = await waitFor('エクスポート通知のポップオーバーが開く', () => document.body.textContent?.includes('前回のエクスポート後に、投稿を100件保存しました。'));
  const createShown = !!buttonByText('バックアップファイルを作成');
  const settingsButton = buttonByText('通知設定を開く');
  const settingsEntryShown = !!settingsButton;
  settingsButton?.click();

  const settingsReady = await waitFor('設定のデータ画面が開く', () => !!document.querySelector('#export-reminder') && !!document.querySelector('#export-reminder-threshold'));
  const reminderToggle = document.querySelector('#export-reminder') as HTMLInputElement | null;
  const enabled = reminderToggle?.checked === true;
  const thresholdText = document.querySelector('#export-reminder-threshold')?.textContent?.trim() || '';
  const hintShown = document.body.textContent?.includes('前回のエクスポート後に保存した投稿が指定した件数に達したら、サイドレールで知らせます。') || false;

  return { railReady, popoverReady, createShown, settingsEntryShown, settingsReady, enabled, thresholdText, hintShown };
});

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});
const child = spawn(resolveElectron(), ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (data) => {
  out += data.toString();
  process.stdout.write(data);
});
child.on('close', () => {
  const match = out.match(/EVAL_RESULT (.+)/);
  let result: Record<string, any> | null = null;
  try {
    result = match ? JSON.parse(match[1]) : null;
  } catch {
    result = null;
  }
  const ok = result?.railReady === true && result?.popoverReady === true && result?.createShown === true && result?.settingsEntryShown === true && result?.settingsReady === true && result?.enabled === true && result?.thresholdText.includes('100') && result?.hintShown === true;
  console.log(JSON.stringify(result));
  console.log(ok ? 'EXPORT_REMINDER_TEST_PASS' : 'EXPORT_REMINDER_TEST_FAIL');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
});

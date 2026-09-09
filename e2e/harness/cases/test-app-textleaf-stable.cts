'use strict';

// 検索欄の入力とタブごとの復元を実アプリで検証する。

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-stb-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const records: any[] = [];
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-stb' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (300 + i),
    platform: 'x',
    text: texts[i],
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const input = () => document.querySelector<HTMLInputElement>('input[placeholder="テキスト・ユーザー名で検索"]');
  const active = () => document.querySelector('[data-slot="tab"][data-active]')?.getAttribute('data-tab-id');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const setSearch = (value: string) => {
    const field = input();
    if (!field || !setter) throw new Error('検索欄を操作できません');
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await waitFor('初期の3件が表示される', () => cards() === 3);
  setSearch('いぬ');
  const filtered = await waitFor('いぬの投稿に絞られる', () => cards() === 1);
  const first = active();
  document.querySelector<HTMLElement>('[data-slot="tab-new"]')?.click();
  const fresh = await waitFor('新しいタブの検索欄が空になる', () => active() !== first && input()?.value === '' && cards() === 3);
  document.querySelector<HTMLElement>('[data-slot="tab"][data-tab-id="' + first + '"]')?.click();
  const restored = await waitFor('元のタブの検索語と結果が戻る', () => active() === first && input()?.value === 'いぬ' && cards() === 1);
  setSearch('いぬのx');
  const edited = await waitFor('復元した検索語を編集できる', () => cards() === 0);
  setSearch('');
  const cleared = await waitFor('検索を消すと3件へ戻る', () => cards() === 3);
  return { filtered, fresh, restored, edited, cleared };
});

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});
child.on('close', () => {
  let r: Record<string, any> = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* 無視 */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.filtered === true && r.fresh === true && r.restored === true && r.edited === true && r.cleared === true;
  console.log(JSON.stringify(r));
  console.log(ok ? 'TEXTLEAF_STABLE_TEST_PASS' : 'TEXTLEAF_STABLE_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});

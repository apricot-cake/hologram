'use strict';

// タグ用語集の IPC（get/set-tag-groups）を、実際の Electron メインプロセスを
// 通して往復させる。2回起動の検証: 1回目の起動で種別を設定し、2回目の起動
// （新しいプロセス、同じ configDir/DB）で読み返す — これにより、書き込みが
// 最初のプロセスのメモリに住んでいるだけでなく、実際に SQLite へ永続化した
// ことを証明する（#298/St5 の正本転換の書き込み経路。lib-db-write.ts を
// 参照）。
//
//   node e2e/harness/cases/test-app-taggroups.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-taggroups-ipc-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

function launch(evalJs): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    const env = Object.assign({}, process.env, {
      APPDATA: tmp,
      HOLOGRAM_CONFIG_DIR: configDir,
      HOLOGRAM_SMOKE: '1',
      HOLOGRAM_SMOKE_EVAL: evalJs,
    });
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
          /* ignore */
        }
      }
      resolve(r);
    });
  });
}

// 種別＋改名した種別ラベルを設定し、まず「同じ」プロセス内で両方を読み返す
// （改名 UI は同じ setTagGroups(memberships, labels) の経路で永続化する）。
//
// #810: groupId は tags の行 ID へ書き込まれるので、分類できるようになる前に
// タグそのものが存在していなければならない — これは実際の UI でも同じ
// （チップからタグを分類する。チップが存在するのは何かがそのタグを持って
// いるから）。set-poster-tags はここから2つのタグを作る最も安上がりな方法:
// 名前をキーにし、投稿を必要とせず、その読み取りは id を並行配列で返す
// ので、これは #810 が加えた poster-tag の実体読み取りもカバーする。
const setEvalJs = evalSource(async () => {
  const hologram = (window as any).hologram;
  await hologram.setPosterTags({ tags: { 'x:1': ['ブルアカ', 'アロナ'] } });
  const ids = (await hologram.getPosterTags()).tags['x:1'].tagIds;
  await hologram.setTagGroups(
    [
      { id: ids[0], groupId: 'work' },
      { id: ids[1], groupId: 'character' },
    ],
    { work: 'シリーズ', character: '登場人物' },
  );
  const r = await hologram.getTagGroups();
  const kindOf = Object.fromEntries(r.memberships.map((t) => [t.name, t.groupId]));
  return { memberships: kindOf.ブルアカ + ',' + kindOf.アロナ, labels: r.labels.work + ',' + r.labels.character };
});

// 2回目の起動は、同じ configDir/DB に対して新しい Electron プロセスを開き、
// 自分では一切書き込まずに種別を読み返す — 1回目の起動の古いメモリ上の値が
// ここに漏れることはあり得ないので、一致すれば本物の永続化を証明する。
const getEvalJs = evalSource(async () => {
  const r = await (window as any).hologram.getTagGroups();
  const kindOf = Object.fromEntries(r.memberships.map((t) => [t.name, t.groupId]));
  return { memberships: kindOf.ブルアカ + ',' + kindOf.アロナ, labels: (r.labels && r.labels.work + ',' + r.labels.character) || null };
});

(async () => {
  const r1 = await launch(setEvalJs);
  const ipcRoundTrip = !!(r1 && r1.memberships === 'work,character' && r1.labels === 'シリーズ,登場人物');

  const r2 = await launch(getEvalJs);
  const persisted = !!(r2 && r2.memberships === 'work,character' && r2.labels === 'シリーズ,登場人物');

  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = ipcRoundTrip && persisted;
  console.log(`ipcRoundTrip=${ipcRoundTrip} persisted=${persisted}`);
  console.log(ok ? 'TAGGROUPS_TEST_PASS' : 'TAGGROUPS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
})();

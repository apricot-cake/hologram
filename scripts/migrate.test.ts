// app/src/main/lib-migrate.ts のユニットテスト＝保存フォルダの引っ越しエンジン
// （BACKLOG L1: 移動中に src へ着地した capture が見えないまま取り残されていた）。
// 素の Node と一時ディレクトリだけ・Electron 不要。追いかけコピーの周回・削除前の検証・
// 空になった殻の撤去・取り残し掃除の cold/hot 判別・relocateLibrary 全体の統率
// （config 反転の順序・取り残しの報告・遅延掃除）を覆う。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { copyLibraryInto, relocateLibrary, sweepStragglers, verifyAndCleanup } from '../app/src/main/lib-migrate';

function mkroot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-migrate-'));
  return { root, src: path.join(root, 'src'), dest: path.join(root, 'dest') };
}
function seed(dir: string, files: Record<string, string>) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}
function setOld(p: string, ms: number) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(p, t, t);
}
const read = (...seg: string[]) => fs.readFileSync(path.join(...seg), 'utf8');

describe('copyLibraryInto', () => {
  test('基本のコピー＝tmp を除外し、ディレクトリは再帰、src は無傷', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA', 'a.json': '{"id":"a"}', '.trash/t.jpg': 'TTT', 'b.json.tmp-123': 'TMP' });

    const cp = await copyLibraryInto(src, dest, null);

    expect(cp.ok).toBe(true);
    expect(cp.entries).toHaveLength(3);
    expect(read(dest, 'a.jpg')).toBe('AAA');
    expect(read(dest, '.trash', 't.jpg')).toBe('TTT');
    expect(fs.existsSync(path.join(dest, 'b.json.tmp-123'))).toBe(false);
    expect(fs.existsSync(path.join(src, 'a.jpg'))).toBe(true);
  });

  // #299 (St6): .hologram-inbox is just one more nested top-level entry —
  // the same "one opaque dir, copied+verified+deleted as a unit" treatment
  // .trash already gets above. No lib-migrate.ts change was needed; this
  // pins that a nested inbox/new/segments tree survives a save-folder move.
  test('.hologram-inbox ツリーも1エントリとして丸ごとコピーされる', async () => {
    const { src, dest } = mkroot();
    seed(src, {
      'a.jpg': 'AAA',
      '.hologram-inbox/new/111-aaaa.json': '{"eventId":"111-aaaa"}',
      '.hologram-inbox/segments/deadbeef.jsonl': '{"eventId":"000-1111"}\n',
    });

    const cp = await copyLibraryInto(src, dest, null);

    expect(cp.ok).toBe(true);
    expect(cp.entries).toEqual(expect.arrayContaining(['a.jpg', '.hologram-inbox']));
    expect(read(dest, '.hologram-inbox', 'new', '111-aaaa.json')).toBe('{"eventId":"111-aaaa"}');
    expect(read(dest, '.hologram-inbox', 'segments', 'deadbeef.jsonl')).toBe('{"eventId":"000-1111"}\n');

    const cl = await verifyAndCleanup(src, dest, cp.entries);
    expect(cl).toMatchObject({ removed: 2, leftover: [], emptied: true });
    expect(fs.existsSync(src)).toBe(false);
  });

  test('同名衝突はコピー前に中止し、既存の宛先ファイルを潰さない', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA' });
    seed(dest, { 'a.jpg': 'THEIRS' });

    const cp = await copyLibraryInto(src, dest, null);

    expect(cp).toMatchObject({ ok: false, error: 'collision', name: 'a.jpg' });
    expect(read(dest, 'a.jpg')).toBe('THEIRS');
  });

  // L1 の核心: コピー中に着地したファイルを追いかけ周回が拾う
  test('コピー中に着地したファイルを拾う', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA', 'b.jpg': 'BBB' });
    let dropped = false;

    const cp = await copyLibraryInto(src, dest, (done: number) => {
      // 初回コピー中にネイティブホストの capture が着地した状況を模す
      if (done === 1 && !dropped) {
        dropped = true;
        fs.writeFileSync(path.join(src, 'late.jpg'), 'LATE');
        fs.writeFileSync(path.join(src, 'late.json'), '{"id":"late"}');
      }
    });

    expect(cp.ok).toBe(true);
    expect(cp.entries).toEqual(expect.arrayContaining(['late.jpg', 'late.json']));
    expect(read(dest, 'late.jpg')).toBe('LATE');
  });

  test('失敗したら宛先を巻き戻し、src は完全なまま', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA' });

    const cp = await copyLibraryInto(src, dest, () => {
      // 途中で宛先と衝突する名前を落とす → 追いかけコピーが EEXIST で落ちる
      fs.writeFileSync(path.join(src, 'clash.jpg'), 'MINE');
      fs.mkdirSync(path.join(dest, 'clash.jpg'), { recursive: true });
    });

    expect(cp).toMatchObject({ ok: false, error: 'copy-failed' });
    expect(fs.existsSync(path.join(dest, 'a.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(src, 'a.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(src, 'clash.jpg'))).toBe(true);
  });
});

describe('verifyAndCleanup', () => {
  test('検証できたものを src から消し、空になった殻も撤去する', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA', 'a.json': '{"id":"a"}', '.trash/t.jpg': 'TTT' });
    const cp = await copyLibraryInto(src, dest, null);

    const cl = await verifyAndCleanup(src, dest, cp.entries);

    expect(cl).toMatchObject({ removed: 3, leftover: [], emptied: true });
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(path.join(dest, 'a.jpg'))).toBe(true);
  });

  test('壊れた宛先コピーは再コピーして直す（黙って失わない）', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAAAAA', 'tags.json': '{"v":1}' });
    const cp = await copyLibraryInto(src, dest, null);
    // 途中で切れたコピーと、コピー後の src 側編集（整理 JSON の書き直し）を模す
    fs.writeFileSync(path.join(dest, 'a.jpg'), 'X');
    fs.writeFileSync(path.join(src, 'tags.json'), '{"v":2,"edited":true}');

    const cl = await verifyAndCleanup(src, dest, cp.entries);

    expect(cl).toMatchObject({ removed: 2, emptied: true });
    expect(read(dest, 'a.jpg')).toBe('AAAAAA');
    expect(read(dest, 'tags.json')).toBe('{"v":2,"edited":true}'); // コピー後の編集が勝つ（最新が正）
  });

  test('.index.json は検証を免除、未知の着地は leftover として残す', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA', '.index.json': '{"posts":[]}' });
    const cp = await copyLibraryInto(src, dest, null);
    // 宛先の古い派生インデックスが掃除を止めてはいけない（作り直せる設計）
    fs.writeFileSync(path.join(dest, '.index.json'), '{"posts":[],"stale":1}');
    // 最後の追いかけ周回の後に着地した capture（すき間の窓）
    fs.writeFileSync(path.join(src, 'straggler.jpg'), 'SSS');

    const cl = await verifyAndCleanup(src, dest, cp.entries);

    expect(fs.existsSync(path.join(src, '.index.json'))).toBe(false);
    expect(cl.leftover).toEqual(['straggler.jpg']);
    expect(cl.emptied).toBe(false);
    expect(fs.existsSync(src)).toBe(true);
  });
});

describe('sweepStragglers', () => {
  test('冷えたファイルは移して検証、冷えた tmp は捨て、殻も撤去', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'cold.jpg': 'COLD', 'cold.json': '{"id":"c"}', 'stale.json.tmp-9': 'GARBAGE' });
    seed(dest, {});
    for (const f of ['cold.jpg', 'cold.json', 'stale.json.tmp-9']) setOld(path.join(src, f), 60000);

    const sw = await sweepStragglers(src, dest, { minAgeMs: 15000 });

    expect(sw).toMatchObject({ moved: 2, left: 0, emptied: true });
    expect(read(dest, 'cold.jpg')).toBe('COLD');
    expect(fs.existsSync(src)).toBe(false);
  });

  test('熱い（書きかけかもしれない）ファイルは触らない', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'hot.jpg': 'STILL-WRITING' });
    seed(dest, {});

    const sw = await sweepStragglers(src, dest, { minAgeMs: 15000 });

    expect(sw).toMatchObject({ moved: 0, left: 1 });
    expect(fs.existsSync(path.join(src, 'hot.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dest, 'hot.jpg'))).toBe(false);
  });

  test('宛先に同名がある時＝中身が同じなら src を回収、違えば触らない', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'dup.jpg': 'SAME', 'diff.jpg': 'MINE' });
    seed(dest, { 'dup.jpg': 'SAME', 'diff.jpg': 'THEIRS-LONGER' });
    for (const f of ['dup.jpg', 'diff.jpg']) setOld(path.join(src, f), 60000);
    // 同一のペアには同じ mtime を与える（実際に前段でコピーされていればそうなる）
    const t = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dest, 'dup.jpg'), t, t);

    const sw = await sweepStragglers(src, dest, { minAgeMs: 15000 });

    expect(sw).toMatchObject({ moved: 1, left: 1 });
    expect(fs.existsSync(path.join(src, 'dup.jpg'))).toBe(false);
    expect(read(dest, 'diff.jpg')).toBe('THEIRS-LONGER');
    expect(fs.existsSync(path.join(src, 'diff.jpg'))).toBe(true);
  });
});

describe('relocateLibrary（全体の統率）', () => {
  test('成功時: config 反転が src 削除より先で、フェーズが順に出る', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA', 'a.json': '{"id":"a"}' });
    let cfg: any = { saveFolder: src, extensionId: 'x' };
    const phases: string[] = [];
    let flippedBeforeCleanup = false;
    let afterFlipCalled = false;

    const res = await relocateLibrary(src, dest, {
      readConfig: () => ({ ...cfg }),
      writeConfig: (c: any) => {
        cfg = c;
      },
      emit: (p: any) => {
        phases.push(p.phase);
        if (p.phase === 'cleanup') flippedBeforeCleanup = cfg.saveFolder === dest;
      },
      afterFlip: () => {
        afterFlipCalled = true;
      },
      stillCurrent: () => cfg.saveFolder === dest,
      sweepDelayMs: 50,
    });

    expect(res).toMatchObject({ ok: true, moved: 2, leftover: 0 });
    expect(cfg).toMatchObject({ saveFolder: dest, extensionId: 'x' }); // 他のキーは保たれる
    expect(flippedBeforeCleanup).toBe(true); // クラッシュしても安全な順序
    expect(afterFlipCalled).toBe(true); // 監視・差分のフック
    expect(phases[0]).toBe('copy');
    expect(phases).toEqual(expect.arrayContaining(['switch', 'cleanup']));
    expect(phases.at(-1)).toBe('done');
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(path.join(dest, 'a.jpg'))).toBe(true);
  });

  test('衝突時: 何も反転せず、何も削除しない', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA' });
    seed(dest, { 'a.jpg': 'THEIRS' });
    let cfg: any = { saveFolder: src };
    const phases: string[] = [];

    const res = await relocateLibrary(src, dest, {
      readConfig: () => ({ ...cfg }),
      writeConfig: (c: any) => {
        cfg = c;
      },
      emit: (p: any) => phases.push(p.phase),
      afterFlip: () => {},
      stillCurrent: () => true,
      sweepDelayMs: 50,
    });

    expect(res).toMatchObject({ ok: false, error: 'collision' });
    expect(cfg.saveFolder).toBe(src);
    expect(fs.existsSync(path.join(src, 'a.jpg'))).toBe(true);
    expect(phases.at(-1)).toBe('error');
  });

  // すき間の窓で着地した取り残しは、まず報告され、冷えた後に予約された掃除が回収する
  test('取り残しは報告され、遅延掃除が回収する', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA' });
    let cfg: any = { saveFolder: src };
    const events: any[] = [];
    let plantedLate = false;

    const res = await relocateLibrary(src, dest, {
      readConfig: () => ({ ...cfg }),
      writeConfig: (c: any) => {
        cfg = c;
        if (!plantedLate) {
          plantedLate = true;
          // 最後の追いかけ readdir の後に着地させる。掃除は既定の 15s minAge を使うので
          // ファイルの時刻を戻して「冷えた」状態にしておく。
          fs.writeFileSync(path.join(src, 'late.jpg'), 'LATE');
          setOld(path.join(src, 'late.jpg'), 60000);
        }
      },
      emit: (p: any) => events.push(p),
      afterFlip: () => {},
      stillCurrent: () => cfg.saveFolder === dest,
      sweepDelayMs: 50,
    });

    expect(res).toMatchObject({ ok: true, leftover: 1 });
    expect(events.find((p) => p.phase === 'done').leftover).toBe(1);

    await new Promise((r) => setTimeout(r, 400));

    expect(events.find((p) => p.phase === 'straggler').moved).toBe(1);
    expect(read(dest, 'late.jpg')).toBe('LATE');
    expect(fs.existsSync(src)).toBe(false);
  });
});

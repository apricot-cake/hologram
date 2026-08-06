// Unit tests for app/src/main/lib-migrate.ts = the save-folder relocation engine
// (BACKLOG L1: captures that landed in src during a move were going unseen and left
// stranded). Plain Node and a temp directory only — no Electron needed. Covers the
// chase-copy loop, pre-delete verification, cleanup of emptied shells, cold/hot
// triage for straggler sweeping, and relocateLibrary's overall orchestration
// (config-flip ordering, straggler reporting, delayed sweep).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
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

  // L1's core case: the chase loop picks up files that land during the copy
  test('コピー中に着地したファイルを拾う', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA', 'b.jpg': 'BBB' });
    let dropped = false;

    const cp = await copyLibraryInto(src, dest, (done: number) => {
      // Simulate a native-host capture landing during the initial copy
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
      // Drop a name partway through that collides with the destination → the chase copy fails with EEXIST
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
    // Simulate a copy that got cut off partway through, plus a src-side edit made after the copy (rewriting the organizing JSON)
    fs.writeFileSync(path.join(dest, 'a.jpg'), 'X');
    fs.writeFileSync(path.join(src, 'tags.json'), '{"v":2,"edited":true}');

    const cl = await verifyAndCleanup(src, dest, cp.entries);

    expect(cl).toMatchObject({ removed: 2, emptied: true });
    expect(read(dest, 'a.jpg')).toBe('AAAAAA');
    expect(read(dest, 'tags.json')).toBe('{"v":2,"edited":true}'); // the post-copy edit wins (latest is authoritative)
  });

  test('未知の着地は leftover として残す', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA' });
    const cp = await copyLibraryInto(src, dest, null);
    // A capture that lands after the last chase loop (the gap window)
    fs.writeFileSync(path.join(src, 'straggler.jpg'), 'SSS');

    const cl = await verifyAndCleanup(src, dest, cp.entries);

    expect(fs.existsSync(path.join(src, 'a.jpg'))).toBe(false);
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
    // Give the identical pair the same mtime (which is what would happen if it had actually been copied in an earlier stage)
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
    expect(cfg).toMatchObject({ saveFolder: dest, extensionId: 'x' }); // other keys are preserved
    expect(flippedBeforeCleanup).toBe(true); // order that stays safe even if it crashes
    expect(afterFlipCalled).toBe(true); // hook for watching/diffing
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

  // A straggler that lands in the gap window is reported first, then picked up by the scheduled sweep once it's cold
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
          // Land it after the last chase readdir. The sweep uses the default 15s minAge,
          // so wind the file's timestamp back to make it look "cold".
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

    // The scheduled sweep (sweepDelayMs: 50) announces itself: it emits 'straggler' only after
    // sweepStragglers has resolved, by which point late.jpg has moved and the emptied src shell
    // is gone — so this one event gates all three assertions below.
    await vi.waitFor(() => expect(events.some((p) => p.phase === 'straggler')).toBe(true));

    expect(events.find((p) => p.phase === 'straggler').moved).toBe(1);
    expect(read(dest, 'late.jpg')).toBe('LATE');
    expect(fs.existsSync(src)).toBe(false);
  });

  // #176: hologram.db now lives INSIDE the library folder, so it travels
  // through copyLibraryInto like any other file — these pin the close/reopen
  // ordering around that copy (lib-migrate.ts's step 0 / step 2.5).
  describe('#176: closeDb/openDb ordering around the copy', () => {
    test('closeDb runs before the copy, openDb after the flip but before cleanup deletes src', async () => {
      const { src, dest } = mkroot();
      seed(src, { 'hologram.db': 'DBBYTES', 'a.jpg': 'AAA' });
      let cfg: any = { saveFolder: src };
      const calls: string[] = [];

      const res = await relocateLibrary(src, dest, {
        readConfig: () => ({ ...cfg }),
        writeConfig: (c: any) => {
          cfg = c;
        },
        emit: () => {},
        afterFlip: () => {
          calls.push('afterFlip');
        },
        stillCurrent: () => true,
        sweepDelayMs: 50,
        closeDb: () => {
          calls.push('closeDb');
          expect(fs.existsSync(path.join(dest, 'hologram.db'))).toBe(false); // not copied yet
        },
        openDb: () => {
          calls.push('openDb');
          expect(cfg.saveFolder).toBe(dest); // pointer already flipped
          expect(fs.existsSync(src)).toBe(true); // src not yet cleaned up — still the fallback if this throws
        },
      });

      expect(res).toMatchObject({ ok: true });
      expect(calls).toEqual(['closeDb', 'openDb', 'afterFlip']);
      expect(fs.readFileSync(path.join(dest, 'hologram.db'), 'utf8')).toBe('DBBYTES');
    });

    test('a database that will not open at dest rolls the pointer back to src and leaves src intact', async () => {
      const { src, dest } = mkroot();
      seed(src, { 'hologram.db': 'DBBYTES', 'a.jpg': 'AAA' });
      let cfg: any = { saveFolder: src };
      let reopenedOldDb = false;

      const res = await relocateLibrary(src, dest, {
        readConfig: () => ({ ...cfg }),
        writeConfig: (c: any) => {
          cfg = c;
        },
        emit: () => {},
        afterFlip: () => {
          throw new Error('afterFlip must not run when the new database never opened');
        },
        stillCurrent: () => true,
        sweepDelayMs: 50,
        closeDb: () => {},
        openDb: () => {
          if (cfg.saveFolder === src) {
            reopenedOldDb = true;
            return; // the rollback's own reopen — let it succeed
          }
          throw new Error('simulated corrupt copy');
        },
      });

      expect(res).toMatchObject({ ok: false, error: 'db-open-failed' });
      expect(cfg.saveFolder).toBe(src); // rolled back
      expect(reopenedOldDb).toBe(true); // the library is left open and usable, not just pointed at
      expect(fs.existsSync(path.join(src, 'a.jpg'))).toBe(true); // src never touched
      expect(fs.existsSync(path.join(src, 'hologram.db'))).toBe(true);
    });

    test('closeDb/openDb are both optional — omitting them behaves exactly like before #176', async () => {
      const { src, dest } = mkroot();
      seed(src, { 'a.jpg': 'AAA' });
      let cfg: any = { saveFolder: src };

      const res = await relocateLibrary(src, dest, {
        readConfig: () => ({ ...cfg }),
        writeConfig: (c: any) => {
          cfg = c;
        },
        emit: () => {},
        afterFlip: () => {},
        stillCurrent: () => true,
        sweepDelayMs: 50,
      });

      expect(res).toMatchObject({ ok: true, saveFolder: dest });
    });
  });
});

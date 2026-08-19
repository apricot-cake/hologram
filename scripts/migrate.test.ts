// app/src/main/lib-migrate.ts の単体テスト＝保存フォルダの引っ越しエンジン
// （BACKLOG L1: 移動の最中に src へ着地したキャプチャが見過ごされ、取り残されていた）。
// 素の Node と一時ディレクトリだけで動く＝Electron は要らない。追いかけコピーのループ、
// 削除前の検証、空になった殻の撤去、取り残しを掃くための冷/熱の判定、
// relocateLibrary の全体の統率（config 反転の順序、取り残しの報告、遅延掃除）を覆う。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { copyLibraryInto, relocateLibrary, removeEmptyDefaultLibraryParent, sweepStragglers, verifyAndCleanup } from '../app/src/main/lib-migrate';

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

  // #299 (St6): .hologram-inbox も、入れ子を持つトップレベルのエントリが1つ増えるだけ。
  // 上の .trash がすでに受けているのと同じ「中身を見ないディレクトリを1単位として
  // コピー・検証・削除する」扱いになる。lib-migrate.ts に変更は要らなかった。ここでは
  // 入れ子の inbox/new/segments の木が保存フォルダの移動を生き延びることを固定する。
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

  // L1 の中心のケース。追いかけループが、コピー中に着地したファイルを拾う
  test('コピー中に着地したファイルを拾う', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA', 'b.jpg': 'BBB' });
    let dropped = false;

    const cp = await copyLibraryInto(src, dest, (done: number) => {
      // 最初のコピーの最中に native-host のキャプチャが着地する状況を模す
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
      // 途中で宛先とぶつかる名前を落とす → 追いかけコピーが EEXIST で失敗する
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
    // 途中で切れたコピーと、コピーの後に src 側で行った編集（整理用 JSON の書き換え）を模す
    fs.writeFileSync(path.join(dest, 'a.jpg'), 'X');
    fs.writeFileSync(path.join(src, 'tags.json'), '{"v":2,"edited":true}');

    const cl = await verifyAndCleanup(src, dest, cp.entries);

    expect(cl).toMatchObject({ removed: 2, emptied: true });
    expect(read(dest, 'a.jpg')).toBe('AAAAAA');
    expect(read(dest, 'tags.json')).toBe('{"v":2,"edited":true}'); // コピー後の編集が勝つ（最新が正）
  });

  test('未知の着地は leftover として残す', async () => {
    const { src, dest } = mkroot();
    seed(src, { 'a.jpg': 'AAA' });
    const cp = await copyLibraryInto(src, dest, null);
    // 最後の追いかけループより後に着地したキャプチャ（隙間の時間帯）
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
    // 中身が同じ組には同じ mtime を与える（前の段で実際にコピーされていればそうなる）
    const t = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dest, 'dup.jpg'), t, t);

    const sw = await sweepStragglers(src, dest, { minAgeMs: 15000 });

    expect(sw).toMatchObject({ moved: 1, left: 1 });
    expect(fs.existsSync(path.join(src, 'dup.jpg'))).toBe(false);
    expect(read(dest, 'diff.jpg')).toBe('THEIRS-LONGER');
    expect(fs.existsSync(path.join(src, 'diff.jpg'))).toBe(true);
  });
});

describe('removeEmptyDefaultLibraryParent', () => {
  test('既定の library を撤去した後、空の Hologram 親フォルダも撤去する', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-default-parent-'));
    const defaultLibrary = path.join(root, 'Hologram', 'library');
    fs.mkdirSync(defaultLibrary, { recursive: true });
    fs.rmdirSync(defaultLibrary);

    const removed = await removeEmptyDefaultLibraryParent(defaultLibrary, defaultLibrary);

    expect(removed).toBe(true);
    expect(fs.existsSync(path.dirname(defaultLibrary))).toBe(false);
  });

  test('既定の親に別のファイルがあれば残す', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-default-parent-'));
    const parent = path.join(root, 'Hologram');
    const defaultLibrary = path.join(parent, 'library');
    fs.mkdirSync(defaultLibrary, { recursive: true });
    fs.writeFileSync(path.join(parent, 'keep.txt'), 'KEEP');
    fs.rmdirSync(defaultLibrary);

    const removed = await removeEmptyDefaultLibraryParent(defaultLibrary, defaultLibrary);

    expect(removed).toBe(false);
    expect(read(parent, 'keep.txt')).toBe('KEEP');
  });

  test('任意のライブラリの親は空でも触らない', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-default-parent-'));
    const defaultLibrary = path.join(root, 'Hologram', 'library');
    const customLibrary = path.join(root, 'MyStuff', 'Hologram-library');
    fs.mkdirSync(customLibrary, { recursive: true });
    fs.rmdirSync(customLibrary);

    const removed = await removeEmptyDefaultLibraryParent(customLibrary, defaultLibrary);

    expect(removed).toBe(false);
    expect(fs.existsSync(path.dirname(customLibrary))).toBe(true);
  });
});

describe('relocateLibrary（全体の統率）', () => {
  test('既定位置からの移動が完了すると、空になった既定の親も撤去する', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-default-relocate-'));
    const src = path.join(root, 'home', 'Hologram', 'library');
    const dest = path.join(root, 'destination', 'Hologram-library');
    seed(src, { 'a.jpg': 'AAA' });
    let cfg: any = { saveFolder: src };

    const res = await relocateLibrary(src, dest, {
      readConfig: () => ({ ...cfg }),
      writeConfig: (c: any) => {
        cfg = c;
      },
      emit: () => {},
      afterFlip: () => {},
      stillCurrent: () => cfg.saveFolder === dest,
      defaultLibraryDir: src,
    });

    expect(res).toMatchObject({ ok: true, leftover: 0 });
    expect(fs.existsSync(path.join(root, 'home', 'Hologram'))).toBe(false);
    expect(read(dest, 'a.jpg')).toBe('AAA');
  });

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
    expect(cfg).toMatchObject({ saveFolder: dest, extensionId: 'x' }); // 他のキーは保つ
    expect(flippedBeforeCleanup).toBe(true); // 途中で落ちても安全側に残る順序
    expect(afterFlipCalled).toBe(true); // 監視・差分のためのフック
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

  // 隙間の時間帯に着地した取り残しは、まず報告され、冷えたところで予約された掃除が回収する
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
          // 最後の追いかけ readdir より後に着地させる。掃除は既定の15秒の minAge を
          // 使うので、ファイルのタイムスタンプを巻き戻して「冷えて」見えるようにする。
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

    // 予約された掃除（sweepDelayMs: 50）は自分から知らせる。'straggler' を出すのは
    // sweepStragglers が解決した後だけで、その時点で late.jpg は移動済み、空になった src の
    // 殻も消えている。だからこのイベント1つが下の3つのアサーション全部のゲートになる。
    await vi.waitFor(() => expect(events.some((p) => p.phase === 'straggler')).toBe(true));

    expect(events.find((p) => p.phase === 'straggler').moved).toBe(1);
    expect(read(dest, 'late.jpg')).toBe('LATE');
    expect(fs.existsSync(src)).toBe(false);
  });

  // #176: hologram.db はライブラリフォルダの中に置くようになった。だから他のファイルと
  // 同じく copyLibraryInto を通って運ばれる。ここではそのコピーを挟む閉じ直し・開き直しの
  // 順序を固定する（lib-migrate.ts の step 0 / step 2.5）。
  describe('#176: コピーを挟む closeDb/openDb の順序', () => {
    test('closeDb はコピーの前、openDb は反転の後・cleanup が src を消す前', async () => {
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
          expect(fs.existsSync(path.join(dest, 'hologram.db'))).toBe(false); // まだコピーされていない
        },
        openDb: () => {
          calls.push('openDb');
          expect(cfg.saveFolder).toBe(dest); // ポインタはすでに反転している
          expect(fs.existsSync(src)).toBe(true); // src はまだ撤去していない＝ここが投げたときの退避先
        },
      });

      expect(res).toMatchObject({ ok: true });
      expect(calls).toEqual(['closeDb', 'openDb', 'afterFlip']);
      expect(fs.readFileSync(path.join(dest, 'hologram.db'), 'utf8')).toBe('DBBYTES');
    });

    test('宛先で開けない DB はポインタを src へ巻き戻し、src を無傷で残す', async () => {
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
          throw new Error('新しい DB が開かなかったときに afterFlip が走ってはいけない');
        },
        stillCurrent: () => true,
        sweepDelayMs: 50,
        closeDb: () => {},
        openDb: () => {
          if (cfg.saveFolder === src) {
            reopenedOldDb = true;
            return; // 巻き戻し自身の開き直し＝これは成功させる
          }
          throw new Error('壊れたコピーの模擬');
        },
      });

      expect(res).toMatchObject({ ok: false, error: 'db-open-failed' });
      expect(cfg.saveFolder).toBe(src); // 巻き戻した
      expect(reopenedOldDb).toBe(true); // 指し直すだけでなく、ライブラリを開いて使える状態で残す
      expect(fs.existsSync(path.join(src, 'a.jpg'))).toBe(true); // src には一切触れていない
      expect(fs.existsSync(path.join(src, 'hologram.db'))).toBe(true);
    });

    test('closeDb/openDb はどちらも任意＝渡さなければ #176 以前とまったく同じ挙動', async () => {
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

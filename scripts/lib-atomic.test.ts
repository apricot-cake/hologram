// app/src/main/lib-atomic.ts のユニットテスト＝「tmp へ書いて rename」を1本に
// まとめた土台（#229）。
//
// ここは書き込みの安全性そのものなので、押さえるのは「うまくいった時」より
// **壊れ方**。集約前は呼び出し元ごとに手書きで、後始末も fsync もばらついていた
// ＝一元化でその壊れ方が変わっていないか（変えたなら意図した1点だけか）を、
// 次の4点で固定する。
//   ① 中身が届くこと・rename が確定点であること（tmp は残らない）
//   ② tmp の名前（`<宛先>.tmp` と、呼び出し元が指定する接尾辞）
//      ＝バックアップ・移行・整合性チェックの各スキャナが「読み飛ばす名前」の
//      パターンと一致していないと、書きかけがライブラリの一員に見えてしまう
//   ③ 失敗の伝わり方＝投げられた例外はそのまま素通しで、宛先は元のまま
//   ④ 書き込み先のフォルダが無い時は ENOENT で失敗する（勝手に作らない）
//
// ①〜④は集約前の実装の挙動と同じ。唯一の意図した変更は「失敗時に tmp を必ず
// 消す」＝集約前は後始末をしていたのがバックアップのコピーだけだった。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { commitFileAtomic, commitFileAtomicSync, writeFileAtomicSync } from '../app/src/main/lib-atomic';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-atomic-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const leftovers = () => fs.readdirSync(dir).filter((n) => /\.tmp/i.test(n));

describe('writeFileAtomicSync', () => {
  test('中身が届き、tmp は残らない', () => {
    const file = path.join(dir, 'config.json');
    writeFileAtomicSync(file, '{"a":1}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(leftovers()).toEqual([]);
  });

  test('文字列は UTF-8・Buffer はそのまま', () => {
    writeFileAtomicSync(path.join(dir, 'text'), 'あ');
    writeFileAtomicSync(path.join(dir, 'bin'), Buffer.from([0xff, 0x00, 0x41]));
    expect(fs.readFileSync(path.join(dir, 'text'))).toEqual(Buffer.from('あ', 'utf8'));
    expect(fs.readFileSync(path.join(dir, 'bin'))).toEqual(Buffer.from([0xff, 0x00, 0x41]));
  });

  test('既存の宛先は丸ごと置き換わる（追記でも部分上書きでもない）', () => {
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, '{"long":"aaaaaaaaaaaaaaaaaaaa"}');
    writeFileAtomicSync(file, '{}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{}');
  });

  test('fsync 指定でも書かれるものは同じ', () => {
    const file = path.join(dir, 'config.json');
    writeFileAtomicSync(file, '{"fsync":true}', { fsync: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('{"fsync":true}');
    expect(leftovers()).toEqual([]);
  });

  test('宛先のフォルダが無ければ ENOENT で失敗し、何も作らない', () => {
    const missing = path.join(dir, 'nope', 'config.json');
    expect(() => writeFileAtomicSync(missing, '{}')).toThrow(/ENOENT/);
    expect(fs.existsSync(path.join(dir, 'nope'))).toBe(false);
  });

  test('居座った古い tmp があっても上書きして進む（固定名の衝突は失敗ではない）', () => {
    const file = path.join(dir, 'saveFolder.path');
    fs.writeFileSync(`${file}.tmp`, 'GARBAGE FROM AN INTERRUPTED WRITE');
    writeFileAtomicSync(file, 'D:\\lib');
    expect(fs.readFileSync(file, 'utf8')).toBe('D:\\lib');
    expect(leftovers()).toEqual([]);
  });
});

describe('commitFileAtomicSync', () => {
  test('tmp の名前は既定で `<宛先>.tmp`＝スキャナが読み飛ばす形', () => {
    const file = path.join(dir, 'index.json');
    let seen = '';
    commitFileAtomicSync(file, (tmp) => {
      seen = tmp;
      fs.writeFileSync(tmp, 'x');
      // rename 前は宛先がまだ存在しない＝rename が確定点。
      expect(fs.existsSync(file)).toBe(false);
    });
    expect(seen).toBe(`${file}.tmp`);
    expect(/\.tmp(-\d+)?$/i.test(path.basename(seen))).toBe(true);
  });

  test('tmpSuffix を渡すとその名前になる', () => {
    const file = path.join(dir, 'a.jpg');
    let seen = '';
    commitFileAtomicSync(
      file,
      (tmp) => {
        seen = tmp;
        fs.writeFileSync(tmp, 'x');
      },
      { tmpSuffix: '.tmp-1234' },
    );
    expect(seen).toBe(`${file}.tmp-1234`);
    expect(leftovers()).toEqual([]);
  });

  test('書き手が投げたら例外はそのまま素通しし、tmp も残らず宛先も元のまま', () => {
    const file = path.join(dir, 'index.json');
    fs.writeFileSync(file, 'OLD');
    const boom = new Error('disk full');
    expect(() =>
      commitFileAtomicSync(file, (tmp) => {
        fs.writeFileSync(tmp, 'HALF');
        throw boom;
      }),
    ).toThrow(boom);
    expect(fs.readFileSync(file, 'utf8')).toBe('OLD');
    expect(leftovers()).toEqual([]);
  });

  test('書き手が tmp を作る前に落ちても、後始末は静かに諦める', () => {
    const boom = new Error('nothing written');
    expect(() =>
      commitFileAtomicSync(path.join(dir, 'index.json'), () => {
        throw boom;
      }),
    ).toThrow(boom);
    expect(leftovers()).toEqual([]);
  });

  test('rename が失敗したら（宛先がフォルダ）例外が伝わり、tmp は残らない', () => {
    const file = path.join(dir, 'occupied');
    fs.mkdirSync(file);
    expect(() => commitFileAtomicSync(file, (tmp) => fs.writeFileSync(tmp, 'x'))).toThrow();
    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(leftovers()).toEqual([]);
  });
});

describe('commitFileAtomic（非同期）', () => {
  test('書き手が tmp を埋め、rename で確定する', async () => {
    const file = path.join(dir, 'copy.bin');
    const source = path.join(dir, 'source.bin');
    fs.writeFileSync(source, 'PAYLOAD');
    await commitFileAtomic(file, (tmp) => fs.promises.copyFile(source, tmp), { tmpSuffix: '.tmp-9' });
    expect(fs.readFileSync(file, 'utf8')).toBe('PAYLOAD');
    expect(leftovers()).toEqual([]);
  });

  test('書き手が reject したら例外はそのまま素通しし、tmp も残らない', async () => {
    const file = path.join(dir, 'copy.bin');
    const boom = new Error('entry exceeds per-entry byte cap');
    await expect(
      commitFileAtomic(
        file,
        async (tmp) => {
          await fs.promises.writeFile(tmp, 'HALF');
          throw boom;
        },
        { tmpSuffix: '.tmp-import' },
      ),
    ).rejects.toBe(boom);
    expect(fs.existsSync(file)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  test('宛先のフォルダが無ければ ENOENT で失敗する', async () => {
    await expect(commitFileAtomic(path.join(dir, 'nope', 'x.bin'), (tmp) => fs.promises.writeFile(tmp, 'x'))).rejects.toThrow(/ENOENT/);
  });

  test('rename が失敗したら（宛先がフォルダ）例外が伝わり、tmp は残らない', async () => {
    const file = path.join(dir, 'occupied');
    fs.mkdirSync(file);
    await expect(commitFileAtomic(file, (tmp) => fs.promises.writeFile(tmp, 'x'))).rejects.toThrow();
    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(leftovers()).toEqual([]);
  });
});

// app/src/main/lib-atomic.ts の単体テスト。「tmp へ書いてから rename する」を1か所へ
// まとめた土台 (#229)。
//
// これは書き込みの安全性そのものなので、大事なのは「成功する時」よりも壊れ方の側。
// まとめる前は呼び出し側がそれぞれ自前で書いていて、後始末も fsync もばらついていた。
// 集約で壊れ方が変わっていないか（変わったなら、意図した1点だけか）を、次の4点で押さえる:
//   (1) 中身が実際に届き、rename が確定の点であること（tmp を残さない）
//   (2) tmp ファイルの名前（`<宛先>.tmp` に、呼び出し側が渡す接尾辞を足したもの）
//      ＝バックアップ・移行・整合性検査のスキャナがそれぞれ使う「読み飛ばす名前」の
//      パターンに合わないと、書きかけのファイルがライブラリの一員に見えてしまう
//   (3) 失敗の伝わり方＝投げられた例外はそのまま素通しし、宛先は元のまま
//   (4) 宛先のフォルダが無ければ ENOENT で失敗する（自分では作らない）
//
// (1)-(4) はまとめる前の実装の振る舞いと一致する。意図して変えたのは1つだけ、「失敗したら
// 必ず tmp を片付ける」＝まとめる前にその後始末をしていたのはバックアップの写しだけだった。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { commitFileAtomic, commitFileAtomicSync, writeFileAtomicSync } from './lib-atomic';

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
      // rename の前は宛先がまだ存在しない＝rename が確定の点。
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

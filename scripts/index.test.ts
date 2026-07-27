// app/src/main/lib-index.ts（listPosts() のインデックス）のユニットテスト。読み取り回数を
// 数える fs ラッパで O(変更数) の保証を検査する＝変わっていない sidecar は二度と読まない、
// 追加・編集された sidecar はその1つだけ読む、削除は読まずに落とす、新しいインスタンスは
// .index.json スナップショットから sidecar を1つも読まずに復元する。

import realFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { computeDelta, createPostIndex } from '../app/src/main/lib-index';

const INTERNAL = new Set(['config.json', '.index.json', 'tabs.json', 'folders.json', 'tag-types.json', 'ungrouped.json', 'manual-groups.json']);

let sidecarReads = 0;
const countingFs = {
  promises: {
    readdir: (...a: any[]) => (realFs.promises.readdir as any)(...a),
    stat: (...a: any[]) => (realFs.promises.stat as any)(...a),
    readFile: (p: any, ...a: any[]) => {
      const s = String(p);
      if (/\.json$/i.test(s) && !s.endsWith('.index.json')) sidecarReads++;
      return (realFs.promises.readFile as any)(p, ...a);
    },
    writeFile: (...a: any[]) => (realFs.promises.writeFile as any)(...a),
    rename: (...a: any[]) => (realFs.promises.rename as any)(...a),
  },
};

// #216 / #119 の検査には本物の open() を持つ fs が要る（countingFs には無く、
// そこでは augmentDims が何もしない）。開いたパスを全部記録する。
const opened: string[] = [];
const dimsFs = {
  promises: {
    ...countingFs.promises,
    open: (p: any, ...a: any[]) => {
      opened.push(String(p));
      return (realFs.promises.open as any)(p, ...a);
    },
  },
};

const dirs: string[] = [];
function mktemp(tag: string) {
  const d = realFs.mkdtempSync(path.join(os.tmpdir(), `hologram-${tag}-`));
  dirs.push(d);
  return d;
}
const writeSidecarIn = (d: string, name: string, rec: unknown) => realFs.writeFileSync(path.join(d, name), JSON.stringify(rec));
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');

afterAll(() => {
  for (const d of dirs) realFs.rmSync(d, { recursive: true, force: true });
});

// 1つのインデックスを順に育てるので、この describe の中はテストの宣言順に意味がある
describe('再利用・追加・削除・スナップショット復元', () => {
  let dir: string;
  let idx: any;

  beforeAll(() => {
    dir = mktemp('index');
    writeSidecarIn(dir, 'a.json', { captureId: 'a', image: 'a.jpg', capturedAt: '2026-01-01T00:00:00Z' });
    writeSidecarIn(dir, 'b.json', { captureId: 'b', image: 'b.jpg', capturedAt: '2026-01-03T00:00:00Z' });
    writeSidecarIn(dir, 'c.json', { captureId: 'c', image: 'c.jpg', capturedAt: '2026-01-02T00:00:00Z' });
    writeSidecarIn(dir, 'notapost.json', { foo: 1 }); // image/video/media 無し → 除外
    writeSidecarIn(dir, 'config.json', { saveFolder: dir }); // 内部ファイル → 除外
    idx = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
  });

  test('初回走査: capturedAt 降順で3件、sidecar は1つずつ読む', async () => {
    sidecarReads = 0;
    const r = await idx.list(dir);

    expect(r.posts.map((p: any) => p.captureId)).toEqual(['b', 'c', 'a']);
    expect(r.changed).toBe(true);
    expect(sidecarReads).toBe(4); // a,b,c,notapost
  });

  test('変化が無ければ読み直さない（mtime で使い回す）', async () => {
    sidecarReads = 0;
    const r = await idx.list(dir);

    expect(r.changed).toBe(false);
    expect(sidecarReads).toBe(0);
  });

  test('1件追加すると、その1件だけを読む', async () => {
    writeSidecarIn(dir, 'd.json', { captureId: 'd', image: 'd.jpg', capturedAt: '2026-01-04T00:00:00Z' });
    sidecarReads = 0;
    const r = await idx.list(dir);

    expect(r.posts).toHaveLength(4);
    expect(r.posts[0].captureId).toBe('d');
    expect(r.changed).toBe(true);
    expect(sidecarReads).toBe(1);
  });

  test('削除は読まずに落とす', async () => {
    realFs.rmSync(path.join(dir, 'a.json'));
    sidecarReads = 0;
    const r = await idx.list(dir);

    expect(r.posts.map((p: any) => p.captureId)).toEqual(['d', 'b', 'c']);
    expect(r.changed).toBe(true);
    expect(sidecarReads).toBe(0);
  });

  test('スナップショットを書くと、新しいインスタンスが sidecar を読まずに復元する', async () => {
    await idx.writeSnapshot(dir);
    expect(realFs.existsSync(path.join(dir, '.index.json'))).toBe(true);

    const idx2 = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
    sidecarReads = 0;
    const r = await idx2.list(dir);

    expect(r.posts.map((p: any) => p.captureId)).toEqual(['d', 'b', 'c']);
    expect(r.changed).toBe(false);
    expect(sidecarReads).toBe(0);
  });
});

// レンダラー側の差分（新規／mtime が動いた＝added、消えた＝removed）
describe('computeDelta', () => {
  const post = (id: string, m: number) => ({ captureId: id, _m: m });
  const stampsOf = (arr: any[]) => new Map(arr.map((p) => [p.captureId, p._m]));

  test('added は新規＋mtime が動いたもの、removed は消えたもの', () => {
    const last = stampsOf([post('a', 1), post('b', 1), post('c', 1)]);
    const now = [post('a', 1), post('b', 2), post('d', 5)]; // a 据置・b 編集・c 消滅・d 追加

    const d = computeDelta(last, now, stampsOf(now));
    expect(d.added.map((p: any) => p.captureId).sort()).toEqual(['b', 'd']);
    expect(d.removed.sort()).toEqual(['c']);
  });

  test('何も動いていなければ差分は空', () => {
    const now = [post('a', 1), post('b', 2)];
    const d = computeDelta(stampsOf(now), now, stampsOf(now));

    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });
});

// fs 監視のヒントからの局所更新＝名指しされた sidecar だけを stat し直し、
// フォルダ全体を走査しない
describe('applyChanges（局所更新）', () => {
  let dir: string;
  let idx: any;
  let chg: any;

  beforeAll(async () => {
    dir = mktemp('index2');
    writeSidecarIn(dir, 'x.json', { captureId: 'x', image: 'x.jpg', capturedAt: '2026-02-01T00:00:00Z' });
    writeSidecarIn(dir, 'y.json', { captureId: 'y', image: 'y.jpg', capturedAt: '2026-02-02T00:00:00Z' });
    idx = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
    await idx.list(dir);

    // y を編集（mtime を確実に動かす）・z を追加・x を削除してから、その3つだけを教える
    writeSidecarIn(dir, 'y.json', { captureId: 'y', image: 'y.jpg', capturedAt: '2026-02-02T00:00:00Z', tags: ['edited'] });
    realFs.utimesSync(path.join(dir, 'y.json'), new Date(), new Date(Date.now() + 10000));
    writeSidecarIn(dir, 'z.json', { captureId: 'z', image: 'z.jpg', capturedAt: '2026-02-03T00:00:00Z' });
    realFs.rmSync(path.join(dir, 'x.json'));

    sidecarReads = 0;
    chg = await idx.applyChanges(dir, ['y.json', 'z.json', 'x.json']);
  });

  test('added は編集＋新規、removed は削除', () => {
    expect(chg.added.map((a: any) => a.id).sort()).toEqual(['y', 'z']);
    expect(chg.removed.sort()).toEqual(['x']);
  });

  test('編集されたレコードは新しい中身を運ぶ', () => {
    expect(chg.added.find((a: any) => a.id === 'y').record.tags[0]).toBe('edited');
  });

  test('読むのは y と z だけ（削除された x は stat が失敗するので読まない）', () => {
    expect(sidecarReads).toBe(2);
  });

  test('あとから全走査しても局所更新の状態と一致し、読み直しも起きない', async () => {
    sidecarReads = 0;
    const r = await idx.list(dir);

    expect(r.posts.map((p: any) => p.captureId)).toEqual(['z', 'y']);
    expect(r.changed).toBe(false);
    expect(sidecarReads).toBe(0);
  });
});

// BACKLOG L3: 手編集で UTF-8 BOM 付きになった sidecar も解釈できなければならない。
// ここで throw すると record:null になり、投稿が黙って消える（最悪はフォルダからも消される）。
// BOM 付きの .index.json スナップショットも同じ（冷えた復元が再走査へ落ちてはいけない）。
describe('BOM 耐性', () => {
  const BOM = String.fromCharCode(0xfeff);
  let dir: string;

  beforeAll(() => {
    dir = mktemp('index3');
    realFs.writeFileSync(path.join(dir, 'bom.json'), BOM + JSON.stringify({ captureId: 'bom', image: 'bom.jpg', capturedAt: '2026-03-01T00:00:00Z' }));
  });

  test('BOM 付きの sidecar も解釈できる', async () => {
    const r = await createPostIndex({ fs: countingFs, internalFiles: INTERNAL }).list(dir);

    expect(r.posts).toHaveLength(1);
    expect(r.posts[0].captureId).toBe('bom');
  });

  test('BOM 付きのスナップショットからも、再走査せず復元できる', async () => {
    const idx = createPostIndex({ fs: countingFs, internalFiles: INTERNAL });
    await idx.list(dir);
    await idx.writeSnapshot(dir);
    const snapPath = path.join(dir, '.index.json');
    realFs.writeFileSync(snapPath, BOM + realFs.readFileSync(snapPath, 'utf8'));

    sidecarReads = 0;
    const r = await createPostIndex({ fs: countingFs, internalFiles: INTERNAL }).list(dir);

    expect(r.posts).toHaveLength(1);
    expect(sidecarReads).toBe(0);
  });
});

// #216: sidecar の `image` が保存フォルダの外を指していたら（敵対的な書き出し ZIP の JSON は
// そのまま読まれる）開いてはいけない。フォルダ内の普通の画像は従来どおり採寸する。
describe('readImageDims のフォルダ制限（#216）', () => {
  let good: any;
  let evil: any;

  beforeAll(async () => {
    const dir = mktemp('index-clamp');
    const outside = mktemp('outside');
    const secret = path.join(outside, 'secret.png');
    realFs.writeFileSync(secret, png1x1);
    realFs.writeFileSync(path.join(dir, 'good.png'), png1x1);
    writeSidecarIn(dir, 'good.json', { captureId: 'good', image: 'good.png', capturedAt: '2026-04-01T00:00:00Z' });
    // 敵対的な sidecar: image が ../ で隣のフォルダへ抜ける
    writeSidecarIn(dir, 'evil.json', { captureId: 'evil', image: path.relative(dir, secret).split(path.sep).join('/'), capturedAt: '2026-04-02T00:00:00Z' });

    opened.length = 0;
    const r = await createPostIndex({ fs: dimsFs, internalFiles: INTERNAL }).list(dir);
    good = r.posts.find((p: any) => p.captureId === 'good');
    evil = r.posts.find((p: any) => p.captureId === 'evil');
  });

  test('フォルダ内の画像は従来どおり採寸される', () => {
    expect({ w: good.shotW, h: good.shotH }).toEqual({ w: 1, h: 1 });
  });

  test('フォルダ外の画像は決して開かれない', () => {
    expect(opened.some((p) => p.endsWith('secret.png'))).toBe(false);
  });

  test('抜け出す画像は採寸不能の番人値（0）になる', () => {
    expect(evil.shotW).toBe(0);
  });
});

// #119 St1: 動画の（採寸できない）本体の代わりにポスターを測る。ポスターが無ければ
// capture のスクリーンショットへ落ち、生の動画ファイル自体は決して開かない。
describe('cardImageFile / augmentDims と動画（#119 St1）', () => {
  let v1: any;
  let v2: any;

  beforeAll(async () => {
    const dir = mktemp('index-video');
    realFs.writeFileSync(path.join(dir, 'v1-poster.png'), png1x1);
    realFs.writeFileSync(path.join(dir, 'v1-media-0.mp4'), Buffer.from('fake-mp4'));
    writeSidecarIn(dir, 'v1.json', { captureId: 'v1', media: [{ file: 'v1-media-0.mp4', type: 'video', posterFile: 'v1-poster.png' }], capturedAt: '2026-05-01T00:00:00Z' });
    // ポスターも capture スクリーンショット（rec.image）も無い＝二重に外した場合
    realFs.writeFileSync(path.join(dir, 'v2-media-0.mp4'), Buffer.from('fake-mp4'));
    writeSidecarIn(dir, 'v2.json', { captureId: 'v2', media: [{ file: 'v2-media-0.mp4', type: 'video' }], capturedAt: '2026-05-02T00:00:00Z' });

    opened.length = 0;
    const r = await createPostIndex({ fs: dimsFs, internalFiles: INTERNAL }).list(dir);
    v1 = r.posts.find((p: any) => p.captureId === 'v1');
    v2 = r.posts.find((p: any) => p.captureId === 'v2');
  });

  test('動画のポスターがメイソンリーの場所取りのために採寸される', () => {
    expect(v1.shotW).toBe(1);
  });

  test('ポスターの無い動画は採寸不能の番人値になる（動画ファイルを測らない）', () => {
    expect(v2.shotW).toBe(0);
  });

  test('どちらの場合も生の動画ファイルは開かれない', () => {
    expect(opened.some((p) => p.endsWith('v1-media-0.mp4'))).toBe(false);
    expect(opened.some((p) => p.endsWith('v2-media-0.mp4'))).toBe(false);
  });
});

// #365: 画像も動画もメディアも無い投稿は「投稿レコードではない」として捨てられており、
// 一括取り込み（#362）が書いたテキストのブックマークが黙って消えていた（X にブックマークの
// 書き出しは無く、復旧不能）。投稿の同一性（パーマリンク＋captureId）があれば認める。
// アプリが持つ JSON はどちらも持たないので、従来どおり入らない。
describe('テキストのみの投稿もレコード（#365）', () => {
  let r: any;

  beforeAll(async () => {
    const dir = mktemp('index-textonly');
    writeSidecarIn(dir, 't1.json', { captureId: 't1', url: 'https://x.com/alice/status/1', text: 'no pictures here', capturedAt: '2026-06-01T00:00:00Z' });
    writeSidecarIn(dir, 'folders.json', { folders: [{ id: 'f1', name: 'Nope' }] });
    writeSidecarIn(dir, 'stray.json', { hello: 'not a post' });

    r = await createPostIndex({ fs: countingFs, internalFiles: INTERNAL }).list(dir);
  });

  test('テキストのみの投稿がインデックスに入り、text も残る', () => {
    const t1 = r.posts.find((p: any) => p.captureId === 't1');
    expect(t1).toBeTruthy();
    expect(t1.text).toBe('no pictures here');
  });

  test('測るものが無いのでメイソンリーの場所取りは主張しない', () => {
    expect(r.posts.find((p: any) => p.captureId === 't1').shotW).toBeFalsy();
  });

  test('同一性を持たない JSON は投稿レコードではない', () => {
    expect(r.posts).toHaveLength(1); // folders.json は内部・stray.json は同一性なし
  });
});

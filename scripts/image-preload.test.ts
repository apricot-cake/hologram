// Unit tests for image-tab/preload.ts's logic (#241 neighbor preload).
//
// What's pinned down here is the 2 acceptance criteria that can be fixed
// mechanically = ① preload targets are limited to "neighbors" (i.e. memory doesn't
// grow unbounded even on tabs with huge page counts, and the cap on how many are
// held is decided by the radius alone) ② things that aren't images (video, ugoira
// archives) aren't preload targets. Whether it actually feels faster (whether fetch
// and decode are truly warmed up) is the domain of real-Electron measurement =
// out of scope here.
//
// `new Image()` is a browser-side API, so to inspect just the hold/evict bookkeeping
// we stub a minimal version onto global (a plain node environment has no such global).

import { afterEach, describe, expect, test, vi } from 'vitest';
import * as P from '../app/src/renderer/src/image-tab/preload';

const img = (src: string) => ({ src });
const video = (src: string) => ({ src, video: true });
const ugoira = (src: string, poster?: string) => ({ src, ugoira: { file: 'a.zip', frames: [] }, poster });

describe('stillSourceOf: <img> が実際に描く静止画だけを返す', () => {
  test('ふつうの画像はその src', () => {
    expect(P.stillSourceOf(img('asset://a.jpg'))).toBe('asset://a.jpg');
  });
  test('動画は対象外＝<video> は preload="metadata" の契約を持つ', () => {
    expect(P.stillSourceOf(video('asset://a.mp4'))).toBeUndefined();
  });
  test('うごイラはポスター（アーカイブは IPC 経由なので <img> では温められない）', () => {
    expect(P.stillSourceOf(ugoira('asset://a.zip', 'asset://a.jpg'))).toBe('asset://a.jpg');
    expect(P.stillSourceOf(ugoira('asset://a.zip'))).toBeUndefined();
  });
  test('欠けた項目・空 src は何も返さない', () => {
    expect(P.stillSourceOf(undefined)).toBeUndefined();
    expect(P.stillSourceOf(img(''))).toBeUndefined();
  });
});

describe('neighborPreloadSources: 隣接だけ・近い順・前が先', () => {
  const five = ['a', 'b', 'c', 'd', 'e'].map((s) => img(s));

  test('既定の半径は 1＝前後1枚ずつ、次に進む側が先', () => {
    expect(P.PRELOAD_RADIUS).toBe(1);
    expect(P.neighborPreloadSources(five, 2)).toEqual(['d', 'b']);
  });

  test('端は巻き戻る（ステージの前後移動が巻き戻るのと同じ）', () => {
    expect(P.neighborPreloadSources(five, 0)).toEqual(['b', 'e']);
    expect(P.neighborPreloadSources(five, 4)).toEqual(['a', 'd']);
  });

  test('半径を広げても「隣接から順に 2×半径 枚」で頭打ち＝枚数に依らない', () => {
    expect(P.neighborPreloadSources(five, 2, 2)).toEqual(['d', 'b', 'e', 'a']);
    // Even with 100 pages, the hold count is decided by the radius alone (the acceptance criterion for not growing unbounded)
    const many = Array.from({ length: 100 }, (_, k) => img(`p${k}`));
    expect(P.neighborPreloadSources(many, 50)).toHaveLength(2);
    expect(P.neighborPreloadSources(many, 50, 3)).toHaveLength(6);
  });

  test('表示中の1枚は先読みしない（半径が枚数を越えて回り込んでも）', () => {
    expect(P.neighborPreloadSources(five, 2)).not.toContain('c');
    expect(P.neighborPreloadSources([img('a'), img('b')], 0, 3)).toEqual(['b']);
  });

  test('1枚だけのタブは何もしない', () => {
    expect(P.neighborPreloadSources([img('a')], 0)).toEqual([]);
    expect(P.neighborPreloadSources([], 0)).toEqual([]);
  });

  test('同じ src の重複は1回だけ', () => {
    expect(P.neighborPreloadSources([img('a'), img('b'), img('b')], 0, 2)).toEqual(['b']);
  });

  test('隣が動画なら飛ばす＝その分を遠くから埋めたりはしない', () => {
    expect(P.neighborPreloadSources([img('a'), video('v'), img('c')], 0)).toEqual(['c']);
    expect(P.neighborPreloadSources([img('a'), video('v'), video('w')], 0)).toEqual([]);
  });

  test('idx が範囲外でも隣接の計算は破綻しない', () => {
    expect(P.neighborPreloadSources(five, 7)).toEqual(P.neighborPreloadSources(five, 2));
  });
});

describe('createNeighborPreloader: 保持と追い出しの帳簿', () => {
  // Record src / decoding at the time decode() is called (the attributes get
  // assigned after construction, so reading them in the constructor gives empty values).
  const made: { src: string; decoding: string }[] = [];
  class FakeImage {
    src = '';
    decoding = '';
    decode() {
      made.push({ src: this.src, decoding: this.decoding });
      return Promise.resolve();
    }
  }
  class FailingImage {
    src = '';
    decoding = '';
    decode() {
      return Promise.reject(new Error('EncodingError'));
    }
  }
  vi.stubGlobal('Image', FakeImage);
  afterEach(() => {
    made.length = 0;
  });

  test('sync は保持集合を渡された通りにする＝新規は decode、離れたものは手放す', () => {
    const p = P.createNeighborPreloader();
    p.sync(['a', 'b']);
    expect(p.held()).toEqual(['a', 'b']);
    expect(made.map((m) => m.src)).toEqual(['a', 'b']);
    expect(made.every((m) => m.decoding === 'async')).toBe(true);

    // The shape after advancing by one. The one that's still held isn't recreated (avoids redoing the decode)
    p.sync(['c', 'a']);
    expect(p.held().sort()).toEqual(['a', 'c']);
    expect(made).toHaveLength(3);
    expect(made[2]?.src).toBe('c');
  });

  test('保持数は渡された枚数を超えない＝連続移動でも積み上がらない', () => {
    const p = P.createNeighborPreloader();
    for (let k = 0; k < 30; k++) p.sync([`n${k}`, `n${k + 1}`]);
    expect(p.held()).toHaveLength(2);
  });

  test('clear で全部手放す（タブを閉じたとき）', () => {
    const p = P.createNeighborPreloader();
    p.sync(['a', 'b']);
    p.clear();
    expect(p.held()).toEqual([]);
  });

  test('decode() の失敗は握りつぶす＝欠けた隣は未処理の Promise 拒否にしない', async () => {
    vi.stubGlobal('Image', FailingImage);
    const p = P.createNeighborPreloader();
    expect(() => p.sync(['gone'])).not.toThrow();
    await Promise.resolve();
    expect(p.held()).toEqual(['gone']);
    vi.stubGlobal('Image', FakeImage);
  });
});

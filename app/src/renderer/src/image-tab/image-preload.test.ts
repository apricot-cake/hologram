// image-tab/preload.ts のロジックの単体テスト（#241 隣接の先読み）。
//
// ここで固定するのは、機械的に押さえられる2つの受け入れ条件。①先読みの対象は「隣接」に
// 限る（＝ページ数の多いタブでもメモリが際限なく増えず、保持する枚数の上限は半径だけで
// 決まる）②画像でないもの（動画・うごイラのアーカイブ）は先読みの対象にしない。
// 本当に速く感じるか（fetch が実際に温まっているか）は実機の Electron で測る
// 領分＝ここでは扱わない。
//
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as P from './preload';

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
    // 100ページあっても保持数は半径だけで決まる（際限なく増えないという受け入れ条件）
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
  const made: Array<{ rel: string; as: string; href: string; removed: boolean; remove(): void }> = [];
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
      rel: '',
      as: '',
      href: '',
      removed: false,
      remove() {
        this.removed = true;
      },
    })),
    head: { append: vi.fn((link) => made.push(link)) },
  });
  afterEach(() => {
    made.length = 0;
  });

  test('sync は保持集合を渡された通りにする＝新規は取得だけ予約し、離れたものは手放す', () => {
    const p = P.createNeighborPreloader();
    p.sync(['a', 'b']);
    expect(p.held()).toEqual(['a', 'b']);
    expect(made.map((m) => m.href)).toEqual(['a', 'b']);
    expect(made.every((m) => m.rel === 'preload' && m.as === 'image')).toBe(true);

    // 1枚進んだ後の形。持ち続けているものは作り直さない。
    p.sync(['c', 'a']);
    expect(p.held().sort()).toEqual(['a', 'c']);
    expect(made).toHaveLength(3);
    expect(made[2]?.href).toBe('c');
    expect(made[1]?.removed).toBe(true);
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
    expect(made.every((m) => m.removed)).toBe(true);
  });
});

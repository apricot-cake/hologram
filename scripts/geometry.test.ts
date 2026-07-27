// geometry.ts のロジック単体テスト。列数計算（colsFor/sizeFor/minColsFor）・
// スライダートラック導出（sliderTrack/trackCols＝反転規約）・サムネ幅の60px量子化
// （thumbW）を検証する。旧 viewer.js の pColsFor/tileColsFor（重複実装）が単一所有へ
// 統合されたスライスの回帰ガード。

import { describe, expect, test } from 'vitest';
import * as G from '../app/src/renderer/src/services/geometry';

const m = { W: 1000, g: 14 }; // card-ish gutter

describe('colsFor / sizeFor: auto-fill minmax の列数式と往復整合', () => {
  test('1000px/gap14 に size200 は 4列', () => {
    expect(G.colsFor(200, m)).toBe(4);
  });

  test('ちょうど収まる境界（size239.5→floor）', () => {
    expect(G.colsFor(239, m)).toBe(4);
  });

  test('巨大 size でも最低1列', () => {
    expect(G.colsFor(5000, m)).toBe(1);
  });

  test('sizeFor: 4列の exact-fit は 239px', () => {
    expect(G.sizeFor(4, m)).toBe(239);
  });

  test('sizeFor: 1列はコンテナ幅そのまま', () => {
    expect(G.sizeFor(1, m)).toBe(1000);
  });

  // sizeFor の結果を colsFor に戻すと同じ列数（floor 同士で安定）
  test.each([1, 2, 3, 5, 8])('往復整合: %i列 → sizeFor → colsFor', (n) => {
    expect(G.colsFor(G.sizeFor(n, m), m)).toBe(n);
  });
});

// 「size≤max のまま置ける最少列数」は ceil（floor だと max 超えの notch を提示して
// しまう＝旧コメントの回帰ポイント）
describe('minColsFor', () => {
  test('max340 なら 1000px は最少3列', () => {
    expect(G.minColsFor(340, m)).toBe(3);
  });

  test('sizeFor(その列数) は max 以下', () => {
    expect(G.sizeFor(G.minColsFor(340, m), m)).toBeLessThanOrEqual(340);
  });

  test('1列足りる巨大 max は 1', () => {
    expect(G.minColsFor(2000, m)).toBe(1);
  });
});

describe('sliderTrack: nBig..nSmall のレンジ・現在値の clamp・反転規約', () => {
  test('poster card 相当（min150 max340）のトラック', () => {
    const tr = G.sliderTrack({ min: 150, max: 340, size: 200 }, m);
    expect(tr.nBig).toBe(3); // max340
    expect(tr.nSmall).toBe(6); // min150
    expect(tr.single).toBe(false);
    expect(tr.value).toBe(5); // size200 → 4列 → 3+6-4（右=大きいの反転）
    // trackCols は自己逆写像: value から列数へ戻る
    expect(G.trackCols(tr.value, tr.nBig, tr.nSmall)).toBe(4);
  });

  test('現在 size がレンジ外（min 未満まで縮んだ保存値）でも value は端に clamp', () => {
    const tr = G.sliderTrack({ min: 150, max: 340, size: 40 }, m);
    expect(tr.value).toBe(tr.nBig); // 最多列 = 反転で最小値
  });

  test('minCols=1（card ビューの「常に1列を許す」）が nBig の下限を上書き', () => {
    const tr = G.sliderTrack({ min: 240, max: 340, size: 280 }, m, { minCols: 1 });
    expect(tr.nBig).toBe(1);
    expect(tr.nSmall).toBe(G.colsFor(240, m)); // nSmall は min 由来のまま
  });

  test('幅が狭く1択しかない → single=true（呼び出し側がスライダー行を隠す契約）', () => {
    const narrow = { W: 200, g: 10 };
    const tr = G.sliderTrack({ min: 150, max: 340, size: 200 }, narrow);
    expect(tr.single).toBe(true);
    expect(tr.nBig).toBe(tr.nSmall);
  });
});

describe('thumbW: 60px バケット量子化＋clamp（asset キャッシュキーの断片化防止）', () => {
  test('60の倍数へ切り上げ', () => {
    expect(G.thumbW(252, 180, 960)).toBe(300);
  });

  test('ちょうど倍数はそのまま', () => {
    expect(G.thumbW(300, 180, 960)).toBe(300);
  });

  test('min clamp', () => {
    expect(G.thumbW(10, 180, 960)).toBe(180);
  });

  test('max clamp', () => {
    expect(G.thumbW(5000, 180, 960)).toBe(960);
  });

  // 旧 viewer.js 実装（Math.min(960, Math.max(180, Math.ceil((s*1.4)/60)*60))）との
  // バイト等価性: 代表値でパリティ確認（tile 既定180・端点）。#141 で tileThumbW の
  // 下限だけ 180→120 へ下がったので、パリティは「下限に当たらない範囲」の式の話。
  test.each([120, 180, 300, 420, 900])('旧 tileThumbW とパリティ (size=%i)', (s) => {
    const legacy = Math.min(960, Math.max(180, Math.ceil((s * 1.4) / 60) * 60));
    expect(G.thumbW(s * 1.4, 180, 960)).toBe(legacy);
  });
});

// #141 で tile の下限を 120→48 へ広げた分の退化ガード
describe('俯瞰ズーム', () => {
  const wide = { W: 1280, g: 8 };

  // 下限48でもトラックは列数レンジとして成立する（single にならず、最小側の notch が
  // 本当に極小タイルへ届く）
  test('min48 でトラックが single にならない', () => {
    expect(G.sliderTrack({ min: 48, max: 400, size: 180 }, wide).single).toBe(false);
  });

  test('最多列は min48 由来', () => {
    expect(G.sliderTrack({ min: 48, max: 400, size: 180 }, wide).nSmall).toBe(G.colsFor(48, wide));
  });

  // 反転トラックの左端（value=nBig）＝最多列。1280px/gap8 で23列＝縦17行なら
  // 1画面 約390枚で「全量を視覚走査」が成立する。
  test('最小 notch は20列以上（1画面 数百枚）', () => {
    const tr = G.sliderTrack({ min: 48, max: 400, size: 180 }, wide);
    expect(G.trackCols(tr.nBig, tr.nBig, tr.nSmall)).toBeGreaterThanOrEqual(20);
  });

  // 端の notch まで往復しても size が退化しない（clamp で潰れると1列に落ちる）
  test('最小 notch の exact-fit が 48〜96px に収まる', () => {
    const tr = G.sliderTrack({ min: 48, max: 400, size: 180 }, wide);
    const smallest = G.sizeFor(G.trackCols(tr.nBig, tr.nBig, tr.nSmall), wide);
    expect(smallest).toBeGreaterThanOrEqual(48);
    expect(smallest).toBeLessThan(96);
  });

  // サムネ下限は 120（48*1.4≈67 を 60px バケットで丸めた値）。thumbnailer は 64px
  // から配信するので main 側は無改修。
  test('tileThumbW 下限は120', () => {
    expect(G.thumbW(48 * 1.4, 120, 960)).toBe(120);
  });

  test('既定サイズ180のバケットは不変（300）', () => {
    expect(G.thumbW(180 * 1.4, 120, 960)).toBe(300);
  });
});

// websearch のエンジン（#207）のプロパティテスト。dialect の scripts/check-props.ts の考え方を
// 移した（fast-check・「意地悪な文字列」のプール・固定シード・例外を投げないこととエンコードの
// 漏れの検査）。一字一句の移植ではない＝凍結したリポジトリがこのマシンから見えないため
// （types.ts の確度の注記を参照）。見ているのは2つ。どのプラットフォームのモジュールでも
// build() が幅広い入力で例外を投げないこと（引用符・アンパサンド・Unicode・空文字といった
// 敵対的な文字列を含む）。そして URL を返したときは、その URL が実際にパースでき、かつ語の
// 中身がクエリ文字列から往復して取り出せること（エンコードで元へ戻せない形に潰されていない）。
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { emptyPlatformQueryState, type PlatformQueryState } from '../app/src/renderer/src/websearch/types';
import { ALL_PLATFORMS } from '../app/src/renderer/src/websearch/platforms/index';

// わざと「意地悪」にした文字列のプール。引用符・アンパサンド・CJK・絵文字・空白・制御文字に
// 近い記号。Issue の設計コメント（「意地悪文字列プール」）のとおり、dialect のハーネスが使った
// のと同じ種類の敵対的な入力。
const meanString = fc.oneof(fc.constant(''), fc.constant('a"b'), fc.constant('a&b=c'), fc.constant('猫 の 絵'), fc.constant('🐈🔥'), fc.constant('  spaced  '), fc.constant('#already-hash'), fc.string({ maxLength: 24 }));
const meanArray = (max: number) => fc.array(meanString, { maxLength: max });

const arbState: fc.Arbitrary<PlatformQueryState> = fc.record({
  terms: meanArray(3),
  keywordsOr: meanArray(3),
  exclude: meanArray(2),
  hashtag: meanArray(3),
  hashtagOr: meanArray(2),
  excludeHashtag: meanArray(2),
  fromUser: fc.option(meanString, { nil: null }),
  excludeUser: meanArray(2),
  since: fc.option(fc.constant('2026-01-01'), { nil: null }),
  until: fc.option(fc.constant('2026-06-30'), { nil: null }),
  mediaOnly: fc.boolean(),
  videoOnly: fc.boolean(),
  excludeReplies: fc.boolean(),
  repliesOnly: fc.boolean(),
  minLikes: fc.option(fc.integer({ min: 1, max: 200000 }), { nil: null }),
  minReposts: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
  minReplies: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: null }),
});

const SEED = 20260802; // 固定。dialect のシードを決めた実行と同じ考え方

describe('websearch のプラットフォームのプロパティテスト（例外を投げない / URL の形が正しい）', () => {
  for (const platform of ALL_PLATFORMS) {
    test(`${platform.id}: build() は例外を投げず、返した url は必ずパースできる`, () => {
      fc.assert(
        fc.property(arbState, (state) => {
          const r = platform.build(state, { instanceHost: 'example.test' });
          if (r.url != null) {
            expect(() => new URL(r.url as string)).not.toThrow();
            // 生の空白や改行が URL の文字列そのものへ残ることは一切ない＝dialect の
            // ハーネスが見ていた「エンコードの漏れ」そのもの。
            expect(/[\s]/.test(r.url)).toBe(false);
          }
        }),
        { seed: SEED, numRuns: 200 },
      );
    });
  }

  test('全部が空の状態では、どのプラットフォームも URL を作らない', () => {
    for (const platform of ALL_PLATFORMS) {
      const r = platform.build(emptyPlatformQueryState(), { instanceHost: 'example.test' });
      expect(r.url).toBeNull();
    }
  });

  test('語を1つ渡すと、組み立てたクエリ文字列との間で往復する（一番作りの厚いプラットフォームの X で見る）', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }).filter((s) => /^[a-zA-Z0-9]+$/.test(s)),
        (term) => {
          const xPlatform = ALL_PLATFORMS.find((p) => p.id === 'x');
          if (!xPlatform) throw new Error('x platform missing from ALL_PLATFORMS');
          const state = { ...emptyPlatformQueryState(), terms: [term] };
          const r = xPlatform.build(state, {});
          expect(r.url).not.toBeNull();
          const q = new URL(r.url as string).searchParams.get('q');
          expect(q).not.toBeNull();
          expect(decodeURIComponent((q as string).replace(/\+/g, ' '))).toContain(term);
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
  });
});

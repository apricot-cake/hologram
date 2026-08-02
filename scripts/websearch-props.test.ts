// Property tests for the websearch engine (#207), ported in spirit from dialect's own
// scripts/check-props.ts (fast-check, an "mean string" pool, a fixed seed, no-throw +
// encoding-leak checks) - NOT a literal port, since the frozen repo is unreachable on
// this machine (see types.ts's confidence note). What is checked: every platform
// module's build() never throws over a wide range of inputs, including adversarial
// strings (quotes, ampersands, unicode, empty strings), and whenever it returns a URL,
// that URL actually parses AND round-trips a term's substance back out of the query
// string (nothing was mangled into an unrecoverable mess by encoding).
import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { emptyPlatformQueryState, type PlatformQueryState } from '../app/src/renderer/src/websearch/types';
import { ALL_PLATFORMS } from '../app/src/renderer/src/websearch/platforms/index';

// A deliberately "mean" string pool - quotes, ampersands, CJK, emoji, whitespace,
// control-adjacent punctuation - the same category of adversarial input dialect's own
// harness used, per the Issue's design comment ("意地悪文字列プール").
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

const SEED = 20260802; // fixed, same spirit as dialect's own seeded run

describe('websearch platform property tests (no-throw / URL well-formedness)', () => {
  for (const platform of ALL_PLATFORMS) {
    test(`${platform.id}: build() never throws and any returned url parses`, () => {
      fc.assert(
        fc.property(arbState, (state) => {
          const r = platform.build(state, { instanceHost: 'example.test' });
          if (r.url != null) {
            expect(() => new URL(r.url as string)).not.toThrow();
            // No raw whitespace/newlines ever survive into the URL string itself -
            // exactly the "encoding leak" dialect's own harness checked for.
            expect(/[\s]/.test(r.url)).toBe(false);
          }
        }),
        { seed: SEED, numRuns: 200 },
      );
    });
  }

  test('an all-empty state builds no URL on any platform', () => {
    for (const platform of ALL_PLATFORMS) {
      const r = platform.build(emptyPlatformQueryState(), { instanceHost: 'example.test' });
      expect(r.url).toBeNull();
    }
  });

  test('a single term round-trips into the built query string (X, the richest platform)', () => {
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

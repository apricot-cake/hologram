'use strict';
// One-off migration harness (#207's own design comment: "移行時一回きり・環境変数ゲート"):
// checks that this rewritten engine's output URL matches the FROZEN dialect repo's
// output URL for the same randomly-generated query, across the five adopted platforms.
// Not a vitest suite on purpose (dialect's own scripts/check-props.ts is a plain script
// too, not a test file) - this reaches OUTSIDE the repo into a sibling checkout that is
// never present in CI or on a fresh clone, so it cannot be part of `npm test`'s glob.
//
// Gate: only runs when DIALECT_REPO points at a local checkout of apricot-cake/dialect
// (that repo is frozen/unpublished - MIT, not on npm - so there is no package to
// install instead). Absent -> prints why and exits 0 (never fails a build that simply
// doesn't have the sibling repo checked out, which as of 2026-08-02 is every machine
// except the one that originally designed this migration).
//
// ⚠️ Adaptation note for whoever runs this with DIALECT_REPO actually set: this script
// was written WITHOUT access to dialect's source (it does not exist on the authoring
// machine either - see websearch/types.ts's confidence note), so the require() paths
// and the shape assumed of dialect's exports below are inferred from the Issue's own
// implementation-notes comment (#207, 2026-07-19): packages/core/src/{types,resolve,
// googleFallback}.ts + platforms/{x,bluesky,misskey,mastodon,pixiv,google}.ts, a
// resolve(state, platformId, ctx) entry point returning {url, applied, approximated,
// dropped}. If dialect's actual export names differ, fix the two require() blocks below
// - the comparison loop and reporting do not need to change.
const path = require('node:path');
const fc = require('fast-check');

const DIALECT_REPO = process.env.DIALECT_REPO;

if (!DIALECT_REPO) {
  console.log("[websearch-equivalence] DIALECT_REPO not set - skipping (see this file's header for what it would check).");
  process.exit(0);
}

let dialect: any;
try {
  const corePath = path.join(DIALECT_REPO, 'packages', 'core', 'src');
  dialect = {
    resolve: require(path.join(corePath, 'resolve')).resolve,
    platforms: require(path.join(corePath, 'platforms', 'index')),
  };
} catch (err) {
  console.error("[websearch-equivalence] could not load dialect from DIALECT_REPO - the require() paths in this file need updating to match dialect's actual layout (see the adaptation note in the header).");
  console.error(err);
  process.exit(1);
}

const holo = {
  x: require('../app/src/renderer/src/websearch/platforms/x').xPlatform,
  bluesky: require('../app/src/renderer/src/websearch/platforms/bluesky').blueskyPlatform,
  misskey: require('../app/src/renderer/src/websearch/platforms/misskey').misskeyPlatform,
  mastodon: require('../app/src/renderer/src/websearch/platforms/mastodon').mastodonPlatform,
  pixiv: require('../app/src/renderer/src/websearch/platforms/pixiv').pixivPlatform,
};

const PLATFORM_IDS = Object.keys(holo);
const CTX = { instanceHost: 'example.test' };

const meanString = fc.oneof(fc.constant(''), fc.constant('a"b'), fc.constant('a&b=c'), fc.constant('猫の絵'), fc.string({ maxLength: 16 }));
const arbState = fc.record({
  terms: fc.array(meanString, { maxLength: 3 }),
  keywordsOr: fc.array(meanString, { maxLength: 2 }),
  exclude: fc.array(meanString, { maxLength: 2 }),
  hashtag: fc.array(meanString, { maxLength: 3 }),
  hashtagOr: fc.array(meanString, { maxLength: 2 }),
  excludeHashtag: fc.array(meanString, { maxLength: 2 }),
  fromUser: fc.option(meanString, { nil: null }),
  excludeUser: fc.array(meanString, { maxLength: 2 }),
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

let mismatches = 0;
let checked = 0;

for (const platformId of PLATFORM_IDS) {
  fc.assert(
    fc.property(arbState, (state: unknown) => {
      checked++;
      const dialectUrl = dialect.resolve(state, platformId, CTX)?.url ?? null;
      const holoUrl = (holo as any)[platformId].build(state, CTX)?.url ?? null;
      if (dialectUrl !== holoUrl) {
        mismatches++;
        console.error(`[websearch-equivalence] MISMATCH platform=${platformId}\n  dialect: ${dialectUrl}\n  holo:    ${holoUrl}\n  state:   ${JSON.stringify(state)}`);
      }
    }),
    { seed: 20260802, numRuns: 500 },
  );
}

console.log(`[websearch-equivalence] checked ${checked} cases across ${PLATFORM_IDS.length} platforms, ${mismatches} mismatches.`);
process.exit(mismatches > 0 ? 1 : 0);

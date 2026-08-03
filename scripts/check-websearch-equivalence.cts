'use strict';
// One-off migration harness (#207's own design comment: "移行時一回きり・環境変数ゲート"):
// checks that this rewritten engine's output URL matches the FROZEN dialect repo's
// output URL for the same randomly-generated query, across the five adopted platforms.
// Not a vitest suite on purpose (dialect's own scripts/check-props.ts is a plain script
// too, not a test file) - this reaches OUTSIDE the repo into a sibling checkout that is
// never present in CI or on a fresh clone, so it cannot be part of `npm test`'s glob.
//
// Gate: only runs when DIALECT_REPO points at a local checkout of apricot-cake/dialect
// (that repo is frozen/unpublished - MIT, not on npm - so there is no package to install
// instead). Absent -> prints why and exits 0 (never fails a build that simply doesn't
// have the sibling repo checked out). See docs/build.md or the Issue this harness
// belongs to (#822) for how to set one up.
//
// dialect's own package (packages/core) is ESM TypeScript with .js-extension import
// specifiers pointing at .ts source (a bundler/tsx convention) - plain `node` cannot
// resolve that without a build step, so this harness requires dialect's own compiled
// dist/index.js (built via `npm run build -w @apricot-cake/dialect-core` inside
// DIALECT_REPO), not its source tree. It also requires dialect's own devDependencies
// (`npm install` inside DIALECT_REPO) to build.
const path = require('node:path');

const DIALECT_REPO = process.env.DIALECT_REPO;

if (!DIALECT_REPO) {
  console.log("[websearch-equivalence] DIALECT_REPO not set - skipping (see this file's header for what it would check).");
  process.exit(0);
}

let dialect: any;
try {
  const distIndex = path.join(DIALECT_REPO, 'packages', 'core', 'dist', 'index.js');
  dialect = require(distIndex);
  if (typeof dialect.resolve !== 'function' || !Array.isArray(dialect.PLATFORMS)) {
    throw new Error("dist/index.js loaded but does not export resolve()/PLATFORMS - dialect's public API may have changed shape.");
  }
} catch (err) {
  console.error("[websearch-equivalence] could not load dialect's built package from DIALECT_REPO.");
  console.error('Run inside DIALECT_REPO first: npm install && npm run build -w @apricot-cake/dialect-core');
  console.error(err);
  process.exit(1);
}

const holo = {
  x: require('../app/src/renderer/src/websearch/platforms/x.ts').xPlatform,
  bluesky: require('../app/src/renderer/src/websearch/platforms/bluesky.ts').blueskyPlatform,
  misskey: require('../app/src/renderer/src/websearch/platforms/misskey.ts').misskeyPlatform,
  mastodon: require('../app/src/renderer/src/websearch/platforms/mastodon.ts').mastodonPlatform,
  pixiv: require('../app/src/renderer/src/websearch/platforms/pixiv.ts').pixivPlatform,
};
const holoText = require('../app/src/renderer/src/websearch/text.ts');

const fc = require('fast-check');

const PLATFORM_IDS = Object.keys(holo);
const CTX = { instanceHost: 'example.test' };

function dialectPlatform(id: string) {
  const p = dialect.PLATFORMS.find((x: any) => x.id === id);
  if (!p) throw new Error(`dialect has no PLATFORMS entry for "${id}" - has dialect dropped/renamed this platform?`);
  return p;
}

// Whitespace is fine here - Hologram's own `terms` field maps 1:1 to dialect's own
// `terms` array (neither side ever splits a terms[] entry on whitespace - see
// dialect's text.ts andTerms, which trims but does not split).
const meanFreeString = fc.oneof(fc.constant(''), fc.constant('a"b'), fc.constant('a&b=c'), fc.constant('猫の絵'), fc.constant('(a OR b)'), fc.constant('  spaced words  '), fc.string({ maxLength: 16 }));

// No whitespace: every OTHER field maps a Hologram array to one of dialect's
// space-joined flat strings (hashtag/hashtagOr/excludeHashtag/exclude/keywordsOr/
// excludeUser) or a single flat string (fromUser) - an entry containing internal
// whitespace would silently re-split into multiple dialect-side words, breaking the
// array<->string round-trip this harness relies on to build a fair comparison.
//
// Also excludes non-empty strings that reduce to nothing once cleaned (e.g. a hashtag
// entry that is just "#", a fromUser that is just ")"): dialect's words()+stripHash/
// stripAt pipeline filters emptiness ONCE (on the whole joined string, before the
// per-element hash/@/quote/paren removal) and never re-filters after that per-element
// strip, so an entry that reduces to nothing ONLY via the second pass still leaves a
// stray empty token/param in dialect's own output (e.g. a bare "#" token, or an empty
// "&author="). That looks like an implementation-order artifact, not a measured design
// decision (nothing in dialect's comments discusses it) - a literal "#" hashtag or ")"
// author has no real-world meaning either way, and Hologram's stricter behavior
// (dropping the leaf entirely once it turns out empty after cleaning) is the more
// defensible of the two, so this harness does not chase byte-parity on it.
function reducesToNothingWhenCleaned(s: string): boolean {
  return s.length > 0 && holoText.stripAt(holoText.stripHash(s)) === '';
}
const meanTokenString = fc.oneof(fc.constant(''), fc.constant('a"b'), fc.constant('a&b=c'), fc.constant('猫の絵'), fc.constant('(a)'), fc.constant('#already-hash'), fc.constant('@already-at'), fc.string({ maxLength: 16 })).filter((s: string) => !/[\s　]/.test(s) && !reducesToNothingWhenCleaned(s));

const arbSeed = fc.record({
  terms: fc.array(meanFreeString, { maxLength: 3 }),
  keywordsOr: fc.array(meanTokenString, { maxLength: 2 }),
  exclude: fc.array(meanTokenString, { maxLength: 2 }),
  hashtag: fc.array(meanTokenString, { maxLength: 3 }),
  hashtagOr: fc.array(meanTokenString, { maxLength: 2 }),
  excludeHashtag: fc.array(meanTokenString, { maxLength: 2 }),
  fromUser: fc.option(meanTokenString, { nil: null }),
  excludeUser: fc.array(meanTokenString, { maxLength: 2 }),
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

// Hologram-only extensions with no dialect concept to check against (documented in each
// platform module's header comment + the Issue) - zeroed per-platform before building
// BOTH sides' state, so the comparison stays honest: it verifies every concept dialect
// also models translates identically, and leaves the extensions to Hologram's own unit/
// property test suites (websearch-platforms.test.ts / websearch-props.test.ts).
function seedForPlatform(seed: any, platformId: string) {
  const s = { ...seed };
  if (platformId === 'x') {
    // videoOnly/repliesOnly: dialect scopes both to Bluesky only. hashtagOr: dialect
    // scopes it to Bluesky only too (X's own OR-group support is keywordsOr only).
    // excludeHashtag: dialect's X module has no such concept either (only a flat
    // exclude(-word), no distinct "excluded hashtag" operator).
    s.videoOnly = false;
    s.repliesOnly = false;
    s.hashtagOr = [];
    s.excludeHashtag = [];
  } else if (platformId === 'mastodon') {
    // videoOnly: dialect has no such concept for Mastodon (only mediaOnly).
    s.videoOnly = false;
  } else if (platformId === 'pixiv') {
    // fromUser: dialect's pixiv module never reads a fromUser concept at all.
    // excludeHashtag: dialect's pixiv module never reads it either (folds into exclude
    // on Hologram's side instead, since the underlying operator is identical).
    // minLikes: dialect has no numeric-likes-floor concept for pixiv (only the
    // UI-chosen pixivPopular selector, which Hologram does not expose at all).
    s.fromUser = null;
    s.excludeHashtag = [];
    s.minLikes = null;
  }
  return s;
}

function toDialectState(seed: any, platformId: string) {
  const s = dialect.defaultState();
  s.terms = seed.terms;
  s.keywordsOr = seed.keywordsOr.join(' ');
  s.exclude = seed.exclude.join(' ');
  s.fromUser = seed.fromUser ?? '';
  s.excludeUser = seed.excludeUser.join(' ');
  s.hashtag = seed.hashtag.join(' ');
  s.hashtagOr = seed.hashtagOr.join(' ');
  s.excludeHashtag = seed.excludeHashtag.join(' ');
  s.since = seed.since ?? '';
  s.until = seed.until ?? '';
  s.mediaOnly = seed.mediaOnly;
  s.videoOnly = seed.videoOnly;
  s.excludeReplies = seed.excludeReplies;
  s.repliesOnly = seed.repliesOnly;
  s.minLikes = seed.minLikes != null ? String(seed.minLikes) : '';
  s.minReposts = seed.minReposts != null ? String(seed.minReposts) : '';
  s.minReplies = seed.minReplies != null ? String(seed.minReplies) : '';
  // X has no user-facing sort concept and always requests newest-first (f=live) - set
  // dialect's own sort to match, so the rest of the URL is a fair comparison instead of
  // failing on this one deliberate, documented divergence (see x.ts's own comment).
  if (platformId === 'x') s.sort = 'new';
  return s;
}

function toHoloState(seed: any) {
  return { ...seed };
}

// src=typed_query is a harmless X UI-origin marker Hologram adds and dialect does not
// (see x.ts's comment) - stripped before comparing, the one other deliberate,
// documented divergence besides the sort-forcing above.
function normalizeHoloUrl(platformId: string, url: string | null): string | null {
  if (url == null) return null;
  if (platformId === 'x') return url.replace('&src=typed_query', '');
  return url;
}

let checked = 0;
let mismatches = 0;
const mismatchSamples: string[] = [];
const mismatchCountByPlatform: Record<string, number> = {};

for (const platformId of PLATFORM_IDS) {
  const dPlatform = dialectPlatform(platformId);
  const hPlatform = (holo as any)[platformId];
  fc.assert(
    fc.property(arbSeed, (rawSeed: unknown) => {
      checked++;
      const seed = seedForPlatform(rawSeed, platformId);
      const dialectUrl = dialect.resolve(dPlatform, toDialectState(seed, platformId), CTX)?.url ?? null;
      const holoUrl = normalizeHoloUrl(platformId, hPlatform.build(toHoloState(seed), CTX)?.url ?? null);
      if (dialectUrl !== holoUrl) {
        mismatches++;
        mismatchCountByPlatform[platformId] = (mismatchCountByPlatform[platformId] ?? 0) + 1;
        if (mismatchSamples.length < 40) {
          mismatchSamples.push(`[websearch-equivalence] MISMATCH platform=${platformId}\n  dialect: ${dialectUrl}\n  holo:    ${holoUrl}\n  seed:    ${JSON.stringify(seed)}`);
        }
      }
    }),
    { seed: 20260802, numRuns: 1000 },
  );
}

for (const line of mismatchSamples) console.error(line);
console.log(`[websearch-equivalence] mismatches by platform: ${JSON.stringify(mismatchCountByPlatform)}`);
console.log(`[websearch-equivalence] checked ${checked} cases across ${PLATFORM_IDS.length} platforms, ${mismatches} mismatches.`);
process.exit(mismatches > 0 ? 1 : 0);

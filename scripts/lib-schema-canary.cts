'use strict';

// Pure core of the API schema canary (#191): turn a response body into a
// VALUE-FREE description of its structure, compare that description with the
// previous run, and decide what deserves an alarm.
//
// Why value-free: the canary's snapshots live in the repository, and a response
// body carries post text, display names and third-party fragments. A field-path
// → type tree carries none of that, so the baseline can be reviewed in a diff
// like any other source file. (The verbatim bodies belong in the acquisition
// originals layer instead — #292 / ADR 0011 — which is local-only.)
//
// No network, no filesystem: scripts/schema-canary.cts owns both, this module
// owns the judgement so it can be unit-tested without either.

// path → type union. The path is '' for the document root, 'a.b' for nested
// object keys, 'a[]' for array elements and 'a{}' for the values of an object
// used as a MAP (see isMapObject). Element/value shapes are merged, so a
// heterogeneous array or map shows up as a union.
type Shape = Record<string, string>;

// An array that happens to be empty says nothing about its elements. Recorded
// as its own pseudo-type rather than as an absent path, so an empty run is
// distinguishable from "the field is gone" — the difference between a false
// alarm every other run and a real one.
const UNKNOWN = 'unknown';
const TYPE_SEP = '|';

// Key format inside missingStreak. Chosen to be readable in the committed
// snapshot JSON (the file is meant to be reviewed by a human in a diff).
const STREAK_SEP = ' :: ';

// A field that disappears for ONE run is usually the platform's own A/B split
// or a conditional field, not a schema change. Two consecutive runs is the
// hysteresis #191 asked for; a reappearance resets the counter.
const MISSING_STREAK_ALARM = 2;

// Reserved path used when a whole endpoint stopped being requested (the fetch
// chain took a different branch). Not a real field path — '(' cannot start a
// JSON key path here because every real path starts with a key name.
const ENDPOINT_PATH = '(endpoint)';
const ENDPOINT_TYPE = 'present';

interface ShapeChange {
  path: string;
  types: string[];
}

interface ShapeDiff {
  // Present in the previous shape, absent (or narrowed) now.
  lost: ShapeChange[];
  // Absent before, present now.
  gained: ShapeChange[];
  // Paths whose comparison is impossible this run because an array was empty on
  // one side. Neither reported nor allowed to reset a streak.
  unobservable: string[];
}

interface StreakEntry {
  path: string;
  type: string;
  count: number;
}

interface StreakOutcome {
  streak: Record<string, number>;
  // Confirmed: seen missing for MISSING_STREAK_ALARM consecutive runs.
  alarms: StreakEntry[];
  // Missing once so far — reported quietly, not an alarm yet.
  pending: StreakEntry[];
}

// 'a.b' / 'a[]' / 'a{}' are under 'a'; 'ab' is not. Used to report only the
// topmost path of a subtree that appeared or vanished as a whole.
function isUnder(path: string, prefix: string): boolean {
  if (!prefix || path.length <= prefix.length || !path.startsWith(prefix)) return false;
  const next = path[prefix.length];
  return next === '.' || next === '[' || next === '{';
}

// An object whose KEYS are data rather than schema — pixiv's `userIllusts`
// (keyed by artwork id), Misskey's `reactions` (keyed by emoji). Walking those
// per key would put thousands of volatile paths in the snapshot and, worse,
// report a field as "disappeared" every time a key changed. Their values are
// merged under one '{}' path instead, which is what the schema actually says.
//
// The test is that NO key looks like a field name. It stays on the safe side:
// one ordinary-looking key (a legacy Misskey reaction name such as `like`)
// leaves the object treated as a record, which only costs noise — whereas
// collapsing a real record would cost the per-field watch that is the point.
const FIELD_NAME_KEY = /^[$A-Za-z_][$A-Za-z0-9_]*$/;
function isMapObject(keys: string[]): boolean {
  return keys.length > 0 && keys.every((key) => !FIELD_NAME_KEY.test(key));
}

function isUnderAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => isUnder(path, p));
}

// UNKNOWN is dropped as soon as any real type is known for the path: an empty
// array adds no information, so 'unknown|string' and 'string' are the same
// knowledge. Keeping only one of the two forms means the snapshot does not
// churn just because a sample's array was empty on one run.
function normalizeTypes(types: Iterable<string>): string[] {
  const set = new Set(types);
  if (set.size > 1) set.delete(UNKNOWN);
  return [...set].sort();
}

function typeSet(union: string | undefined): Set<string> {
  return new Set(union ? union.split(TYPE_SEP) : []);
}

function joinTypes(types: Iterable<string>): string {
  return normalizeTypes(types).join(TYPE_SEP);
}

function walk(value: unknown, path: string, acc: Record<string, Set<string>>): void {
  const add = (type: string) => {
    (acc[path] ||= new Set()).add(type);
  };
  if (value === null) {
    add('null');
    return;
  }
  if (Array.isArray(value)) {
    add('array');
    if (value.length === 0) {
      (acc[`${path}[]`] ||= new Set()).add(UNKNOWN);
      return;
    }
    for (const item of value) walk(item, `${path}[]`, acc);
    return;
  }
  if (typeof value === 'object') {
    add('object');
    const keys = Object.keys(value as object);
    // An empty object hides its contents exactly like an empty array does, and
    // is marked the same way so an empty run cannot read as "the fields left".
    if (keys.length === 0) {
      (acc[`${path}{}`] ||= new Set()).add(UNKNOWN);
      return;
    }
    if (isMapObject(keys)) {
      for (const key of keys) walk((value as Record<string, unknown>)[key], `${path}{}`, acc);
      return;
    }
    for (const key of keys) walk((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key, acc);
    return;
  }
  add(typeof value);
}

// Response body (already JSON.parse'd) → Shape. Key order is sorted so the
// committed snapshot only changes when the structure does.
function shapeOf(value: unknown): Shape {
  const acc: Record<string, Set<string>> = {};
  walk(value, '', acc);
  const out: Shape = {};
  for (const path of Object.keys(acc).sort()) out[path] = joinTypes(acc[path] as Set<string>);
  return out;
}

function sortShape(shape: Shape): Shape {
  const out: Shape = {};
  for (const path of Object.keys(shape).sort()) out[path] = shape[path] as string;
  return out;
}

// Compares two shapes. Reports the TOPMOST path of any subtree that vanished or
// appeared as a whole (a removed object would otherwise produce one line per
// descendant, burying the one line that matters).
function diffShapes(prev: Shape, next: Shape): ShapeDiff {
  // Sorted so a parent is always visited before its children (a parent path is
  // a strict prefix of every child path, so it sorts first).
  const paths = [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort();
  const lost: ShapeChange[] = [];
  const gained: ShapeChange[] = [];
  const unobservable: string[] = [];
  const vanished: string[] = [];
  const appeared: string[] = [];
  for (const path of paths) {
    if (isUnderAny(path, unobservable) || isUnderAny(path, vanished) || isUnderAny(path, appeared)) continue;
    const inPrev = path in prev;
    const inNext = path in next;
    const before = typeSet(prev[path]);
    const after = typeSet(next[path]);
    before.delete(UNKNOWN);
    after.delete(UNKNOWN);
    // The path exists on this side but every type it carried was UNKNOWN — an
    // empty array.
    const prevEmpty = inPrev && before.size === 0;
    const nextEmpty = inNext && after.size === 0;
    // Empty both times: a field that is simply always an empty list. Stable, so
    // nothing to report — otherwise every run would repeat the same line and
    // train the reader to skim past the ones that matter.
    if (prevEmpty && nextEmpty) continue;
    // Empty on exactly one side: whatever the other side knows cannot be
    // confirmed or refuted this run.
    if (prevEmpty || nextEmpty) {
      unobservable.push(path);
      continue;
    }
    if (!inNext) {
      vanished.push(path);
      lost.push({ path, types: normalizeTypes(before) });
      continue;
    }
    if (!inPrev) {
      appeared.push(path);
      gained.push({ path, types: normalizeTypes(after) });
      continue;
    }
    const missing = [...before].filter((t) => !after.has(t)).sort();
    const extra = [...after].filter((t) => !before.has(t)).sort();
    if (missing.length) lost.push({ path, types: missing });
    if (extra.length) gained.push({ path, types: extra });
  }
  return { lost, gained, unobservable };
}

function streakKey(path: string, type: string): string {
  return `${path}${STREAK_SEP}${type}`;
}

function streakPath(key: string): string {
  const at = key.indexOf(STREAK_SEP);
  return at < 0 ? key : key.slice(0, at);
}

// Advances the per-loss counters and splits this run's losses into confirmed
// alarms and still-pending suspicions.
//
// A confirmed loss leaves the counter map: the alarm has been delivered, and
// carryBaseline() then lets the new shape become the baseline. Repeating the
// same alarm every run afterwards would train the reader to ignore it.
function advanceStreak(prevStreak: Record<string, number>, diff: ShapeDiff, threshold = MISSING_STREAK_ALARM): StreakOutcome {
  const streak: Record<string, number> = {};
  const alarms: StreakEntry[] = [];
  const pending: StreakEntry[] = [];
  for (const change of diff.lost) {
    for (const type of change.types) {
      const key = streakKey(change.path, type);
      const count = (prevStreak[key] || 0) + 1;
      if (count >= threshold) {
        alarms.push({ path: change.path, type, count });
        continue;
      }
      streak[key] = count;
      pending.push({ path: change.path, type, count });
    }
  }
  // A counter whose path went unobservable is HELD, not reset: an empty array
  // is not evidence that a suspected field came back.
  for (const [key, count] of Object.entries(prevStreak)) {
    if (key in streak) continue;
    const path = streakPath(key);
    if (diff.unobservable.includes(path) || isUnderAny(path, diff.unobservable)) streak[key] = count;
  }
  return { streak, alarms, pending };
}

// Builds the shape to store for the next run. Normally that is simply what was
// observed — except for the two cases where accepting the observation would
// destroy the canary's own memory:
//
//   - a path under suspicion (lost, not yet confirmed) keeps its old entry, or
//     the second run would see nothing missing and the streak could never reach
//     the threshold;
//   - an unobservable path (empty array) keeps its old entry, or one empty run
//     would erase every element path from the baseline for good.
function carryBaseline(prev: Shape, next: Shape, diff: ShapeDiff, pending: StreakEntry[]): Shape {
  const keep = [...new Set([...diff.unobservable, ...pending.map((p) => p.path)])];
  const out: Shape = { ...next };
  for (const path of Object.keys(prev)) {
    if (!keep.includes(path) && !isUnderAny(path, keep)) continue;
    out[path] = joinTypes([...typeSet(prev[path]), ...typeSet(next[path])]);
  }
  return sortShape(out);
}

// An endpoint the fetch chain no longer requests at all. Expressed as an
// ordinary loss so it rides the same hysteresis as a field.
function endpointMissingDiff(): ShapeDiff {
  return { lost: [{ path: ENDPOINT_PATH, types: [ENDPOINT_TYPE] }], gained: [], unobservable: [] };
}

function isEndpointEntry(entry: { path: string }): boolean {
  return entry.path === ENDPOINT_PATH;
}

function labelPath(path: string): string {
  return path === '' ? '(root)' : path;
}

// --- which post to observe (#464) ----------------------------------------
//
// A sample is a LIST of candidate posts, not one post. Any single public post is
// mortal, and replacing a dead one by hand is exactly the recurring maintenance
// the canary exists to avoid. With candidates, one death is absorbed in silence
// and only the last one has to ask for a human.

// The order candidates are tried in. The URL that produced the stored baseline
// goes FIRST even when it is not first in the list.
//
// Stickiness is the point: a candidate that failed once (an outage, a rate
// limit, a moment of moderation) must not make the canary walk back and forth
// between two posts, because every walk costs a run — the baseline belongs to
// one post, so switching rebuilds it and that run compares nothing.
function candidateOrder(urls: string[], previous?: string): string[] {
  if (!previous || !urls.includes(previous)) return [...urls];
  return [previous, ...urls.filter((url) => url !== previous)];
}

// A stored baseline describes ONE post. Comparing it against a DIFFERENT post
// reports the two posts' differences — the optional fields one carries and the
// other does not — as schema movement. That is a false alarm, and it was
// reachable before candidates existed: swapping a sample's URL by hand made the
// following runs alarm on fields that had never disappeared.
//
// So a baseline is owned by the URL it was observed from, and a change of source
// discards it. The run that switches records a fresh baseline and reports
// nothing, exactly like the first run of a brand new sample.
interface SourcedSnapshot {
  shapes: Record<string, unknown>;
  missingStreak: Record<string, unknown>;
  sources: Record<string, string>;
}
function rebaseOnSourceChange(snap: SourcedSnapshot, label: string, url: string): boolean {
  const stored = snap.sources[label];
  snap.sources[label] = url;
  if (!stored || stored === url) return false;
  delete snap.shapes[label];
  delete snap.missingStreak[label];
  return true;
}

// --- what a sample declares it expects to see (#588) ----------------------
//
// Almost every sample expects a post. One kind does not: X answers a deleted,
// locked or age-restricted post with a TOMBSTONE — the post exists, its body is
// withheld, and the reason is carried as wording in tombstone.text.text.
// Hologram reads that wording to tell the three causes apart, and since #505 the
// ABSENCE of wording is itself the age-restricted verdict. So both the wording
// and its absence are dependencies exactly like a field, and deserve the same
// watch.
//
// They could not be watched before. A response the extractor refused to build a
// record from was read, unconditionally, as "this sample is gone — a human must
// find another one", which put a tombstone in the same box as a deleted sample:
// registering one would have reported it as an outage on every run, forever,
// while never once recording its shape.
//
// A sample that DECLARES a tombstone inverts that reading. The refusal is the
// expected answer, so the body goes on to the shape comparison, and the
// CONTRADICTION becomes the alarm instead: a normal post where a tombstone was
// declared means the lock was lifted, the age gate removed, or the id no longer
// means what the sample says it means.
const EXPECT_TOMBSTONE = 'tombstone';

interface ResponseFacts {
  // The endpoint whose body IS the post answered with parseable JSON.
  primaryParsed: boolean;
  // Why the extractor refused to build a record from that body; '' when it did.
  metaError: string;
  // Something only a real post body can carry came back.
  alive: boolean;
}
interface Verdict {
  // Nothing can be observed from this candidate. Not a schema signal: the next
  // candidate is tried, and if they all say this a human has to add one.
  dead: boolean;
  reason: string;
  // The sample answered, but with something its declaration rules out. Not
  // "dead" — nothing needs replacing, the answer itself is the news.
  alarm: string;
}

function judgeResponse(expect: string | undefined, facts: ResponseFacts): Verdict {
  if (expect === EXPECT_TOMBSTONE) {
    if (facts.alive) {
      return { dead: false, reason: '', alarm: 'tombstone が期待値のサンプルが通常の投稿として返ってきた（鍵が外れた・年齢制限が消えた・その id が別の投稿を指すようになった）' };
    }
    // Nothing readable came back, which is indistinguishable from the endpoint
    // being down — and there is no shape to compare either way.
    if (!facts.primaryParsed) return { dead: true, reason: 'tombstone が期待値だが応答の本体が読めない', alarm: '' };
    // Either the expected tombstone, or a body that is neither a post nor a
    // tombstone. Both go to the shape comparison — a tombstone that lost its
    // wording IS the second case, and catching it is the whole point.
    return { dead: false, reason: '', alarm: '' };
  }
  if (facts.metaError) return { dead: true, reason: `metaError=${facts.metaError}`, alarm: '' };
  return facts.alive ? { dead: false, reason: '', alarm: '' } : { dead: true, reason: '投稿本体の項目が何も取れていない（削除・非公開・エラー応答）', alarm: '' };
}

module.exports = {
  MISSING_STREAK_ALARM,
  EXPECT_TOMBSTONE,
  judgeResponse,
  UNKNOWN,
  ENDPOINT_PATH,
  ENDPOINT_TYPE,
  shapeOf,
  sortShape,
  diffShapes,
  advanceStreak,
  carryBaseline,
  endpointMissingDiff,
  isEndpointEntry,
  isUnder,
  labelPath,
  streakKey,
  candidateOrder,
  rebaseOnSourceChange,
};

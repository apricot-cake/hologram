// The SECOND source of post information: what the page itself is showing
// (#202). Platform-agnostic — every rule about "which element holds the text"
// belongs to that site's own module (its capture site's extractDomMeta); this
// file owns only the two things that must not differ between sites:
//
//   1. HOW an abbreviated count reads as a number ("1.2万" → 12000)
//   2. WHICH of the API's fields a page-side value may fill, and when
//
// Why a second source at all: the platform API can answer nothing for a post
// that is plainly on screen. On X, a protected account and an age-restricted
// post both come back as a tombstone from the anonymous embed endpoint, and no
// login on our side can lift either (see x.ts's fetchXTweet). Measured over the
// 951 X posts of a real library on 2026-07-29, that is 45 posts — 4.7% — whose
// text, author and counts are visible to the person saving them and to nothing
// else. The remaining failures (deleted, suspended, 404) are not on screen
// either, so nothing here can or should reach them.
//
// THE API ALWAYS WINS. A page-side value fills a field the API left null and
// never overwrites one it answered: the two disagree routinely and harmlessly
// (a count ticks up between the fetch and the click, a rendered text is
// truncated with an ellipsis), and picking the page in those cases would trade
// an exact value for an approximate one for no gain. That also makes the
// failure mode of a site redesign the mild one — a selector that stops matching
// yields no value, so the save lands exactly as it did before this existed.
//
// NOTHING HERE MAY THROW INTO A SAVE. extractDomMeta runs against a page whose
// shape we do not control, in the content script, on the path between choosing
// a post and saving it — an exception thrown there would kill the save, which
// is a far worse outcome than the missing metadata this is trying to add. The
// call is wrapped once, here (readDomMeta), so no site module has to remember.

import type { CaptureSite, DomMeta, PostRecord } from './types.ts';

// The record fields a page-side value may fill, and nothing else. Explicit
// rather than "every key of DomMeta" so that adding a field to the shape is a
// deliberate act on both sides: url / platform / media / raw are decided by the
// save route and the API, and a page-derived guess at any of them would be a
// fabrication rather than a gap-fill.
//
// Split by value type rather than listed in one array so that both the sanity
// check below and the merge can be written without a cast: a `string | number`
// union assigned back into DomMeta narrows to the intersection of every field's
// type, which is nothing at all.
const DOM_FILLABLE_TEXT = ['text', 'displayName', 'screenName', 'date'] as const;
const DOM_FILLABLE_COUNT = ['likes', 'reposts', 'replies', 'bookmarks', 'views'] as const;
const DOM_FILLABLE: readonly string[] = [...DOM_FILLABLE_TEXT, ...DOM_FILLABLE_COUNT];

type DomFillableField = (typeof DOM_FILLABLE_TEXT)[number] | (typeof DOM_FILLABLE_COUNT)[number];

// Which of the above the user actually notices missing: a partial save whose
// author and text are blank reads as a broken record, while one that is only
// missing a repost count reads as a normal post. Used for the banner's wording
// (see domRescuedEssentials), never for what gets filled.
const DOM_ESSENTIAL_FIELDS: readonly DomFillableField[] = ['text', 'displayName'];

// Multipliers for the abbreviated forms X (and every other site that shortens
// counts) renders. Both vocabularies are needed because the page follows the
// UI language, not ours: an English UI shows "1.2K", a Japanese one "1.2万".
//
// The result is APPROXIMATE BY CONSTRUCTION and that is the specification, not
// a defect: "1.2万" is every value from 12000 to 12999 and the page does not
// carry the exact one. What the library uses these for — the engagement facets'
// at-least / at-most filters and sorting — is unharmed by that, and the exact
// value is what the API gives when the API answers at all.
const COUNT_SUFFIXES: ReadonlyArray<readonly [string, number]> = [
  ['k', 1e3],
  ['m', 1e6],
  ['b', 1e9],
  ['万', 1e4],
  ['億', 1e8],
  ['兆', 1e12],
];

// Full-width digits and the full-width dot: a Japanese X UI renders counts in
// ASCII, but a page is free not to, and folding them costs one replace.
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
}

// One rendered count as a number, or null when the text holds no count at all.
//
// Deliberately reads the LEADING number and its immediate suffix rather than
// scanning the whole string: an aria-label is a sentence in the UI's language
// ("1,234 Likes. Like" / "いいね 1,234 件") and a scan would happily pick up a
// number from anywhere in it. Callers hand in the smallest text that is
// supposed to BE the count, and a sentence that does not start with one is
// answered null rather than guessed at.
function parseCount(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  // Separators, spaces (including the non-breaking one X uses) — all noise
  // between the digits and the suffix.
  const s = toHalfWidthDigits(raw)
    .replace(/[\s ,、，]/g, '')
    .toLowerCase();
  const m = s.match(/^(\d+(?:\.\d+)?)(.?)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2] || '';
  const mult = COUNT_SUFFIXES.find(([sfx]) => sfx === suffix)?.[1] ?? 1;
  return Math.round(n * mult);
}

// A page-side string worth recording, or null. Empty and whitespace-only both
// become null: an age-restricted post whose body simply is not in the DOM must
// leave `text` alone rather than write "" over it, because a record with an
// empty text is indistinguishable from a text-only post whose text we lost.
function cleanText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return s ? s : null;
}

// Ask a capture site what its page shows for this post, never letting the
// answer's failure become the save's. Returns null when the site has no rule
// (every site but X until #202's stage 2), when the element is not one this
// rule understands, or when reading it threw.
function readDomMeta(site: CaptureSite | null | undefined, post: Element | null | undefined): DomMeta | null {
  if (!site?.extractDomMeta || !post) return null;
  try {
    const meta = site.extractDomMeta(post);
    if (!meta || typeof meta !== 'object') return null;
    // Re-cleaned on THIS side of the boundary: a site module is free to return
    // whatever its selectors produced, and everything below assumes a value is
    // either usable or absent. A negative or non-finite count is dropped rather
    // than stored — no engagement figure can be either, so such a value means
    // the parse went wrong, not that the post has -1 likes.
    const out: DomMeta = {};
    for (const field of DOM_FILLABLE_TEXT) {
      const s = cleanText(meta[field]);
      if (s !== null) out[field] = s;
    }
    for (const field of DOM_FILLABLE_COUNT) {
      const n = meta[field];
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) out[field] = n;
    }
    return out;
  } catch {
    return null;
  }
}

// Fill the record's EMPTY fields from what the page showed, and answer which
// ones that was. The record is mutated in place (it is the save's own working
// copy, built by fetchPostMetadata one line earlier) and the returned list is
// what lands on the record as `domFilled`.
//
// Two things are load-bearing about the condition below:
//   - `== null` and not falsy: a genuine 0 ("no likes yet") is an answer the
//     API gave, and a page-side "0" replacing it would be a no-op at best and
//     a stale value at worst.
//   - it applies to a SUCCESSFUL fetch too. X's syndication endpoint cannot
//     report reposts, bookmarks or views at all — not "did not this time",
//     but has no field for them (see x.ts's header) — so those three are
//     permanently null on every X record and the page is the only place they
//     exist. Restricting this to failed fetches would leave them empty forever.
function mergeDomMeta(rec: PostRecord, dom: DomMeta | null | undefined): string[] {
  if (!rec || !dom) return [];
  const filled: string[] = [];
  for (const field of DOM_FILLABLE_TEXT) {
    const value = dom[field];
    if (value == null || rec[field] != null) continue; // the API answered — it wins, always
    rec[field] = value;
    filled.push(field);
  }
  for (const field of DOM_FILLABLE_COUNT) {
    const value = dom[field];
    if (value == null || rec[field] != null) continue;
    rec[field] = value;
    filled.push(field);
  }
  return filled;
}

// Did the page rescue what a person would notice missing? Decides only the
// partial-save banner's wording (#202's confirmed design: metaOk keeps its
// meaning, the save stays amber, the sentence changes) — never whether
// anything is saved.
//
// One essential field is enough rather than both, because "both" would fall
// silent on the very posts this helps most: an image post with no caption has
// no text to rescue, and its author name arriving from the page is exactly the
// difference between a usable record and a blank one.
function domRescuedEssentials(domFilled: readonly string[] | null | undefined): boolean {
  if (!Array.isArray(domFilled)) return false;
  return DOM_ESSENTIAL_FIELDS.some((f) => domFilled.includes(f));
}

export { DOM_ESSENTIAL_FIELDS, DOM_FILLABLE, DOM_FILLABLE_COUNT, DOM_FILLABLE_TEXT, cleanText, domRescuedEssentials, mergeDomMeta, parseCount, readDomMeta };
export type { DomFillableField };

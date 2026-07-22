// Canonical post URL → identity-key normalization, shared by every layer that has
// to decide "are these two URLs the same post":
//   - the renderer's grouping (app/renderer/records.ts re-exports postKeyOf from
//     here — same-post records collapse into one card),
//   - the bridge's saved-post index (the TL "saved" badge asks it whether a
//     permalink is already in the library, #54; a key computed differently there
//     would light the badge on posts the app groups apart, or miss ones it groups
//     together).
//
// The extension deliberately does NOT normalize: it extracts a permalink and hands
// the raw URL over, so the URL→key rule has exactly one implementation (#54's
// design). metadata.ts's parsePostUrl stays a separate concern — it parses a URL
// into platform + id + API endpoint for FETCHING a post, not into an identity key.
//
// The one .mts in native-host/ (everything else here is .cts — see tsconfig.json).
// It has to be ESM because the renderer ES-imports it: TypeScript reads no exports
// off a .cts file's `module.exports` assignment, and giving a .cts real `export`
// statements would break the raw-source loads this directory depends on (Node's
// type stripping erases types, it cannot transform ESM syntax into CJS). The
// bridge's require() of it resolves at bundle time (app/islands/build.mjs) for the
// deployed host, and through Node's require(esm) for the source-level tests.

// Returns null when the URL isn't a recognized post permalink (unparseable, or a
// profile / search / home page). null means "don't group", never "no match".
export function postKeyOf(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname;
  const pa = u.pathname;
  let m: RegExpMatchArray | null;
  if (host === 'bsky.app' && (m = pa.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/))) return 'bluesky:' + m[1] + '/' + m[2];
  if ((host === 'x.com' || host === 'twitter.com') && (m = pa.match(/\/status\/(\d+)/))) return 'x:' + m[1];
  if ((m = pa.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/))) return 'mastodon:' + host + ':' + m[1];
  if ((m = pa.match(/^\/notes\/([^/?#]+)/))) return 'misskey:' + host + ':' + m[1];
  if ((host === 'www.pixiv.net' || host === 'pixiv.net') && (m = pa.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/))) return 'pixiv:' + m[1];
  return null;
}

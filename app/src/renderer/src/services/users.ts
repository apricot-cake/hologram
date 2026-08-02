// User aggregation service — buildUsers (per-poster roll-up over allPosts, cached
// behind the library generation), extracted 1:1 from viewer.js as the fifth
// "pure logic → service" slice of the viewer decomposition (final form B). A real ES
// module (named exports), imported directly by viewer.ts; touches no DOM.
// Runtime couplings are injected via makeUsers(deps) — reassigned viewer lets
// (allPosts / _allPostsGeneration) come in as getter functions.
//
// buildSuggest (the search box's tag/poster suggestion rows) used to live here too.
// It moved into the command registry's corpus provider (services/command-builder.ts)
// with #28: the palette and the search box are two faces over one candidate engine,
// so there is exactly one place that decides what the rows are. buildUsers is still
// the poster half of that generation — the provider calls it.

// deps contract (all functions):
//   allPosts() — full library (getter — viewer reassigns the array)
//   generation() — _allPostsGeneration (bumped on every allPosts replacement;
//                  invalidates the buildUsers cache; #23 St1's merge/unlink go
//                  through the SAME bump — services/aliases.ts's mutators
//                  don't own a generation of their own, the caller
//                  (poster-grid-builder.ts) calls markPostsMutated() same as
//                  every other organization-layer edit that must invalidate
//                  this cache — see post-grid-builder.ts's own precedent of
//                  bumping it for "a deleted author/instance must drop out of
//                  the sidebar")
//   userKey(p) / hostOf(url) — from query.js
//   resolve(key) — services/aliases.ts; identity when the poster isn't merged
export function makeUsers(deps: { allPosts(): HologramPost[]; generation(): number; userKey(p: HologramPost): string; hostOf(url: string | null | undefined): string; resolve(key: string): string }) {
  const { allPosts, generation, userKey, hostOf, resolve } = deps;

  // Group posts by author. Posts arrive newest-first, so the first occurrence
  // carries the latest display name / handle for that user.
  // Cached behind the allPosts generation (same idiom as _rebuildSidebarSets):
  // buildUsers scans all ~9000 posts, and it was being re-run on every search
  // keystroke via buildSuggest. Rebuild only when the library changes.
  //
  // #23 St1: a 2nd pass folds every raw per-posterKey agg onto its alias
  // group's primary (design: "buildUsers の2パス化＋count は加算、期間は
  // min/max の union、表示系（表示名・アバター等）は primary の agg を明示
  // 選択"). Pass 1 below is unchanged (still keyed by the post's OWN raw
  // userKey); pass 2 is the fold.
  let _buildUsersGen = -1,
    _cachedUsers: HologramUserAgg[] | null = null;
  function buildUsers() {
    if (_buildUsersGen === generation() && _cachedUsers) return _cachedUsers;
    const map = new Map<string, any>();
    for (const p of allPosts()) {
      if (!p.url) continue; // SNS posts only — match the post-view dataset
      const key = userKey(p);
      let u = map.get(key);
      if (!u) {
        u = { key, platform: p.platform, screenName: p.screenName || '', displayName: p.displayName || '', avatarFile: '', followers: null, authorCreatedAt: '', instance: '', latest: '', firstPost: '', lastCapture: '', firstCapture: '', count: 0 };
        map.set(key, u);
      }
      u.count++;
      // Posts arrive newest-first, so the first non-empty occurrence is the latest
      // value for that poster (same idiom as displayName/screenName below).
      if (!u.displayName && p.displayName) u.displayName = p.displayName;
      if (!u.screenName && p.screenName) u.screenName = p.screenName;
      if (!u.avatarFile && p.avatarFile) u.avatarFile = p.avatarFile;
      if (u.followers == null && p.followers != null) u.followers = p.followers;
      if (!u.authorCreatedAt && p.authorCreatedAt) u.authorCreatedAt = p.authorCreatedAt;
      if (!u.instance && (p.platform === 'misskey' || p.platform === 'mastodon')) {
        const h = hostOf(p.url);
        if (h) u.instance = h;
      }
      // Aggregate date range across this poster's posts (ISO strings compare lexically).
      // latest/firstPost = latest/first post date; lastCapture/firstCapture = latest/first capture date.
      if (p.date && (!u.latest || p.date > u.latest)) u.latest = p.date;
      if (p.date && (!u.firstPost || p.date < u.firstPost)) u.firstPost = p.date;
      if (p.capturedAt && (!u.lastCapture || p.capturedAt > u.lastCapture)) u.lastCapture = p.capturedAt;
      if (p.capturedAt && (!u.firstCapture || p.capturedAt < u.firstCapture)) u.firstCapture = p.capturedAt;
    }
    // Pass 2: fold every raw agg onto resolve(key) (identity when ungrouped, so
    // an unmerged poster passes through this loop unchanged). Display fields
    // are order-independent by construction: they're only (re)written when the
    // entry being folded IS the primary's own raw agg, so whichever of the
    // group's raw keys the Map iterates first, the primary's fields always win
    // once its turn comes (falling back to the first-seen member's fields in
    // the edge case where the primary itself has no posts of its own — e.g.
    // every one of its posts was later deleted).
    const folded = new Map<string, any>();
    for (const [key, agg] of map) {
      const canon = resolve(key);
      let out = folded.get(canon);
      if (!out) {
        out = {
          key: canon,
          platform: agg.platform,
          screenName: agg.screenName,
          displayName: agg.displayName,
          avatarFile: agg.avatarFile,
          followers: agg.followers,
          authorCreatedAt: agg.authorCreatedAt,
          instance: agg.instance,
          latest: '',
          firstPost: '',
          lastCapture: '',
          firstCapture: '',
          count: 0,
          members: [],
          platforms: [],
          instances: [],
        };
        folded.set(canon, out);
      } else if (key === canon) {
        out.platform = agg.platform;
        out.screenName = agg.screenName;
        out.displayName = agg.displayName;
        out.avatarFile = agg.avatarFile;
        out.followers = agg.followers;
        out.authorCreatedAt = agg.authorCreatedAt;
        out.instance = agg.instance;
      }
      out.count += agg.count;
      if (agg.latest && (!out.latest || agg.latest > out.latest)) out.latest = agg.latest;
      if (agg.firstPost && (!out.firstPost || agg.firstPost < out.firstPost)) out.firstPost = agg.firstPost;
      if (agg.lastCapture && (!out.lastCapture || agg.lastCapture > out.lastCapture)) out.lastCapture = agg.lastCapture;
      if (agg.firstCapture && (!out.firstCapture || agg.firstCapture < out.firstCapture)) out.firstCapture = agg.firstCapture;
      out.members.push(key);
      if (agg.platform && !out.platforms.includes(agg.platform)) out.platforms.push(agg.platform);
      if (agg.instance && !out.instances.includes(agg.instance)) out.instances.push(agg.instance);
    }
    _cachedUsers = [...folded.values()];
    _buildUsersGen = generation();
    return _cachedUsers;
  }

  return { buildUsers };
}

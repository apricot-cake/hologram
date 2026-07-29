// User aggregation service — buildUsers (per-poster roll-up over allPosts, cached
// behind the library generation), extracted 1:1 from viewer.js as the fifth
// "pure logic → service" slice of the viewer decomposition (最終形B). A real ES
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
//                  invalidates the buildUsers cache)
//   userKey(p) / hostOf(url) — from query.js
export function makeUsers(deps: { allPosts(): HologramPost[]; generation(): number; userKey(p: HologramPost): string; hostOf(url: string | null | undefined): string }) {
  const { allPosts, generation, userKey, hostOf } = deps;

  // Group posts by author. Posts arrive newest-first, so the first occurrence
  // carries the latest display name / handle for that user.
  // Cached behind the allPosts generation (same idiom as _rebuildSidebarSets):
  // buildUsers scans all ~9000 posts, and it was being re-run on every search
  // keystroke via buildSuggest. Rebuild only when the library changes.
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
      // latest/firstPost = 最終/初回投稿日; lastCapture/firstCapture = 最終/初回取得日.
      if (p.date && (!u.latest || p.date > u.latest)) u.latest = p.date;
      if (p.date && (!u.firstPost || p.date < u.firstPost)) u.firstPost = p.date;
      if (p.capturedAt && (!u.lastCapture || p.capturedAt > u.lastCapture)) u.lastCapture = p.capturedAt;
      if (p.capturedAt && (!u.firstCapture || p.capturedAt < u.firstCapture)) u.firstCapture = p.capturedAt;
    }
    _cachedUsers = [...map.values()];
    _buildUsersGen = generation();
    return _cachedUsers;
  }

  return { buildUsers };
}

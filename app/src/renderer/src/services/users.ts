// deps の契約（すべて関数）:
//   allPosts() — ライブラリ全体（getter＝viewer がこの配列を再代入する）
//   generation() — _allPostsGeneration（allPosts を置き換えるたびに進み、
//                  buildUsers のキャッシュを無効化する）
//   userKey(p) / hostOf(url) — query.js から
export function makeUsers(deps: { allPosts(): HologramPost[]; profiles?(): Array<Record<string, any>>; generation(): number | string; userKey(p: HologramPost): string; hostOf(url: string | null | undefined): string }) {
  const { allPosts, generation, userKey } = deps;

  // 投稿を投稿者ごとにグループ化する。投稿は新しい順に届くので、最初の
  // 出現がそのユーザーの最新の表示名／ハンドルを運ぶ。
  // allPosts の世代の裏でキャッシュする（_rebuildSidebarSets と同じ
  // 考え方）: buildUsers は約9000件の投稿全体を走査し、以前は buildSuggest
  // 経由で検索のキー入力のたびに実行されていた。ライブラリが変わったとき
  // だけ作り直す。
  //
  let _buildUsersGen: number | string = -1,
    _cachedUsers: HologramUserAgg[] | null = null;
  function buildUsers() {
    if (_buildUsersGen === generation() && _cachedUsers) return _cachedUsers;
    const map = new Map<string, any>();
    for (const p of allPosts()) {
      // #760: 投稿者が存在するのは、投稿が投稿者の identity（userId または
      // screenName）を持っているときだけ――プラットフォームを持たず、url とサイト名だけを
      // 持つウェブ由来のレコードは、以前は旧来の「url を持つ」ゲートを通過し、
      // すべてを1人の投稿者に潰していた
      // （userKey のフォールバックである '@' + '' はどれも同じ文字列に
      // なるため）。本物の SNS の投稿は必ずどちらかを持つので、既存の
      // 対応サイトの投稿にとってこれは挙動の変更ではない――新たに
      // 対象外になるのは、プラットフォームも identity も持たないレコード
      // だけ。
      if (!p.userId && !p.screenName) continue;
      const key = userKey(p);
      let u = map.get(key);
      if (!u) {
        u = {
          key,
          platform: p.platform,
          screenName: p.screenName || '',
          displayName: p.displayName || '',
          bio: '',
          avatarFile: '',
          bannerFile: '',
          followers: null,
          following: null,
          authorCreatedAt: '',
          followerPercentile: null,
          latest: '',
          firstPost: '',
          lastCapture: '',
          firstCapture: '',
          count: 0,
        };
        map.set(key, u);
      }
      u.count++;
      // 投稿は新しい順に届くので、最初の空でない出現がその投稿者にとっての
      // 最新の値になる（下の displayName/screenName と同じ考え方）。
      if (!u.displayName && p.displayName) u.displayName = p.displayName;
      if (!u.screenName && p.screenName) u.screenName = p.screenName;
      if (!u.avatarFile && p.avatarFile) u.avatarFile = p.avatarFile;
      if (u.followers == null && p.followers != null) u.followers = p.followers;
      if (u.following == null && p.following != null) u.following = p.following;
      if (!u.authorCreatedAt && p.authorCreatedAt) u.authorCreatedAt = p.authorCreatedAt;
      // この投稿者の投稿にわたって日付範囲を集計する（ISO 文字列は辞書順で
      // 比較できる）。latest/firstPost = 投稿日の最新／最初、lastCapture/
      // firstCapture = capture 日の最新／最初。
      if (p.date && (!u.latest || p.date > u.latest)) u.latest = p.date;
      if (p.date && (!u.firstPost || p.date < u.firstPost)) u.firstPost = p.date;
      if (p.capturedAt && (!u.lastCapture || p.capturedAt > u.lastCapture)) u.lastCapture = p.capturedAt;
      if (p.capturedAt && (!u.firstCapture || p.capturedAt < u.firstCapture)) u.firstCapture = p.capturedAt;
    }
    // 投稿保存時に記録した公開プロフィール情報を、対応する投稿者へ重ねる。
    // 投稿のないプロフィール行は、廃止したプロフィール単独保存の残存データなので出さない。
    for (const profile of deps.profiles?.() || []) {
      if (!profile?.key) continue;
      const u = map.get(profile.key);
      if (!u) continue;
      if (profile.platform) u.platform = profile.platform;
      if (profile.screenName) u.screenName = profile.screenName;
      if (profile.displayName) u.displayName = profile.displayName;
      if (profile.bio) u.bio = profile.bio;
      if (profile.avatarFile) u.avatarFile = profile.avatarFile;
      if (profile.bannerFile) u.bannerFile = profile.bannerFile;
      if (profile.followers != null) u.followers = profile.followers;
      if (profile.following != null) u.following = profile.following;
      if (profile.authorCreatedAt) u.authorCreatedAt = profile.authorCreatedAt;
    }
    const byPlatform = new Map<string, HologramUserAgg[]>();
    for (const user of map.values()) {
      if (!user.platform || user.followers == null) continue;
      const list = byPlatform.get(user.platform) || [];
      list.push(user);
      byPlatform.set(user.platform, list);
    }
    for (const list of byPlatform.values()) {
      list.sort((a, b) => (b.followers as number) - (a.followers as number));
      for (let index = 0; index < list.length; index++) {
        const user = list[index];
        const first = list.findIndex((candidate) => candidate.followers === user.followers);
        let last = first;
        for (let candidate = first + 1; candidate < list.length && list[candidate].followers === user.followers; candidate++) last = candidate;
        user.followerPercentile = list.length === 1 ? 1 : 1 - (first + last) / 2 / (list.length - 1);
      }
    }
    _cachedUsers = [...map.values()];
    _buildUsersGen = generation();
    return _cachedUsers;
  }

  return { buildUsers };
}

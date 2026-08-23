// user 集計サービス＝buildUsers（allPosts に対する投稿者ごとの集計、
// ライブラリの世代の裏でキャッシュ）。viewer.js から1:1で抽出した、viewer
// 分解（最終形B）における5番目の「純粋ロジック→サービス」切り出し。実体は
// 本物の ES モジュール（named exports）で、viewer.ts から直接 import
// される。DOM には一切触れない。ランタイムの結合は makeUsers(deps) を
// 通して注入される＝再代入される viewer の let（allPosts /
// _allPostsGeneration）は getter 関数として受け取る。
//
// buildSuggest（検索ボックスのタグ／投稿者サジェスト行）もかつてここに
// あった。#28 でコマンド登録簿のコーパスプロバイダ
// （services/command-builder.ts）へ移った: パレットと検索ボックスは1つの
// 候補エンジンに対する2つの顔なので、行が何であるかを決める場所は
// ちょうど1つ。buildUsers は今もその生成のポスター側半分――プロバイダが
// それを呼ぶ。

// deps の契約（すべて関数）:
//   allPosts() — ライブラリ全体（getter＝viewer がこの配列を再代入する）
//   generation() — _allPostsGeneration（allPosts を置き換えるたびに進む。
//                  buildUsers のキャッシュを無効化する。#23 St1 の
//                  マージ／解除も同じ更新を通る――services/aliases.ts の
//                  ミューテータは自分専用の世代を持たず、呼び出し側
//                  （poster-grid-builder.ts）が、このキャッシュを無効化
//                  しなければならない他のあらゆる整理層の編集と同じく
//                  markPostsMutated() を呼ぶ――「削除された投稿者／
//                  インスタンスはサイドバーから落とさなければならない」に
//                  ついて post-grid-builder.ts 自身がそれを進めている前例を
//                  参照）
//   userKey(p) / hostOf(url) — query.js から
//   resolve(key) — services/aliases.ts。投稿者がマージされていなければ恒等写像
export function makeUsers(deps: { allPosts(): HologramPost[]; savedProfiles?(): Array<Record<string, any>>; generation(): number | string; userKey(p: HologramPost): string; hostOf(url: string | null | undefined): string; resolve(key: string): string }) {
  const { allPosts, generation, userKey, hostOf, resolve } = deps;

  // 投稿を投稿者ごとにグループ化する。投稿は新しい順に届くので、最初の
  // 出現がそのユーザーの最新の表示名／ハンドルを運ぶ。
  // allPosts の世代の裏でキャッシュする（_rebuildSidebarSets と同じ
  // 考え方）: buildUsers は約9000件の投稿全体を走査し、以前は buildSuggest
  // 経由で検索のキー入力のたびに実行されていた。ライブラリが変わったとき
  // だけ作り直す。
  //
  // #23 St1: 2回目のパスが、生の posterKey ごとの集計をすべてその alias
  // グループのプライマリへ畳み込む（設計: 「buildUsers の2パス化＋count は
  // 加算、期間は min/max の union、表示系（表示名・アバター等）は primary
  // の agg を明示選択」）。下のパス1は変更なし（今も投稿自身の生の userKey
  // でキー付けされている）。パス2が畳み込み。
  let _buildUsersGen: number | string = -1,
    _cachedUsers: HologramUserAgg[] | null = null;
  function buildUsers() {
    if (_buildUsersGen === generation() && _cachedUsers) return _cachedUsers;
    const map = new Map<string, any>();
    for (const p of allPosts()) {
      // #760: 投稿者が存在するのは、投稿が投稿者の identity（userId または
      // screenName）を持っているときだけ――プラットフォームを持たない
      // ブックマーク（#195、url はあるが投稿者は一切無く、サイト名の
      // displayName だけ）は、以前は旧来の「url を持つ」ゲートを通過し、
      // この世のすべてのブックマークを1人の投稿者に潰していた
      // （userKey のフォールバックである '@' + '' はどれも同じ文字列に
      // なるため）。本物の SNS の投稿は必ずどちらかを持つので、既存の
      // 5つのプラットフォームにとってこれは挙動の変更ではない――新たに
      // 対象外になるのは、プラットフォームも identity も持たないレコード
      // だけ。
      if (!p.userId && !p.screenName) continue;
      const key = userKey(p);
      let u = map.get(key);
      if (!u) {
        u = { key, platform: p.platform, screenName: p.screenName || '', displayName: p.displayName || '', avatarFile: '', followers: null, authorCreatedAt: '', instance: '', latest: '', firstPost: '', lastCapture: '', firstCapture: '', count: 0 };
        map.set(key, u);
      }
      u.count++;
      // 投稿は新しい順に届くので、最初の空でない出現がその投稿者にとっての
      // 最新の値になる（下の displayName/screenName と同じ考え方）。
      if (!u.displayName && p.displayName) u.displayName = p.displayName;
      if (!u.screenName && p.screenName) u.screenName = p.screenName;
      if (!u.avatarFile && p.avatarFile) u.avatarFile = p.avatarFile;
      if (u.followers == null && p.followers != null) u.followers = p.followers;
      if (!u.authorCreatedAt && p.authorCreatedAt) u.authorCreatedAt = p.authorCreatedAt;
      if (!u.instance && p.platform === 'misskey') {
        const h = hostOf(p.url);
        if (h) u.instance = h;
      }
      // この投稿者の投稿にわたって日付範囲を集計する（ISO 文字列は辞書順で
      // 比較できる）。latest/firstPost = 投稿日の最新／最初、lastCapture/
      // firstCapture = capture 日の最新／最初。
      if (p.date && (!u.latest || p.date > u.latest)) u.latest = p.date;
      if (p.date && (!u.firstPost || p.date < u.firstPost)) u.firstPost = p.date;
      if (p.capturedAt && (!u.lastCapture || p.capturedAt > u.lastCapture)) u.lastCapture = p.capturedAt;
      if (p.capturedAt && (!u.firstCapture || p.capturedAt < u.firstCapture)) u.firstCapture = p.capturedAt;
    }
    // プロフィールページから明示的に保存された投稿者。投稿を捏造せず、投稿数 0 件の
    // 投稿者として同じ集約へ加える。すでに投稿から存在する場合は、プロフィール取得時の
    // 新しい表示情報だけを上書きする。
    for (const profile of deps.savedProfiles?.() || []) {
      if (!profile?.key) continue;
      let u = map.get(profile.key);
      if (!u) {
        u = {
          key: profile.key,
          platform: profile.platform,
          screenName: profile.screenName || '',
          displayName: profile.displayName || '',
          avatarFile: profile.avatarFile || '',
          followers: profile.followers ?? null,
          authorCreatedAt: profile.authorCreatedAt || '',
          instance: profile.instance || '',
          latest: '',
          firstPost: '',
          lastCapture: profile.savedAt || '',
          firstCapture: profile.savedAt || '',
          count: 0,
        };
        map.set(profile.key, u);
        continue;
      }
      if (profile.platform) u.platform = profile.platform;
      if (profile.screenName) u.screenName = profile.screenName;
      if (profile.displayName) u.displayName = profile.displayName;
      if (profile.avatarFile) u.avatarFile = profile.avatarFile;
      if (profile.followers != null) u.followers = profile.followers;
      if (profile.authorCreatedAt) u.authorCreatedAt = profile.authorCreatedAt;
      if (profile.instance) u.instance = profile.instance;
    }
    // パス2: 生の集計をすべて resolve(key) へ畳み込む（グループ化されて
    // いなければ恒等写像なので、マージされていない投稿者はこのループを
    // 変更無しで通過する）。表示用フィールドは構造上、順序に依存しない:
    // 畳み込まれているエントリがプライマリ自身の生の集計であるときにしか
    // （再）書き込まれないので、Map がそのグループの生のキーをどの順で
    // 走査しても、プライマリの番が来ればその番でプライマリのフィールドが
    // 常に勝つ（プライマリ自身が自分の投稿を1つも持たない――例えばその
    // すべてが後で削除された――端のケースでは、最初に見えたメンバーの
    // フィールドへフォールバックする）。
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

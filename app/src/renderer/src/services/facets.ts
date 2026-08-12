// ファセットサービス＝facetCounts（バケット集計）＋qfValues（サイドバーの
// 値フライアウトの行モデル、15カテゴリ）。viewer.js から1:1で抽出した、
// viewer 分解（最終形B）における3番目の「純粋ロジック→サービス」切り出し。
// 実体は本物の ES モジュール（named exports）で、viewer.ts から直接 import
// される。DOM には一切触れない。ランタイムの結合はすべて makeFacets(deps)
// を通して注入される＝再代入される viewer の let（allPosts）は getter
// 関数として受け取り、配線ポイントより後で宣言される const（posterQB /
// pfStore / hologramQuery の分割代入）は遅延ラッパーとして受け取る＝
// このためこのファイルは Node 上でも読み込める
// （scripts/test-facets-unit.cts）。

import { hasVisualMedia, kindOf } from './query.ts';

// ポスターの platform ファセットの並び順（ファセット行専用＝viewer 自身の
// PF 一覧は描画される場所にインラインで書かれている）。
export const PF_ORDER = ['x', 'bluesky', 'misskey', 'mastodon', 'pixiv'];

// deps の契約（注記が無ければすべて関数）:
//   getFilteredPosts() — 現在のクエリに一致する投稿の母集団（既定の集計対象）
//   qHasValue(type,v) / posterQHasValue(type,v) — 「この値は木の中で有効か」
//   qHasTag(tagId,name) — qHasValue のタグの葉版（#774）: タグ行が有効なのは
//     木がその実体に対する葉を持つときで、単に名前が一致するだけではない
//   posterQHasTag(tagId,name) — 同じことをポスターの木に対して行う（#810）
//   allPosts() — ライブラリ全体（ファセットの語彙。getter＝viewer がこれを
//     再代入する）
//   hostOf(url) / userKey(p) — query.js から（ラップ済み: 配線後に分割代入）
//   t(key,subs?) — メッセージ検索／PF_NAME（値）— ラベル表（配線ポイントの
//     const）
//   tagKindOf(tagId) / tagKindOfName(tag) — 用語集の kind
//     （'work'/'character'/null）。実体単位と名前単位（#810＝どちらがどちらかは
//     tags.ts のヘッダーが説明している）
//   posterTagEntriesOf(key) / filteredPosters() / posterFilterVocab() / namedPosters()
//   posterFolders() — pfStore.all()（ラップ済み: pfStore は後で宣言される）
//   buildUsers() — user ファセットの元（viewer でキャッシュ）
//   resolve(key) / membersOf(key) — services/aliases.ts（#23 St1）。投稿者が
//     マージされていなければ恒等写像／[key]
export function makeFacets(deps: {
  getFilteredPosts(): HologramPost[];
  qHasValue(type: string, v: string): boolean;
  qHasTag(tagId: number | null, name: string): boolean;
  posterQHasValue(type: string, v: string): boolean;
  posterQHasTag(tagId: number | null, name: string): boolean;
  allPosts(): HologramPost[];
  hostOf(url: string | null | undefined): string;
  userKey(p: HologramPost): string;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  PF_NAME: Record<string, string>;
  tagKindOf(tagId: number | null | undefined): string | null | undefined;
  tagKindOfName(tag: string): string | null | undefined;
  posterTagEntriesOf(key: string): HologramTagEntry[];
  filteredPosters(): HologramUserAgg[];
  posterFilterVocab(): HologramTagEntry[];
  namedPosters(): HologramUserAgg[];
  posterFolders(): HologramFolder[];
  postFolders(): HologramFolder[];
  buildUsers(): HologramUserAgg[];
  resolve(key: string): string;
  membersOf(key: string): string[];
}) {
  const { getFilteredPosts, qHasValue, qHasTag, posterQHasValue, posterQHasTag, allPosts, hostOf, userKey, t, PF_NAME, tagKindOf, tagKindOfName, posterTagEntriesOf, filteredPosters, posterFilterVocab, namedPosters, posterFolders, postFolders, buildUsers, resolve, membersOf } = deps;

  // --- タグ行は名前ごとではなく実体ごと（#774／#5 の ID モデル） -------------
  // タグ行は1つの tags テーブルの行を表す: `name` は選んだときにクエリの葉へ
  // 書き込まれるもの、`label` は行が表示するもの（同じ名前を共有する2つの
  // 実体は表示上の親でしか見分けがつかない――「alice(東方)」）。
  //
  // エントリはレコードの実効配列から来るので、親タグはその子タグだけを持つ
  // 投稿からも行（と件数）を得る――これがクエリ時に親子関係を適用する
  // ことの主旨そのもの。それを持たないレコード（タグ書き込みの失敗で id が
  // 落ちた＝services/posts.ts の applyTagWrite）は生の名前へフォールバック
  // する。これは #774 より前にこれらの行がキー付けされていたやり方＝精度は
  // 落ちるが、同名の対が無いライブラリでは決して誤らない。
  //
  // #810 がポスター側にも同じ形を与えた（tags.ts の posterTagEntriesOf）ので、
  // 下の entryKey/entryKind/tagVocab は両方で共有される＝ポスターのタグ行と
  // 投稿のタグ行は、今では同じ種類のものを表す。
  const entryKey = (e: HologramTagEntry) => (e.id != null ? 'i:' + e.id : 'n:' + e.name);
  // 行が自分がどちらかを知っているときは実体単位で kind を、フォールバック
  // 経路では名前単位で（id を持たないエントリは名前でしかない）。
  const entryKind = (e: HologramTagEntry) => (e.id != null ? tagKindOf(e.id) : tagKindOfName(e.name));
  function tagEntriesOf(p: HologramPost): HologramTagEntry[] {
    const ids = p.effectiveTagIds;
    if (Array.isArray(ids) && ids.length) {
      const names: string[] = Array.isArray(p.effectiveTags) ? p.effectiveTags : [];
      const labels: string[] = Array.isArray(p.effectiveTagLabels) ? p.effectiveTagLabels : [];
      return ids.map((id: number, i: number) => {
        const name = names[i] != null ? names[i] : '';
        return { id, name, label: labels[i] || name };
      });
    }
    return (p.tags || []).map((name: string) => ({ id: null, name, label: name }));
  }
  // ライブラリ全体のタグ語彙、最初の出現が勝つ（同じ id のどの出現も同じ
  // name/label を持つ――全部が同じ tags 行から来るため）。
  function tagVocab(): HologramTagEntry[] {
    const m = new Map<string, HologramTagEntry>();
    for (const p of allPosts()) for (const e of tagEntriesOf(p)) if (!m.has(entryKey(e))) m.set(entryKey(e), e);
    return [...m.values()];
  }
  const tagRow = (e: HologramTagEntry, cnt: Map<string, number>, extra?: Record<string, unknown>): HologramQfRow => ({ v: e.name, l: e.label, tagId: e.id ?? undefined, on: qHasTag(e.id, e.name), count: cnt.get(entryKey(e)) || 0, facetDim: true, ...extra });
  // tagRow のポスター木版の双子（#810）: 行の形も実体の同一性も同じで、
  // 尋ねる木だけが違う。
  const posterTagRow = (e: HologramTagEntry, cnt: Map<string, number>, extra?: Record<string, unknown>): HologramQfRow => ({ v: e.name, l: e.label, tagId: e.id ?? undefined, on: posterQHasTag(e.id, e.name), count: cnt.get(entryKey(e)) || 0, facetDim: true, ...extra });
  // 存在する値（件数降順）が不在の値より先に来る。ja ロケールの名前で同順位を判定。
  const byTagCount = (a: HologramQfRow, b: HologramQfRow) => (b.count || 0) - (a.count || 0) || (a.l || '').localeCompare(b.l || '', 'ja');

  // ファセットの件数: 現在のクエリへの一致のうち、あるファセットの各値に
  // 当てはまるものがいくつあるか。母集団 = getFilteredPosts()（検索語を含む
  // すべての有効な条件）なので、フライアウトは実際に見ている投稿を映す。
  // keyFn(p) は1つの値、または値の配列（タグ、ハッシュタグ）を返す。それぞれが
  // 自分のバケットを増やす。フライアウトの描画ごとに1回構築する（描画1回に
  // つき1カテゴリ）。`pool` を渡すと別の母集団で数える――ポスタービューは
  // filteredPosters() を渡す（件数はポスターの件数になる）。
  // 注記: 自分自身のカテゴリを除外することはあえてしていない――同じ
  // カテゴリ内で選ぶと母数が狭まるので、それらの0はそのまま沈む。今の結果に
  // 無い値も一覧には残す（グレー表示だがクリック可能）ので、それでも選べる。
  // オーバーロード: pool 無しでは post の母集団（getFilteredPosts()）で
  // キー付けする。ポスター限定の行（poster-tag / poster-work /
  // poster-character / poster-platform / poster-instance / poster-folder）は
  // `pool` に filteredPosters() を渡し、代わりに HologramUserAgg でキー
  // 付けする。
  function facetCounts(keyFn: (p: HologramPost) => string | string[] | null | undefined): Map<string, number>;
  function facetCounts<T extends HologramUserAgg>(keyFn: (p: T) => string | string[] | null | undefined, pool: T[]): Map<string, number>;
  function facetCounts(keyFn: (p: any) => string | string[] | null | undefined, pool?: any[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const p of pool || getFilteredPosts()) {
      const k = keyFn(p);
      if (k == null) continue;
      if (Array.isArray(k)) {
        for (const v of k) if (v != null) m.set(v, (m.get(v) || 0) + 1);
      } else m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }

  function qfValues(cat: string): HologramQfRow[] {
    // "on" = この値がクエリ木のどこかにすでに存在する。
    const act = (type: string, v: string): boolean => qHasValue(type, v);
    switch (cat) {
      case 'kind': {
        // #195: 件数を出す（ブックマーク導入前の2値版とは違い）＝ブックマークが
        // ほとんど無い、または皆無なライブラリなら、中身の無い選択肢を他の
        // 2つと対等に見せるのではなく、それを一目でわかるようにするべき。
        const cnt = facetCounts((p) => kindOf(p));
        return [
          ['post', t('kindPost')],
          ['image', t('kindImage')],
          ['bookmark', t('kindBookmark')],
        ].map(([v, l]) => ({ v, l, on: act('kind', v), count: cnt.get(v) || 0 }));
      }
      case 'platform': {
        // Misskey/Mastodon の直下にインスタンスごとの副行として展開する（それぞれ独立に選べる）
        const hostsOf = (plat: string) => {
          const set = new Set<string>();
          for (const p of allPosts())
            if (p.platform === plat) {
              const h = hostOf(p.url);
              if (h) set.add(h);
            }
          return [...set].sort();
        };
        const pcnt = facetCounts((p) => p.platform);
        const icnt = facetCounts((p) => (p.platform === 'misskey' || p.platform === 'mastodon' ? hostOf(p.url) : null));
        const out: HologramQfRow[] = [];
        for (const v of PF_ORDER) {
          out.push({ v, l: PF_NAME[v], on: act('platform', v), count: pcnt.get(v) || 0 });
          if (v === 'misskey' || v === 'mastodon') {
            for (const h of hostsOf(v)) out.push({ v: h, l: h, on: act('instance', h), type: 'instance', sub: true, count: icnt.get(h) || 0 });
          }
        }
        // #253: 「サイト」――プラットフォームを持たないレコードは、「プラット
        // フォーム無し」という1つの受け皿バケットではなく、解決できるホストごと
        // に行を持つ（先頭の 'www.' は畳み込む。eTLD+1 は畳み込まない――それには
        // public-suffix リストが要る。Issue の却下案の注記を参照）。投稿がここで
        // 数えられるのは platform を持たないときだけ（重複排除の規則: 上段の
        // platform 行と下段のドメイン行の両方に載ることは決してない）。
        const stripWww = (h: string) => h.replace(/^www\./, '');
        const domainOf = (p: HologramPost): string => (p.platform ? '' : stripWww(hostOf(p.url)));
        const dcnt = facetCounts((p) => domainOf(p) || null);
        const domains = new Set<string>();
        for (const p of allPosts()) {
          const d = domainOf(p);
          if (d) domains.add(d);
        }
        for (const d of [...domains].sort((a, b) => (dcnt.get(b) || 0) - (dcnt.get(a) || 0) || a.localeCompare(b))) {
          out.push({ v: d, l: d, on: act('domain', d), type: 'domain', facetDim: true, count: dcnt.get(d) || 0 });
        }
        // 「出自なし」= 解決できる出自が一切無いレコード（URL が無い、または
        // パースできない）＝移行でインポートされた画像など（#85/#84）。
        // プラットフォームを持たないがドメインは持つレコードが上で自分の行を
        // 得るようになった今、旧来の「プラットフォーム無し」バケットより狭い。
        // それでも 'platform'/'__none' の葉として運ばれる（このプロジェクトは
        // リリース前＝docs/射程.md の「採否の物差しに使わないもの」を参照。
        // だからこの番兵が何を数えるかを再定義しても移行は要らない）。一致
        // 判定の述語は query.ts ではなく query-builder.ts にある――今回の
        // ファイル分割は #180 を query.ts/extension/ から遠ざけているので、
        // '__none' 用の platform 葉の述語拡張と新しい 'domain' 葉タイプは
        // どちらもその配線層にある。
        if (allPosts().some((p) => !p.platform && !hostOf(p.url))) {
          const noneCnt = facetCounts((p) => (!p.platform && !hostOf(p.url) ? '__none' : null));
          out.push({ v: '__none', l: t('qfSiteNone'), on: act('platform', '__none'), count: noneCnt.get('__none') || 0 });
        }
        return out;
      }
      case 'postType': {
        const cnt = facetCounts((p) => {
          const a: string[] = [];
          if (!p.isReply && !p.isQuote && !p.isThread) a.push('post');
          if (p.isReply) a.push('reply');
          if (p.isQuote) a.push('quote');
          if (p.isThread) a.push('thread');
          return a;
        });
        return [
          ['post', t('qfPost')],
          ['reply', t('qfReply')],
          ['quote', t('qfQuote')],
          ['thread', t('qfThread')],
        ].map(([v, l]) => ({ v, l, on: act('postType', v), count: cnt.get(v) || 0 }));
      }
      case 'media': {
        const cnt = facetCounts((p) => p.mediaType);
        const out: HologramQfRow[] = [
          ['image', t('qfImage')],
          ['video', t('qfVideo')],
          ['gif', t('qfGif')],
        ].map(([v, l]) => ({ v, l, on: act('media', v), count: cnt.get(v) || 0 }));
        // （「複数画像」はかつて __multi としてここに畳み込まれていたが、今は
        //  サイドバーの第一級トグル行になっている――viewer.js の
        //  setupMultiSidebar――ので、Media フライアウトはレコードごとの media
        //  種別 image/video/gif だけに戻っている。）
        // #365: media を一切持たないレコード（テキストのみの投稿）用の4番目の
        // 行――上の「プラットフォーム無し」「タグ無し」と同じ形の '__none'
        // 番兵で、同じ「実際に埋まるときだけ一覧に出す」規則に従う。mediaType
        // だけではこれらを見つけられない（query.ts の hasVisualMedia の doc
        // コメント参照）。
        if (allPosts().some((p) => !hasVisualMedia(p))) {
          const noneCnt = facetCounts((p) => (!hasVisualMedia(p) ? '__none' : null));
          out.push({ v: '__none', l: t('qfMediaNone'), on: act('media', '__none'), count: noneCnt.get('__none') || 0 });
        }
        return out;
      }
      case 'poster-tag': {
        // ポスターモードのサイドバータグフィルタ: 投稿者に適用された一般
        // （kind 無し）タグを一覧する。Work/Character は自分専用の行を持つ。
        // 1つ選ぶと post クエリではなくポスタークエリの木（posterQB）にタグの
        // 葉を追加・削除する。"on" = すでに選ばれている。#810 以来、実体単位
        // かつ実効集合について＝上の post 側とまったく同じ: 同名の2つの
        // ポスタータグは2行になり、親タグはその子タグだけが付いた投稿者
        // からも行（と件数）を得る。
        const cnt = facetCounts((u) => posterTagEntriesOf(u.key).map(entryKey), filteredPosters());
        return posterFilterVocab()
          .filter((e) => !entryKind(e))
          .map((e) => posterTagRow(e, cnt))
          .sort(byTagCount);
      }
      case 'poster-work':
      case 'poster-character': {
        // Work/Character の行: Kind が一致するポスタータグ。一般の Tags 行と
        // 同じタグの葉タイプへ写像される。kind はこのフライアウトがどれを
        // 提示するかを絞るだけ。
        const kind = cat === 'poster-work' ? 'work' : 'character';
        const cnt = facetCounts((u) => posterTagEntriesOf(u.key).map(entryKey), filteredPosters());
        return posterFilterVocab()
          .filter((e) => entryKind(e) === kind)
          .map((e) => posterTagRow(e, cnt, { kind }))
          .sort(byTagCount);
      }
      case 'poster-platform': {
        const present = new Set<string>(
          namedPosters()
            .map((u) => u.platform)
            .filter(Boolean),
        );
        const cnt = facetCounts((u) => u.platform, filteredPosters());
        return [...present]
          .sort((a, b) => {
            const ia = PF_ORDER.indexOf(a),
              ib = PF_ORDER.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
          })
          .map((v) => ({ v, l: PF_NAME[v] || v, on: posterQHasValue('platform', v), count: cnt.get(v) || 0 }));
      }
      case 'poster-instance': {
        const hosts = new Set<string>();
        for (const u of namedPosters()) if (u.instance) hosts.add(u.instance);
        const cnt = facetCounts((u) => u.instance, filteredPosters());
        return [...hosts].map((h) => ({ v: h, l: h, on: posterQHasValue('instance', h), count: cnt.get(h) || 0, facetDim: true })).sort((a, b) => b.count - a.count || a.l.localeCompare(b.l));
      }
      case 'poster-folder': {
        // #23 St1: その投稿者のグループが束ねるすべての posterKey にわたる
        // 和集合として読む（設計: 「poster-folders も同型」＝poster-tags の
        // 和集合読み取りと）＝この投稿者が1行になる前の、その後マージされた
        // 副次キーの下に記録されたフォルダのトグルも、なお数える。
        const folders = posterFolders();
        const cnt = facetCounts((u) => {
          const keys = membersOf(u.key);
          return folders.filter((f) => keys.some((k) => f.items.includes(k))).map((f) => f.id);
        }, filteredPosters());
        return folders.map((f) => ({ v: f.id, l: f.name, on: posterQHasValue('folder', f.id), count: cnt.get(f.id) || 0 }));
      }
      case 'work':
      case 'character': {
        // 用語集（Phase 2 ②）: Work/Character のセクションは Kind が一致する
        // タグを一覧する。それらは（type:'tag' の）本物のタグなので、1つ
        // 選ぶと普通のタグフィルタが加わる――kind はこのフライアウトが
        // どのタグを提示するかを絞るだけ。
        // Kind は #810 以来、実体単位で検索される（`kind` は tags 行の1
        // カラム）ので、同名の2つのタグが違うセクションに分かれることが
        // ある――一方は Work、もう一方は下の一般 Tags 行に。
        const cnt = facetCounts((p) => tagEntriesOf(p).map(entryKey));
        return (
          tagVocab()
            .filter((e) => entryKind(e) === cat)
            .map((e) => tagRow(e, cnt, { type: 'tag' }))
            // ファセットの順序: 今の結果に存在する値を先に（件数降順）、
            // 不在の値は下へ沈める（グレー表示だが選べる）。
            .sort(byTagCount)
        );
      }
      case 'tag': {
        // SNS の投稿だけでなく、全投稿（url を持たないインポート画像も含む）
        // のタグを含める。用語集: kind を持つタグは Work/Character 行に住む
        // ――Tags フライアウトは一般タグのみ。タグを一切持たない投稿は
        // '__none' 番兵の下でバケットに入る――上の「プラットフォーム無し」と
        // 同じ形で、query.ts もこの値を同じように特別扱いする。
        const cnt = facetCounts((p) => {
          const entries = tagEntriesOf(p);
          return entries.length ? entries.map(entryKey) : '__none';
        });
        const out = tagVocab()
          .filter((e) => !entryKind(e))
          .map((e) => tagRow(e, cnt))
          .sort(byTagCount);
        // 「タグ無し」= タグが空の投稿。連鎖的なタグ付けの入り口なので、
        // 件数順のランキングに混ぜるのではなく先頭に固定する（GitHub の
        // Labels ドロップダウンが Unlabeled を先頭に置くのと同じ形。
        // 「プラットフォーム無し」は逆に末尾に置く＝そちらでは入り口ではなく
        // 端のケースだから）。0件なら表示しない――つまり、選んでも空になる
        // だけの項目は一覧に出さない――platform 側と同じ。
        if (allPosts().some((p) => !(p.tags || []).length)) out.unshift({ v: '__none', l: t('qfTagNone'), on: act('tag', '__none'), count: cnt.get('__none') || 0, facetDim: true });
        return out;
      }
      case 'folder': {
        // ライブラリのフォルダ（folders.json）。各行は 'folder' の葉をトグル
        // する。行はパスでラベル付けされ、サブツリー全体にわたって数える。
        // それが行を選ぶことの意味だから（#41）: 親はその下のすべてを表す。
        // 直接のメンバーだけを数えると、実際には12件の投稿を表示する行の
        // 隣に0が出てしまう――数字はクリックが意味することと同じでなければ
        // ならない。
        const folders = postFolders();
        const byId = new Map(folders.map((f) => [f.id, f]));
        const kidsOf = new Map<string | null, HologramFolder[]>();
        for (const f of folders) {
          const p = f.parentId || null;
          const arr = kidsOf.get(p);
          if (arr) arr.push(f);
          else kidsOf.set(p, [f]);
        }
        // メモ化されたボトムアップの和集合。集合は再帰の前に登録されるので、
        // 何らかの理由で循環を持つファイルでも、描画をハングさせるのでは
        // なく（部分的な答えのまま）終了する。
        const deep = new Map<string, Set<string>>();
        const itemsDeep = (f: HologramFolder): Set<string> => {
          const hit = deep.get(f.id);
          if (hit) return hit;
          const s = new Set<string>(f.items || []);
          deep.set(f.id, s);
          for (const k of kidsOf.get(f.id) || []) for (const c of itemsDeep(k)) s.add(c);
          return s;
        };
        const pathOf = (f: HologramFolder) => {
          const parts: string[] = [];
          const seen = new Set<string>();
          let cur: HologramFolder | undefined = f;
          while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            parts.unshift(cur.name);
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
          }
          return parts.join(' / ');
        };
        const cnt = facetCounts((p) => folders.filter((f) => itemsDeep(f).has(p.captureId)).map((f) => f.id));
        return folders.map((f) => ({ v: f.id, l: pathOf(f), on: act('folder', f.id), count: cnt.get(f.id) || 0 }));
      }
      case 'hashtag': {
        const cnt = facetCounts((p) => p.hashtags);
        const counts: Record<string, number> = {};
        allPosts().forEach((p) =>
          (p.hashtags || []).forEach((h: string) => {
            counts[h] = (counts[h] || 0) + 1;
          }),
        );
        return Object.keys(counts)
          .sort((a, b) => counts[b] - counts[a])
          .map((h) => ({ v: h, l: '#' + h, on: act('hashtag', h), count: cnt.get(h) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count);
      }
      case 'user': {
        // #23 St1: buildUsers() はすでにプライマリキーへ畳み込み済みなので、
        // 件数のバケットも同じ解決済みの値でキー付けしなければならない。
        // さもないと、マージ済み投稿者の件数はグループの合計ではなく自分の
        // 生の投稿だけを常に映すことになる。
        const cnt = facetCounts((p) => resolve(userKey(p)));
        return buildUsers()
          .sort((a, b) => b.count - a.count)
          .slice(0, 100)
          .map((u) => ({ v: u.key, l: u.displayName || u.screenName || '(unknown)', sn: u.screenName, on: act('user', u.key), count: cnt.get(u.key) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count || (a.l || '').localeCompare(b.l || '', 'ja'));
      }
      case 'instance': {
        const cnt = facetCounts((p) => (p.platform === 'misskey' || p.platform === 'mastodon' ? hostOf(p.url) : null));
        const hosts = new Map<string, number>();
        for (const p of allPosts()) {
          if (p.platform !== 'misskey' && p.platform !== 'mastodon') continue;
          const h = hostOf(p.url);
          if (h) hosts.set(h, (hosts.get(h) || 0) + 1);
        }
        return [...hosts.keys()]
          .sort()
          .map((h) => ({ v: h, l: h, on: act('instance', h), count: cnt.get(h) || 0, facetDim: true }))
          .sort((a, b) => b.count - a.count || a.l.localeCompare(b.l));
      }
      default:
        return [];
    }
  }

  return { facetCounts, qfValues };
}

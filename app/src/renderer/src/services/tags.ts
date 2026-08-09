// タグ語彙／kind ドメインサービス＝タグストアに対する読み取り側の導出:
// tagKindOf/kindLabel（kind 検索＋改名可能なラベル）、groupedTagVocab
// （post/poster それぞれのスコープに対するピッカーのセクション分けされた語彙）、
// inspectorTagPickerData（React のタグエディタ用の、共起サジェスト階層を含む
// 完全なデータ一式）、posterTagsOf/posterFilterVocab（投稿者に適用された
// タグ）、そして sameTags＝viewer.js から1:1で抽出した、viewer 分解
// （最終形B）における8番目の「純粋ロジック→サービス」切り出し。makeTags の
// 純粋な導出は今もすべてのストアを注入された getter として受け取る（シグネチャ
// は変えていない＝Node の単体テストがこれらを直接スタブする）が、viewer.js が
// 渡す getter は今では viewer.js 自身の `let` ではなく「このモジュール自身の
// 状態」を指す（P4「state→store」の tags 切り出し、2026-07-08）: tagTypes/
// tagLabels/posterTags はサービスの唯一の正本としてここへ移り、ディスクへ
// 永続化して onChange 経由で購読者へ通知するミューテータ（setTagKind/
// setKindLabel/setPosterTags/applyPosterTagRecords）を持つ＝これでこれは
// 「購読可能な tags サービス」になっている。
// viewer.js は周辺のビジネスロジック（undo の記録、インスペクタの更新、確認
// ダイアログ越しの同名異体の区別）を持ち続け、マップを自分で変更する代わりに
// これらのミューテータを呼ぶ。まだ誰も onChange 経由では購読していない
// （viewer.js は今も変更のたびにサイドバーのモデルを明示的に push し直して
// いる）＝これが存在するのは、後の切り出し（サービスから自己導出する
// サイドバー）が購読できる何かを持てるようにするため。実体は本物の ES
// モジュール（named exports）で、viewer.ts / sidebar.ts と Sidebar
// コンポーネントから直接 import される。DOM には一切触れない。読み取り側の
// tagKindOf/posterFilterVocab も、viewer.ts が起動時に結び付ける生きた束縛
// （下）として公開されるので、sidebar.ts は同じ閉包を読む。ディスクとの
// 往復は hologramIpc（services/ipc.ts）を経由する。
import { hologramIpc } from './ipc.ts';
import type { PosterTagRow, TagTypeRow } from '../../../main/ipc-payloads.ts';

// #86: alias -> 正式名、起動時に一度だけ読み込み（下の readTagAliasMap）、
// writeTagTypes の兄弟リスナーがすでに反応している同じ 'tag-types' の
// org-changed 信号で再読み込みする（add/remove-tag-alias の IPC ハンドラも
// 同じ kind を送る＝ipc-tag-vocab.ts の notifyTagVocabChanged 参照）。
// tagTypes には畳み込まず、自分専用のモジュールレベルのストアとして持って
// いる＝tagKindOfName と同じ理由で、これは終始「名前」の空間だから: alias は
// 入力された文字列が入力された文字列に解決されるものであって、実体 id では
// 決してない。
let tagAliasMap: Map<string, string> = new Map();
// 逆引き索引（正式名 -> それを指すすべての alias）＝ピッカーが、利用者の
// クエリにどの alias が一致したかを提案へ注釈するのに要る。tagAliasMap と
// 一緒に作り直すので、2つがずれることはない。
let aliasesByCanonical: Map<string, string[]> = new Map();
export const getTagAliasMap = () => tagAliasMap;
function setTagAliasMap(m: Map<string, string>) {
  tagAliasMap = m;
  const rev = new Map<string, string[]>();
  for (const [alias, canonical] of m) {
    const list = rev.get(canonical);
    if (list) list.push(alias);
    else rev.set(canonical, [alias]);
  }
  aliasesByCanonical = rev;
}
async function readTagAliasMap(): Promise<Map<string, string>> {
  try {
    const rows = await hologramIpc.getTagAliases();
    return new Map(rows.map((r) => [r.alias, r.canonicalName]));
  } catch {
    return new Map();
  }
}

// #810: Kind ストアはタグの実体（tags.id）でキー付けされ、名前ではない＝
// `kind` は tags 行の1カラムなので、同じ名前を共有する2つのタグが異なる kind
// を持ちうる（#777 の分割がまさにそれを作る）。旧来の {name: kind} マップは
// 読み取り時に2つ目を隠し、次の書き込みでそれを消してしまっていた。
//
// これにより kind 検索は2つに分かれ、呼び出し側がどちらを求めるかは、その
// 呼び出しがどちらの空間で動いているかに従う:
//
//   tagKindOf(tagId)     ＝実体空間。すでにどの tags 行を持っているか知って
//     いるもの: ファセット行（#774 でこれらは実体単位になった）、投稿者フィルタ
//     の語彙、id をレコードに持つ右クリックしたチップ。
//   tagKindOfName(name)  ＝名前空間、「この名前を持つ実体のどれかが kind を
//     持っているか」。タグエディタは構造的に名前空間である（文字列を入力し、
//     書き込みがそれを1行へ解決する）ので、ピッカーの語彙と共起サジェスト
//     ――入力が入力された名前で、出力が入力すべき名前――はここに留まる。
//     これらを実体単位に精密化すると、1つのピッカーに同じ文字列が2回並び、
//     どちらの行も同じ名前を書き込むことになってしまう。
export type TagTypeStore = Record<number, TagTypeRow>;
export type PosterTagStore = Record<string, PosterTagRow>;

// deps の契約:
//   tagTypes() / tagLabels() / posterTags() / allPosts() —
//     getter（viewer が読み込み／インポート時にこれらの let を再代入する）
//   t(key,subs?) — i18n メッセージ検索（getMessage。内部では t18n という
//     別名＝このファイルはタグ文字列のループ変数として裸の `t` を随所で使うため）
//   charCandidatesFor(workTags) / relatedTagCandidates(sel, opts) — cooc.js
//     の産物（遅延アロー関数＝配線ポイントの後で const を宣言している）
//   membersOf(key) — services/aliases.ts（#23 St1）、任意。マージ済み投稿者の
//     タグは、そのグループが束ねるすべての posterKey にわたる和集合として
//     読む（設計: 「poster-tags は読みは membersOf の union・書きは primary へ
//     一本化」）＝書き込み側はここでの変更を要しない: すべての呼び出し元は
//     すでに buildUsers() の u.key を渡していて、#23 の buildUsers の畳み込みが
//     入れば、それは常にプライマリになる。そのため素の setPosterTags(key, …)
//     はすでにプライマリに着地する。無指定／既定は恒等（[key] のみ）＝
//     グループを持たない投稿者は今までどおりに読める。
export function makeTags(deps: {
  tagTypes(): TagTypeStore;
  tagLabels(): Record<string, string>;
  posterTags(): PosterTagStore;
  allPosts(): HologramPost[];
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  charCandidatesFor(workTags: string[]): Array<[string, number]>;
  relatedTagCandidates(selectedTags: string[], opts?: { exclude?: Set<string> | null }): Array<{ tag: string; withTag: string | null; count: number }>;
  membersOf?(key: string): string[];
}) {
  const { tagTypes, tagLabels, posterTags, allPosts, t: t18n, charCandidatesFor, relatedTagCandidates, membersOf } = deps;
  const KIND_LABEL: Record<string, string> = { work: t18n('kindWork'), character: t18n('kindCharacter') }; // resolved once at load

  function tagKindOf(tagId: number | null | undefined): string | null {
    if (tagId == null) return null;
    return tagTypes()[tagId]?.kind || null;
  }
  // 名前空間の検索（ヘッダー参照）: 「この名前で呼ばれる実体のどれかが kind を
  // 持っているか」。呼ぶたびに作り直すのではなくストアのオブジェクトに
  // メモ化している＝サジェストの階層は投稿ごと・タグごとにこれを1回呼ぶ。
  // 下のミューテータはすべてストアをその場で変更せず置き換えるので、identity
  // チェックが有効な陳腐化テストになる。
  let byName: { src: TagTypeStore; map: Map<string, string> } | null = null;
  function kindByName(): Map<string, string> {
    const src = tagTypes();
    if (byName && byName.src === src) return byName.map;
    const map = new Map<string, string>();
    for (const row of Object.values(src)) if (row && !map.has(row.name)) map.set(row.name, row.kind);
    byName = { src, map };
    return map;
  }
  function tagKindOfName(tag: string): string | null {
    return kindByName().get(tag) || null;
  }
  function kindLabel(kind: string): string {
    const labels = tagLabels();
    return (labels && labels[kind]) || KIND_LABEL[kind] || '';
  }

  // 1人の投稿者のタグ実体を、フィルタ側がそれを読む形で（#810）: 実効集合＝
  // #774 以来の投稿と同様に、子タグだけが付いた投稿者もその親に答える。id が
  // 使えない行（タグ編集とその書き込みが戻ってくる間の楽観的な状態）は、id
  // 無しの生の名前へ落ちる＝読み手はそこから名前で一致判定する。それが、id が
  // わからない投稿者にとっての正しい答え。
  function entriesOfRow(row: PosterTagRow | undefined): HologramTagEntry[] {
    if (!row) return [];
    const ids = Array.isArray(row.effectiveTagIds) ? row.effectiveTagIds : [];
    if (ids.length) {
      const names = Array.isArray(row.effectiveTags) ? row.effectiveTags : [];
      const labels = Array.isArray(row.effectiveTagLabels) ? row.effectiveTagLabels : [];
      return ids.map((id, i) => ({ id, name: names[i] || '', label: labels[i] || names[i] || '' }));
    }
    return (Array.isArray(row.tags) ? row.tags : []).map((name) => ({ id: null, name, label: name }));
  }

  // 投稿者が持つ生の名前＝インスペクタのタグ欄が表示・編集するもの。あえて親子
  // 関係の影響を受けない（#21 の規則: データは常に利用者が付けたものだけ）ので、
  // 規則を取り除けばその効果も取り除かれる。
  function posterTagsOf(key: string): string[] {
    const members = membersOf ? membersOf(key) : [key];
    if (members.length === 1) {
      const row = posterTags()[members[0]];
      return row && Array.isArray(row.tags) ? row.tags : [];
    }
    const set = new Set<string>();
    for (const m of members) for (const t of posterTags()[m]?.tags || []) set.add(t);
    return [...set];
  }
  // 同じ和集合の読み取りを実体空間で行う＝投稿レコードの
  // effectiveTagIds/effectiveTags/effectiveTagLabels の投稿者側にあたるもの。
  function posterTagEntriesOf(key: string): HologramTagEntry[] {
    const members = membersOf ? membersOf(key) : [key];
    const out: HologramTagEntry[] = [];
    const seen = new Set<string>();
    for (const m of members)
      for (const e of entriesOfRow(posterTags()[m])) {
        const k = e.id != null ? 'i:' + e.id : 'n:' + e.name;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    return out;
  }
  // 少なくとも1人の投稿者に実効的に適用されているタグ実体＝フィルタが提示する
  // 語彙。実体ごとに1行（#810）: 同名の2つのタグは2行になり、ラベルで見分ける
  // （#774 の「name(displayParentName)」）。kind を持つ（Work/Character）タグは
  // 残す（kind のドットで区別する）。順序は kind（Work → Character →
  // General）、次に ja の照合順序で、フライアウトがパレットと同じ読み方になる
  // ようにする。
  function posterFilterVocab(): HologramTagEntry[] {
    const m = new Map<string, HologramTagEntry>();
    for (const row of Object.values(posterTags()))
      for (const e of entriesOfRow(row)) {
        const k = e.id != null ? 'i:' + e.id : 'n:' + e.name;
        if (!m.has(k)) m.set(k, e);
      }
    const rank = (e: HologramTagEntry) => {
      const k = e.id != null ? tagKindOf(e.id) : tagKindOfName(e.name);
      return k === 'work' ? 0 : k === 'character' ? 1 : 2;
    };
    return [...m.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'ja'));
  }

  // kind でセクション分けされたタグ語彙: 先に Work/Character の kind セクション、
  // 次に未分類（kind を持たない適用済みタグ）。インスペクタのタグ欄と一括タグ
  // ダイアログ（inspectorTagPickerData 経由）が共有する。どちらも入力中は
  // ローカルにフィルタする。
  //
  // 終始「名前」の空間（#810）: これはピッカーの語彙で、行を選ぶとその文字列が
  // タグ欄に入力される＝だからリストは文字列のもので、2つの実体が同じ名前を
  // 共有していても別個の名前ごとに1行（別々の実体でも同じ値を書き込む同一の
  // 行が2つになる）。その書き込みがどの実体に着地するかは書き込み経路の問題で
  // あって、この一覧の問題ではない。
  function groupedTagVocab(opts?: { scope?: 'post' | 'poster' } | null): Array<{ name: string; tags: string[] }> {
    const scope = (opts && opts.scope) || 'post';
    const byJa = (a: string, b: string) => a.localeCompare(b, 'ja');
    const out: Array<{ name: string; tags: string[] }> = [];
    // 用語集: Work/Character は第一級のカテゴリ＝未分類より前に独自のセクション
    // として出し、kind を持つタグは未分類から抜き出す。各タグが1回だけ表示される
    // ように（kind が優先される、danbooru 式）。
    const kindSec: Record<string, string[]> = { work: [], character: [] };
    for (const [t, k] of kindByName()) if (k === 'work' || k === 'character') kindSec[k].push(t);
    for (const [k, name] of [
      ['work', kindLabel('work')],
      ['character', kindLabel('character')],
    ]) {
      const tags = kindSec[k].sort(byJa);
      if (tags.length) out.push({ name, tags });
    }
    // ポスタースコープは Work/Character を共有する（タグの kind はその文字列の
    // グローバルな属性）が、一般プールは分けて持つ: 投稿に適用されたタグは
    // 投稿内容を説明するものであり、人物には意味を持たない。ポスターの一般
    // プールは代わりに投稿者に適用されたタグ（posterTags）から育つので、
    // 人物は自分専用の語彙を持つ。
    const applied = new Set<string>();
    if (scope === 'poster') {
      for (const row of Object.values(posterTags())) for (const t of Array.isArray(row?.tags) ? row.tags : []) if (!tagKindOfName(t)) applied.add(t);
    } else {
      for (const p of allPosts()) for (const t of Array.isArray(p.tags) ? p.tags : []) if (!tagKindOfName(t)) applied.add(t);
    }
    // #86: 足がかりが alias しかない（今のところ直接の使用が0件の）タグでも
    // 一般プールに属する――AI 語彙ブリッジのケース（モデルの英語出力が日本語の
    // タグへ alias される）は、まだ何にも適用されていないかもしれない正式な
    // タグを指す。kind を持つタグはすでに使用状況に関わらず上に現れる
    // （kindByName は適用済みの投稿ではなく tagTypes を読む）ので、これは
    // kind の無いプールについて同じ穴を埋める。
    const generalSet = new Set(applied);
    for (const canonical of tagAliasMap.values()) if (!tagKindOfName(canonical)) generalSet.add(canonical);
    const general = [...generalSet].sort(byJa);
    if (general.length) out.push({ name: t18n('tagUncategorized'), tags: general });
    return out;
  }

  // ピッカー（groupedTagVocab/charCandidatesFor）と同じ語彙の中身を、React の
  // タグエディタ向けにデータの形へ整えたもの＝そちらは自分のローカルなクエリで
  // クライアント側にフィルタするので、キー入力がここを往復することは決して
  // ない。
  function inspectorTagPickerData(selectedTags: string[] | null | undefined, recordsForSource: HologramPost[] | null | undefined, scope?: string) {
    const sel = new Set<string>(selectedTags || []);
    // #86: 各項目は自分専用の alias 文字列を運ぶ（aliasesByCanonical、
    // setTagAliasMap によって tagAliasMap と同期している）＝これにより
    // TagField は、そうでなければ決して表に出ない語彙項目に対して入力された
    // alias を照合し、2度目の往復無しでそのヒットに注釈（「←ねこ」）を付け
    // られる。
    const vocabGroups = groupedTagVocab({ scope: (scope || 'post') as 'post' | 'poster' }).map((g) => ({
      name: g.name,
      items: g.tags.map((t) => ({ tag: t, kind: tagKindOfName(t) || null, aliases: aliasesByCanonical.get(t) })),
    }));
    const srcSet = new Set<string>();
    for (const r of recordsForSource || []) for (const h of Array.isArray(r.hashtags) ? r.hashtags : []) srcSet.add(h);
    const srcTagsForPicker = [...srcSet].map((t) => ({ tag: t, kind: tagKindOfName(t) || null }));
    // サジェストのグループ、強いものから先に。階層1（kind 限定）: カード上の
    // Work → キャラクター候補。階層2（汎用、post スコープのみ）: 選択中の
    // どれかのタグと投稿を共有することが多いタグ＝弱いヒントなので、kind を
    // 持つグループの下に置き、それと重複除去し、ペアに本物の裏付けがあるまで
    // 沈黙する（minCount は cooc.js にある）。ポスターへのタグ付けは階層1のみ
    // 保つ: その一般語彙は投稿内容の説明子とはあえて分けている
    // （groupedTagVocab 参照）。
    const coocGroups: any[] = [];
    const strong = new Set<string>();
    const workTags = [...sel].filter((t) => tagKindOfName(t) === 'work');
    if (workTags.length) {
      const cands = charCandidatesFor(workTags)
        .filter(([t]: [string, number]) => !sel.has(t))
        .slice(0, 8);
      if (cands.length) {
        const who = workTags.join('・');
        coocGroups.push({
          name: workTags.length === 1 ? t18n('editCoocCharsOf', [workTags[0]]) : t18n('editCoocChars'),
          items: cands.map(([t, n]: [string, number]) => ({ tag: t, title: t18n('editCoocWhy', [who, n]) })),
        });
        for (const [t] of cands) strong.add(t);
      }
    }
    if (scope !== 'poster') {
      const rel = relatedTagCandidates([...sel], { exclude: strong });
      if (rel.length) {
        coocGroups.push({
          name: t18n('editCoocRelated'),
          items: rel.map((r) => ({ tag: r.tag, kind: tagKindOfName(r.tag) || null, title: t18n('editCoocWhy', [r.withTag, r.count]) })),
        });
      }
    }
    // #86: フラットな alias マップ、TagField のフリーテキスト Enter 経路向け
    // （登録済みの alias を入力して確定すると正式名にスナップすべき＝ピッカーが
    // 従うのと同じ「確定するチップは正規名」の規則）――上の入れ子になった
    // vocabGroups の形を走査するより安上がりな、直接の文字列検索。
    return { vocabGroups, srcTagsForPicker, coocGroups, aliasMap: Object.fromEntries(tagAliasMap) };
  }

  return { tagKindOf, tagKindOfName, kindLabel, posterTagsOf, posterTagEntriesOf, posterFilterVocab, groupedTagVocab, inspectorTagPickerData };
}

export function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((t) => s.has(t));
}

// tagKindOf / posterFilterVocab の生きた束縛＝viewer.ts が起動時に一度だけ
// （自分の makeTags() 呼び出しの直後に）bindTagKindOf / bindPosterFilterVocab
// を通して結び付ける。これにより services/sidebar.ts の pull ソースは、この
// viewer インスタンスが組み立てるのと同じ閉包を読む（どちらもこの
// モジュール自身の getTagTypes()/getPosterTags() を閉じ込めているので、ずれる
// 2つ目の実装は無い）。viewer の結び付け呼び出しが走るまでは null＝それより
// 前に届いた pull は単に「まだデータが無い」と見えて、次の notify で再計算
// される。listing.ts の namedPosters と同じ生きた束縛の形。
export let tagKindOf: ((tagId: number | null | undefined) => string | null) | null = null;
export function bindTagKindOf(fn: (tagId: number | null | undefined) => string | null): void {
  tagKindOf = fn;
}
export let posterFilterVocab: (() => HologramTagEntry[]) | null = null;
export function bindPosterFilterVocab(fn: () => HologramTagEntry[]): void {
  posterFilterVocab = fn;
}

// --- 状態（3つのマップ。今はここが持つ＝ヘッダーコメント参照） ---
// tagTypes は tags.id で、posterTags は posterKey でキー付けされる（#810）。
// 下のミューテータはどれも、触るマップをその場で変更するのではなく置き換える
// ＝makeTags の名前空間メモはオブジェクトの identity を陳腐化テストに使う。
let tagTypes: TagTypeStore = {};
let tagLabels = {} as Record<string, string>;
let posterTags: PosterTagStore = {};
export const getTagTypes = () => tagTypes;
export const getTagLabels = () => tagLabels;
export const getPosterTags = () => posterTags;

// --- 購読者（下のどのミューテータが走った後にも通知される。まだ誰も聞いて
// いない＝ヘッダーコメント参照） ---
const subs: Array<(kind?: string) => void> = [];
function notify(kind?: string) {
  for (const cb of [...subs]) {
    try {
      cb(kind);
    } catch {
      /* 握りつぶす */
    }
  }
}
export function onChange(cb: (kind?: string) => void) {
  subs.push(cb);
  return () => {
    const i = subs.indexOf(cb);
    if (i >= 0) subs.splice(i, 1);
  };
}

// tag-types.json / poster-tags.json のディスク往復。
// 非公開――load() と下のミューテータだけがこれらを呼ぶ。ブラウザ側
// （viewer.js）からだけ呼ばれ、Node の単体テストからは一切呼ばれない。
// 通信路上では kind を持つ実体ごとに1行返ってくる（#810）。このモジュールは
// それらを id でキー付けするので、検索は O(1) で、同名の2行は2行のまま
// 残る。
async function readTagTypes(): Promise<{ types: TagTypeStore; labels: Record<string, string> }> {
  try {
    const r = await hologramIpc.getTagTypes();
    const types: TagTypeStore = {};
    for (const row of (r && r.types) || []) if (row && Number.isInteger(row.id)) types[row.id] = row;
    return { types, labels: (r && r.labels) || {} };
  } catch {
    return { types: {}, labels: {} };
  }
}
// 常に両方のマップを書き込むので、一方を書いても他方が落ちることはない
// （set-tag-types は受け取った labels しか保持しない）。name/label は
// 通信路上を手つかずのまま往復し、main はそれらを無視する――書き込みは
// (id, kind) の対。
async function writeTagTypes() {
  try {
    await hologramIpc.setTagTypes(Object.values(tagTypes), tagLabels);
  } catch {
    /* できる範囲で */
  }
}
async function readPosterTags(): Promise<PosterTagStore> {
  try {
    const r = await hologramIpc.getPosterTags();
    return (r && r.tags) || {};
  } catch {
    return {};
  }
}
// この書き込みは名前でキー付けされる（たった今入力されたタグはまだ id を
// 持たない――lib-db-write.ts の replacePosterTags 参照）ので、id と #774 の
// 実効集合を読み取りが運ぶには、書き込みから戻ってくる必要がある。
// 再読み込みがその手段: ミューテータが残す楽観的な行は名前だけを運び、
// それが届くまで読み手は名前一致にフォールバックする。ここでのどの呼び出し
// とも同じくできる範囲で――再読み込みに失敗しても、ストアはその名前のみの
// フォールバックのままになるだけ。
async function writePosterTags() {
  try {
    await hologramIpc.setPosterTags({ tags: posterTagNames() });
    posterTags = await readPosterTags();
    notify('poster');
  } catch {
    /* できる範囲で */
  }
}
function posterTagNames(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, row] of Object.entries(posterTags)) if (row && row.tags.length) out[key] = row.tags;
  return out;
}
// 編集とその書き込みが戻ってくる間、投稿者の行がどう見えるか: 利用者が
// たった今設定した名前で、id は無い。古いものを保つのではなく落とすのは、
// services/posts.ts の applyTagWrite が投稿に対して行うのと同じ判断――
// もう対応しなくなった配列は、無いよりも悪い。
function pendingPosterRow(tags: string[]): PosterTagRow {
  return { tags: tags.slice(), tagIds: [], effectiveTagIds: [], effectiveTags: [], effectiveTagLabels: [] };
}

// 起動時に、このサービス自身の状態へ読み込む（何度実行しても同じ――
// viewer.js の bootApp から一度呼ぶだけでよい。後の呼び出しは同じ promise
// を再利用する）。
let loadPromise: Promise<void> | null = null;
async function doLoad() {
  const [pt, tt, am] = await Promise.all([readPosterTags(), readTagTypes(), readTagAliasMap()]);
  posterTags = pt;
  tagTypes = tt.types;
  tagLabels = tt.labels;
  setTagAliasMap(am);
}
export function load() {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

// #32 St2: 別のウィンドウの set-tag-types／set-poster-tags が届いた――
// 実際に変わったドメインを（org-changed が発火する時点でディスク上には
// すでに反映されている）読み直し、このウィンドウ自身の購読者に通知する。
// folders.ts の org-changed リスナーが使うのと同じ「再読み込み＋通知」の形。
// できる範囲で: Node（単体テスト）にはブリッジが無い――このモジュールの
// どの hologramIpc 呼び出しもすでに使っているのと同じ握りつぶし。
try {
  hologramIpc.onOrgChanged(async (kind) => {
    if (kind === 'tag-types') {
      // #86: add/remove-tag-alias（ipc-tag-vocab.ts の
      // notifyTagVocabChanged）も、他のすべてのタグ語彙書き込みと同じ
      // この kind で中継されるので、alias マップはここですでに再読み込み
      // している kind ストアのすぐ隣で再読み込みされる。
      const [tt, am] = await Promise.all([readTagTypes(), readTagAliasMap()]);
      tagTypes = tt.types;
      tagLabels = tt.labels;
      setTagAliasMap(am);
      notify('kind');
    } else if (kind === 'poster-tags') {
      posterTags = await readPosterTags();
      notify('poster');
    }
  });
} catch {
  /* ブリッジ無し（Node の単体テスト） */
}

// --- ミューテータ: 永続化＋通知（viewer.js は自分でマップを変更する代わりに
// これらを呼ぶ。周辺のビジネスロジック――undo の記録、インスペクタの
// 更新、確認ダイアログ――は viewer.js に残る） ---
// #810: 1つのタグ実体を分類する。どの実体を意味するかは呼び出し側
// （kind-menu-builder.ts）が解決する――2つのタグが1つを共有しうる以上、
// 名前ではそれを決められない。その後の再読み込みは念のための保険では
// ない: `name`/`label` は DB が計算するもの（#774 の表示上の親の規則）で、
// 初めて分類されるタグは、この時点ではこのストアにどちらもまだ持って
// いない。
export async function setTagKind(tagId: number, kind: string | null) {
  const next: TagTypeStore = { ...tagTypes };
  if (kind) next[tagId] = { id: tagId, kind, name: next[tagId]?.name || '', label: next[tagId]?.label || '' };
  else delete next[tagId];
  tagTypes = next;
  await writeTagTypes();
  const tt = await readTagTypes();
  tagTypes = tt.types;
  tagLabels = tt.labels;
  notify('kind');
}
export async function setKindLabel(kind: string, label: string | null | undefined) {
  const v = (label || '').trim();
  const next = { ...tagLabels };
  if (v) next[kind] = v;
  else delete next[kind];
  tagLabels = next;
  await writeTagTypes();
  notify('kind');
}
// 単一の投稿者のタグ一覧（viewer.js の applyPosterTagChange）。
// tags===null はエントリをクリアする。永続化は fire-and-forget、移設前の
// 挙動と一致させている。
export function setPosterTags(key: string, tags: string[] | null) {
  const next: PosterTagStore = { ...posterTags };
  if (tags && tags.length) next[key] = pendingPosterRow(tags);
  else delete next[key];
  posterTags = next;
  writePosterTags();
  notify('poster');
}
// 一括適用（undo/redo）: records = [{key, tags}]、永続化は1回だけ。
export function applyPosterTagRecords(records: Array<{ key: string; tags?: string[] }>) {
  const next: PosterTagStore = { ...posterTags };
  for (const r of records) {
    if (r.tags && r.tags.length) next[r.key] = pendingPosterRow(r.tags);
    else delete next[r.key];
  }
  posterTags = next;
  writePosterTags();
  notify('poster');
}

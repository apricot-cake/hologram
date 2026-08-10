'use strict';

// API スキーマカナリア（#191）の純粋な核＝応答本体をその構造の「値を含まない」
// 記述へ変換し、前回実行時の記述と比較して、何が警報に値するかを判定する。
//
// なぜ値を含まないか: カナリアのスナップショットはリポジトリに置かれるが、応答
// 本体には投稿本文・表示名・サードパーティの断片が入っている。フィールドパス
// →型の木にはそれらが一切無いので、他のソースファイルと同じように diff で
// ベースラインをレビューできる（本文そのものは代わりに取得原本層＝#292 /
// ADR 0011 に属す。そちらはローカル限定）。
//
// ネットワークもファイルシステムも扱わない: 両方とも scripts/schema-canary.cts
// が持ち、このモジュールは判定だけを持つ。そのためどちらも無しに単体テストできる。

// パス→型の和。パスはドキュメントのルートなら ''、入れ子のオブジェクトの
// キーなら 'a.b'、配列の要素なら 'a[]'、MAP として使われるオブジェクトの
// 値なら 'a{}'（isMapObject を参照）。要素・値の形は統合されるので、異種混合の
// 配列や map は和として現れる。
type Shape = Record<string, string>;

// たまたま空だった配列は、その要素について何も語らない。パスが無いのではなく
// 独自の疑似型として記録するので、「空だった実行」と「フィールドが消えた」を
// 区別できる＝これが毎回の誤報と本物の警報の違いになる。
const UNKNOWN = 'unknown';
const TYPE_SEP = '|';

// missingStreak 内部のキー形式。コミットされるスナップショット JSON の中で
// 人が読めるように選んだ（このファイルは人が diff でレビューする前提）。
const STREAK_SEP = ' :: ';

// 1回の実行だけ消えたフィールドは、大抵はスキーマ変更ではなくプラットフォーム
// 自体の A/B テストか条件付きフィールドである。連続2回が #191 で求められた
// ヒステリシスで、再出現でカウンタはリセットされる。
const MISSING_STREAK_ALARM = 2;

// エンドポイント全体がリクエストされなくなった時（fetch の連鎖が別の分岐を
// 通った時）に使う予約パス。実在するフィールドパスではない＝'(' はここでは
// JSON のキーパスの先頭に来得ない。実在するパスは必ずキー名で始まるため。
const ENDPOINT_PATH = '(endpoint)';
const ENDPOINT_TYPE = 'present';

interface ShapeChange {
  path: string;
  types: string[];
}

interface ShapeDiff {
  // 前回の形にはあったが、今回は無い（または狭まった）。
  lost: ShapeChange[];
  // 前回は無く、今回はある。
  gained: ShapeChange[];
  // 片側で配列が空だったため、今回は比較が不可能だったパス。報告もされず、
  // 連続記録をリセットすることも許されない。
  unobservable: string[];
}

interface StreakEntry {
  path: string;
  type: string;
  count: number;
}

interface StreakOutcome {
  streak: Record<string, number>;
  // 確定: MISSING_STREAK_ALARM 回連続で不在が確認された。
  alarms: StreakEntry[];
  // 今のところ1回だけ不在＝静かに報告するだけで、まだ警報ではない。
  pending: StreakEntry[];
}

// 'a.b' / 'a[]' / 'a{}' は 'a' の配下にあるが、'ab' は違う。部分木がまるごと
// 現れた・消えた時に、最上位のパスだけを報告するために使う。
function isUnder(path: string, prefix: string): boolean {
  if (!prefix || path.length <= prefix.length || !path.startsWith(prefix)) return false;
  const next = path[prefix.length];
  return next === '.' || next === '[' || next === '{';
}

// キーそのものがスキーマではなくデータであるオブジェクト＝pixiv の
// `userIllusts`（作品 id をキーにする）、Misskey の `reactions`（絵文字を
// キーにする）。これをキーごとに走査すると、揮発性の高いパスが数千個
// スナップショットに入るうえ、キーが変わるたびに「フィールドが消えた」と
// 報告してしまう。代わりにそれらの値は '{}' という一つのパスに統合する。
// これがスキーマの実態を正しく表す。
//
// 判定は「フィールド名らしいキーが1つも無いこと」。安全側に倒してある:
// 普通に見えるキーが1つ（`like` のような Misskey の旧来のリアクション名）
// でもあれば、そのオブジェクトはレコード扱いのまま残る。これはノイズを
// 生むだけで済むが、逆に本物のレコードを畳んでしまうと、目的であるフィールド
// 単位の監視そのものを失うことになる。
const FIELD_NAME_KEY = /^[$A-Za-z_][$A-Za-z0-9_]*$/;
function isMapObject(keys: string[]): boolean {
  return keys.length > 0 && keys.every((key) => !FIELD_NAME_KEY.test(key));
}

function isUnderAny(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => isUnder(path, p));
}

// UNKNOWN は、そのパスに何か実在の型が分かった時点で捨てられる＝空配列は
// 情報を何も加えないので、'unknown|string' と 'string' は同じ知識である。
// どちらか一方の形だけを保つことで、あるサンプルの配列が1回空だっただけで
// スナップショットが揺れ動くことを防ぐ。
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
    // 空のオブジェクトは空の配列とまったく同じように中身を隠すので、同じ
    // 印を付ける。そうしないと空だった実行が「フィールドが消えた」と
    // 読めてしまう。
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

// 応答本体（JSON.parse 済み）→ Shape。キーの順序をソートしているので、
// コミットされるスナップショットは構造が変わった時だけ変化する。
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

// 2つの shape を比較する。部分木がまるごと消えた・現れた場合は最上位のパスだけを
// 報告する（そうしないと削除されたオブジェクトが子孫の数だけ行を生み、本当に
// 重要な1行が埋もれてしまう）。
function diffShapes(prev: Shape, next: Shape): ShapeDiff {
  // ソートしてあるので親は必ず子より先に訪問される（親のパスは子のパスの
  // 真の接頭辞なので、必ず先にソートされる）。
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
    // このパスは片側に存在するが、そこで運んでいた型はすべて UNKNOWN
    // だった＝空の配列。
    const prevEmpty = inPrev && before.size === 0;
    const nextEmpty = inNext && after.size === 0;
    // 両方とも空: 単に常に空リストであるフィールド。安定しているので報告する
    // ことは何もない＝報告してしまうと毎回同じ行が繰り返され、読み手が本当に
    // 重要な行まで読み飛ばす癖がつく。
    if (prevEmpty && nextEmpty) continue;
    // どちらか片側だけ空: もう片側が知っていることは、今回は確認も反証もできない。
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

// フィールドごとの不在カウンタを1つ進め、今回の不在を確定した警報とまだ
// 保留中の疑いに振り分ける。
//
// 確定した不在はカウンタのマップから外れる: 警報はすでに出されたので、
// この後 carryBaseline() が新しい shape をベースラインとして採用できる。
// 以後も毎回同じ警報を繰り返すと、読み手にそれを無視する癖をつけてしまう。
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
  // パスが観測不能になったカウンタは維持されるのであって、リセットされない:
  // 空の配列は、疑われていたフィールドが戻ってきた証拠にはならない。
  for (const [key, count] of Object.entries(prevStreak)) {
    if (key in streak) continue;
    const path = streakPath(key);
    if (diff.unobservable.includes(path) || isUnderAny(path, diff.unobservable)) streak[key] = count;
  }
  return { streak, alarms, pending };
}

// 次回実行のために保存する shape を組み立てる。通常は単に今回観測したものだが、
// その観測をそのまま採用するとカナリア自身の記憶を壊してしまう2つの場合は
// 例外:
//
//   - 疑い中のパス（不在だがまだ確定していない）は古いエントリを保つ。
//     そうしないと2回目の実行で不在が何も見えなくなり、連続記録が閾値に
//     到達できなくなる。
//   - 観測不能なパス（空の配列）は古いエントリを保つ。そうしないと空だった
//     1回の実行で、要素のパスがベースラインから永久に消えてしまう。
function carryBaseline(prev: Shape, next: Shape, diff: ShapeDiff, pending: StreakEntry[]): Shape {
  const keep = [...new Set([...diff.unobservable, ...pending.map((p) => p.path)])];
  const out: Shape = { ...next };
  for (const path of Object.keys(prev)) {
    if (!keep.includes(path) && !isUnderAny(path, keep)) continue;
    out[path] = joinTypes([...typeSet(prev[path]), ...typeSet(next[path])]);
  }
  return sortShape(out);
}

// fetch の連鎖がもうまったくリクエストしないエンドポイント。フィールドと
// 同じヒステリシスに乗るよう、普通の不在として表現する。
function endpointMissingDiff(): ShapeDiff {
  return { lost: [{ path: ENDPOINT_PATH, types: [ENDPOINT_TYPE] }], gained: [], unobservable: [] };
}

function isEndpointEntry(entry: { path: string }): boolean {
  return entry.path === ENDPOINT_PATH;
}

function labelPath(path: string): string {
  return path === '' ? '(root)' : path;
}

// --- どの投稿を観測するか（#464） ------------------------------------------
//
// サンプルは1つの投稿ではなく、候補となる投稿の一覧である。単独の公開投稿は
// いずれ死ぬもので、死んだ投稿を手で差し替える作業こそ、カナリアが存在する
// 理由である繰り返しの保守そのもの。候補を持てば、1つの死は静かに吸収され、
// 最後の1つが死んだ時だけ人手を要求する。

// 候補を試す順序。保存済みベースラインを生んだ URL は、一覧の先頭でなくても
// 必ず先頭に来る。
//
// 固着させるのが狙い: 一度失敗した候補（障害・レート制限・一時的なモデレー
// ション）のせいで、カナリアが2つの投稿の間を行ったり来たりしてはいけない。
// 行き来のたびに実行1回分の代償がかかる＝ベースラインは1つの投稿に属すもの
// なので、切り替えるとベースラインが作り直され、その回は何も比較しない。
function candidateOrder(urls: string[], previous?: string): string[] {
  if (!previous || !urls.includes(previous)) return [...urls];
  return [previous, ...urls.filter((url) => url !== previous)];
}

// 保存済みベースラインは1つの投稿を記述している。それを別の投稿と比較すると、
// 2つの投稿の差＝一方だけが持つ任意フィールドの有無を、スキーマの変動として
// 報告してしまう。これは誤報であり、候補という仕組みが無かった頃から起こり
// 得た: サンプルの URL を手で差し替えると、その後の実行が一度も消えていない
// フィールドに警報を出していた。
//
// そこでベースラインは、それを観測した URL の所有物とし、参照元が変われば
// 破棄する。切り替えた回はまっさらなベースラインを記録するだけで、何も
// 報告しない。まったく新しいサンプルの初回実行と同じ扱いになる。
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

// --- サンプルが「見えるはず」と宣言しているもの（#588） ----------------------
//
// ほとんどのサンプルは投稿を期待する。1種類だけ違う: X は削除・鍵付き・年齢
// 制限のかかった投稿に TOMBSTONE で答える＝投稿自体は存在するがその本文は
// 伏せられ、理由が tombstone.text.text の文言として運ばれる。Hologram は
// その文言を読んで3つの原因を見分けており、#505 以降は文言の「不在」自体が
// 年齢制限であるという判定になっている。つまり文言もその不在も、フィールド
// と同じ依存であり、同じ監視に値する。
//
// これまでは監視できなかった。extractor がレコードの構築を拒んだ応答は、
// 無条件に「このサンプルはもう無い＝人が別のものを探すべき」と読まれており、
// tombstone を削除済みサンプルと同じ箱に入れてしまっていた: tombstone を
// 登録すれば、その shape を一度も記録することなく、毎回永遠に障害として
// 報告し続けていたはずである。
//
// サンプルが tombstone を宣言すると、この読み方は逆転する。拒否こそが期待
// された答えなので、本文は shape の比較に進み、代わりに矛盾こそが警報になる:
// tombstone を宣言したサンプルが通常の投稿として返ってきたなら、鍵が外れた、
// 年齢制限が解除された、あるいはその id がサンプルの言う意味をもう指さなく
// なった、ということである。
const EXPECT_TOMBSTONE = 'tombstone';

interface ResponseFacts {
  // 本文が投稿そのものであるエンドポイントが、パース可能な JSON で答えた。
  primaryParsed: boolean;
  // extractor がその本文からレコードを構築するのを拒んだ理由。構築できた
  // なら ''。
  metaError: string;
  // 本物の投稿本文でしか運べないものが返ってきた。
  alive: boolean;
}
interface Verdict {
  // この候補からは何も観測できない。スキーマの信号ではない: 次の候補が
  // 試され、全候補がこれを言うなら人が候補を追加する必要がある。
  dead: boolean;
  reason: string;
  // サンプルは応答したが、その宣言が除外しているものが返ってきた。
  // 「死んでいる」わけではない＝何かを差し替える必要はなく、応答そのものが
  // 知らせるべきニュースである。
  alarm: string;
}

function judgeResponse(expect: string | undefined, facts: ResponseFacts): Verdict {
  if (expect === EXPECT_TOMBSTONE) {
    if (facts.alive) {
      return { dead: false, reason: '', alarm: 'tombstone が期待値のサンプルが通常の投稿として返ってきた（鍵が外れた・年齢制限が消えた・その id が別の投稿を指すようになった）' };
    }
    // 読み取れるものが何も返ってこなかった。これはエンドポイントが落ちている
    // のと区別が付かない＝どちらにしても比較すべき shape は無い。
    if (!facts.primaryParsed) return { dead: true, reason: 'tombstone が期待値だが応答の本体が読めない', alarm: '' };
    // 期待どおりの tombstone か、投稿でも tombstone でもない本文かのどちらか。
    // どちらも shape の比較に進む＝文言を失った tombstone こそが後者の場合
    // そのものであり、それを捕まえることこそがこの仕組みの目的である。
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

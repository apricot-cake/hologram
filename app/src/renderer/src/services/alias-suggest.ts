// ポスターの alias 候補サジェスト――#23 St2 の、判断を下さない順位付け＝
// どの投稿者が同じ著者／アカウントを指している可能性が高いかを示し、呼び
// 出し側（将来の UI 配線）がそれをマージ候補として提示できるようにする。
// 自分でマージすることは決してしない
// （「自動候補提案...自動マージはせず提案のみ」――2026-07-11 の設計、Issue の
// 段階2自身のタイトルでも再確認されている: 「決定的ルールの重み付け：
// ハンドル完全一致＞displayName正規化一致＞類似」）。
//
// 純粋ロジックで、副作用も IPC も無い――この Issue 自身が
// services/aliases.ts に残したヘッダー注記を鏡写しにしている
// （「自動候補（段階②）は副作用を持たない純ロジックとして alias-suggest.ts
// に分離＝ユニットで回せる」）。呼び出し側はすでに畳み込まれた投稿者を
// 渡す（既存の alias グループごとに1エントリ、例えば namedPosters() の
// HologramUserAgg[]――poster-grid-builder.ts の openAliasPicker() もすでに
// 同じやり方で「(unknown)」バケットを除外している）ので、既存グループの
// 2人のメンバーがここで2つの別々のエントリとして現れることは無い。この
// モジュールに独自の resolve()/membersOf() の配管があえて無いのはこの理由。
//
// 範囲の注記（2026-08-02、#23 St2 のラウンド）: このファイルが実装するのは
// 順位付けのアルゴリズムだけ。まだ「却下」の判断を永続化しない――下の
// isDismissed フックは、将来のラウンドが本物の却下リスト
// （services/aliases.ts 自身の 2026-07 のヘッダー注記がそのリストを「今回の
// ラウンド」向けに確保している）へ配線するための拡張ポイント。ただし
// それをきちんとやるには、新しい DB テーブル＋IPC＋preload＋ZIP
// エクスポート／インポートの配線が要る。#23 の St1 実装ノートが
// poster-aliases.json について説明しているのと同じ「6点セット」――純粋
// ロジックのみの切り出しの範囲外。UI での表出（インスペクタの操作、確認
// キュー）は #23 の段階③（「候補強化・確認キュー」）で、これもこのファイルの
// 範囲外。

import { normalize } from './search.ts';
import { distance } from 'fastest-levenshtein';

export type AliasSuggestReason = 'handle' | 'displayName' | 'similar';

/** このモジュールが実際に読む HologramUserAgg の部分集合――（環境にある
 * HologramUserAgg 型を import するのではなく）自分専用のローカルな形として
 * 持つことで、このファイルは呼び出し側が単独でユニットテストできる、
 * プレーンで依存の無いモジュールのままでいられる。 */
export interface AliasSuggestPoster {
  key: string;
  screenName: string;
  displayName: string;
}

export interface AliasSuggestPair {
  /** 2人の投稿者。同じ対は、呼び出し側の一覧でどちらの順だったかに関わらず
   * 常に同じ a/b を生むよう並べる（文字列でソート）。 */
  a: string;
  b: string;
  reason: AliasSuggestReason;
}

export interface AliasSuggestOptions {
  /** 却下して覚えておくフック（#23 St2 の設計: 「却下は dismissed に
   * 永続」）。このファイルではまだ本物のストレージに支えられていない――
   * 上のヘッダー注記を参照。既定は「何も却下されていない」。 */
  isDismissed?(a: string, b: string): boolean;
  /** 'similar' 階層のための、正規化された最小類似度（0..1、1が完全一致）。
   * これに正準の値は存在しない――実際のライブラリの実在するハンドル／
   * 表示名に照らして較正すべき調整つまみであって、確定した製品定数では
   * ない。0.82 はその較正が済むまでの最初の見当（典型的なハンドル／
   * 表示名の長さで、2、3文字の編集を許容する）。 */
  similarityThreshold?: number;
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.82;
// この正規化された長さを下回ると、編集距離の比率は意味を成すには荒れすぎる
// （「ai」対「bi」ですでに50%の「類似度」になってしまう）――候補ペアの
// トークン化された両端が、'similar' 階層に考慮される前にこれをクリアして
// いなければならない。
const MIN_SIMILAR_LEN = 3;

// screenName（「ハンドル」）の正規化は search.ts のアプリ全体のグリフ規則
// （NFKC 全角／半角、カタカナ→ひらがな、小文字化）を再利用し、さらに先頭の
// '@' を落とす――ハンドルはプラットフォーム／UI をまたいで、それを付けて
// 保存・表示されたり付けずに保存・表示されたりまちまちなので、一致判定の
// 手がかりにはならない。
function normHandle(s: string): string {
  const n = normalize(s);
  return n.startsWith('@') ? n.slice(1) : n;
}

function pairKeyOf(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}

// 1 = 完全一致、0 = 最大限に異なる（編集距離 == 長いほうの文字列の長さ）。
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0; // どちらも空――呼び出し側はこれを呼ぶ前にすでに MIN_SIMILAR_LEN でガードしている
  return 1 - distance(a, b) / maxLen;
}

// 本物の levenshtein 呼び出しのコストを払う前の、安上がりな事前フィルタ:
// distance(a,b) は2つの文字列の長さの差より小さくなることは決して無いので、
// similarity(a,b) は 1 - |lenA-lenB|/max(lenA,lenB) を超えることは決して
// 無い。その最良のケースですらしきい値に届かないときは、本物の distance()
// 呼び出しを丸ごと省く。
function couldMeetThreshold(lenA: number, lenB: number, threshold: number): boolean {
  const maxLen = Math.max(lenA, lenB);
  return maxLen > 0 && Math.abs(lenA - lenB) <= (1 - threshold) * maxLen;
}

/**
 * `posters` にわたるすべての候補ペア。それぞれ、一致した最も強い階層で
 * タグ付けされる（ハンドルと displayName の規則の両方に一致するペアは、
 * 'handle' として一度だけ報告される）。返る配列内の順序に意味は無い――
 * 呼び出し側が自分で `reason` によってソート／グループ化する。
 */
export function suggestPairs(posters: readonly AliasSuggestPoster[], opts: AliasSuggestOptions = {}): AliasSuggestPair[] {
  const isDismissed = opts.isDismissed ?? (() => false);
  const threshold = opts.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

  // 防御的な重複除去: 呼び出し側が誤って同じキーを2回渡すと、そうでなければ
  // 自己ペアになってしまう（下の emit() はすでに a===b をスキップするが、
  // 同じキーを共有する2つの別々の配列エントリはそれでも「別物」として
  // すり抜けてしまう）。
  const seenKeys = new Set<string>();
  const list = posters.filter((p) => {
    if (seenKeys.has(p.key)) return false;
    seenKeys.add(p.key);
    return true;
  });

  // すでにより強い階層で出力済みの（または明示的に却下された）ペア――
  // 下のより弱い階層は、どちらの場合も再浮上させてはいけない。
  const claimed = new Set<string>();
  const out: AliasSuggestPair[] = [];

  function emit(x: AliasSuggestPoster, y: AliasSuggestPoster, reason: AliasSuggestReason) {
    if (x.key === y.key) return;
    const [a, b] = pairKeyOf(x.key, y.key);
    const id = a + '\0' + b;
    if (claimed.has(id)) return;
    claimed.add(id);
    if (isDismissed(a, b)) return;
    out.push({ a, b, reason });
  }

  // 階層1: ハンドルの完全一致。
  const byHandle = new Map<string, AliasSuggestPoster[]>();
  for (const p of list) {
    const h = normHandle(p.screenName);
    if (!h) continue;
    let bucket = byHandle.get(h);
    if (!bucket) byHandle.set(h, (bucket = []));
    bucket.push(p);
  }
  for (const bucket of byHandle.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) emit(bucket[i], bucket[j], 'handle');
    }
  }

  // 階層2: displayName の正規化後の完全一致。
  const byDisplay = new Map<string, AliasSuggestPoster[]>();
  for (const p of list) {
    const d = normalize(p.displayName);
    if (!d) continue;
    let bucket = byDisplay.get(d);
    if (!bucket) byDisplay.set(d, (bucket = []));
    bucket.push(p);
  }
  for (const bucket of byDisplay.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) emit(bucket[i], bucket[j], 'displayName');
    }
  }

  // 階層3: similar――正規化された2つのフィールドのどちらか（良いほうの
  // 値）にわたる編集距離の比率。上の階層1/2がまだ出力していないペアが
  // 対象。O(n²) のペア数だが、これは必要になったときに動く（ホットな
  // 描画ループの経路ではない――手動ピッカーの候補一覧と同じ「サジェスト
  // 画面が開かれたときに計算する」というペース）。下の長さの差による
  // ショートサーキット（distance(a,b) は |len(a)-len(b)| より小さくなる
  // ことは決して無い）が、しきい値を決して満たせないペアについて
  // levenshtein 呼び出しを丸ごと省く。
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const x = list[i];
      const y = list[j];
      const [a, b] = pairKeyOf(x.key, y.key);
      if (claimed.has(a + '\0' + b)) continue;

      const hx = normHandle(x.screenName);
      const hy = normHandle(y.screenName);
      const dx = normalize(x.displayName);
      const dy = normalize(y.displayName);

      let best = 0;
      if (hx.length >= MIN_SIMILAR_LEN && hy.length >= MIN_SIMILAR_LEN && couldMeetThreshold(hx.length, hy.length, threshold)) {
        best = Math.max(best, similarity(hx, hy));
      }
      if (dx.length >= MIN_SIMILAR_LEN && dy.length >= MIN_SIMILAR_LEN && couldMeetThreshold(dx.length, dy.length, threshold)) {
        best = Math.max(best, similarity(dx, dy));
      }
      if (best >= threshold) emit(x, y, 'similar');
    }
  }

  return out;
}

/** 単一の対象投稿者に対する suggestPairs() の便利フィルタ（投稿者ごとの UI
 * 操作――例えばインスペクタのサジェスト行――が実際に消費するであろう形。
 * #23 の確認キュー（段階③）は代わりに suggestPairs() を直接使うことに
 * なる）。 */
export function suggestionsFor(key: string, posters: readonly AliasSuggestPoster[], opts?: AliasSuggestOptions): AliasSuggestPair[] {
  return suggestPairs(posters, opts).filter((p) => p.a === key || p.b === key);
}

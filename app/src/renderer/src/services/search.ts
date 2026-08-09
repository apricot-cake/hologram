// 共有の検索の道具＝スマート検索の照合はこれ1つ（P2④ で照合モードの切り替えを丸ごと
// 廃止した＝今はこの緩い照合しかない。旧 'searchMode' の設定と、完全一致／緩い一致の
// 切り替えは撤去済み）。
//
// 検索は次の3つの要素を組み合わせる:
//   B 表記ゆれの正規化 … 両側に NFKC（全角↔半角）とカタカナ→ひらがなの統一、小文字化を
//                        かける
//   A 部分列           … 文字が順に現れれば一致とする（部分入力や絞り込み向けの、緩い一致）
//   C 編集距離         … 近似部分文字列の照合（Sellers のアルゴリズム）で打ち間違い
//                        （置換・挿入・削除）を許す
//   → 正規化の後、各語を「A または C」で判定し、空白で区切った語をすべて AND でつなぐ。
//
// 本物の ES モジュール（名前付きの export）＝orchestrator と query-builder.ts が直接
// import する。

import { toKana } from 'wanakana';

// カタカナ（U+30A1..U+30F6）→ ひらがな（U+3041..U+3096）。長音符 ー などはそのまま残す。
function kataToHira(s: string) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : s[i];
  }
  return out;
}

// 表記ゆれの正規化（B）。NFKC が全角英数→半角、半角カナ→全角カナなどを吸収し、そのあと
// 濁点・半濁点を落とし（が→か、ぱ→は）、小文字化とカナの統一をかける。
// NFKC → NFD の順序は必須（先に NFD をかけると、半角カナの互換分解と干渉する）。剥がすのは
// 結合用の濁点・半濁点だけで、最後に NFC へ戻す＝つまりラテン文字のダイアクリティカルマーク
// （é など）は合成された形のまま残るので、編集距離と語長の勘定は、濁点の分を除いて以前と
// 変わらない。
export function normalize(s: unknown) {
  if (s == null) return '';
  let t = String(s);
  try {
    t = t
      .normalize('NFKC')
      .normalize('NFD')
      .replace(/[\u3099\u309a]/g, '')
      .normalize('NFC');
  } catch (_e) {
    /* 古い実行環境向けの代わりの経路 */
  }
  return kataToHira(t.toLowerCase());
}

// ローマ字のクエリからカナを導く（#199）。下のどの入り口も共有するので、同じ入力からは
// 必ず同じカナが出る（#761＝compile() はこれを丸ごと飛ばしていた）。wanakana の toKana() が
// ローマ字を読み（カナや IME の入力はほぼそのまま通す）、そのあと normalize() が他と同じ
// グリフの規則（NFKC、カタカナ→ひらがな、小文字化）をかける。
function toKanaVariant(s: string) {
  return normalize(toKana(s, { IMEMode: true }));
}

// 短い語彙に対する厳しい照合。両側を正規化したうえで、連続した部分文字列を要求する。
// compile() と違い、部分列も打ち間違いも意図して受け付けない＝ピッカーはアプリ全体の
// グリフの規則を共有しつつ、精密なままでいられる。
export function includesNormalized(haystack: unknown, query: unknown) {
  const hay = normalize(haystack);
  const rawQuery = String(query ?? '');
  const normalizedQuery = normalize(rawQuery);
  const kanaQuery = toKanaVariant(rawQuery);
  return hay.includes(normalizedQuery) || hay.includes(kanaQuery);
}

// needle の各文字が hay の中に順に現れるか（連続している必要は無い＝部分列の照合、A）。
export function isSubsequence(hay: string, needle: string) {
  let i = 0;
  for (let k = 0; k < needle.length; k++) {
    i = hay.indexOf(needle[k], i);
    if (i === -1) return false;
    i++;
  }
  return true;
}

// 近似部分文字列の照合（C）。Sellers のアルゴリズムで、needle が hay のどこかの部分文字列と
// 編集距離 maxErr 以内で一致するかを判定する（開始位置と終了位置は自由＝部分文字列の照合）。
export function approxSubstring(hay: string, needle: string, maxErr: number) {
  const n = needle.length,
    h = hay.length;
  if (n === 0) return true;
  if (maxErr <= 0) return hay.indexOf(needle) !== -1;
  // 0行目（needle が空）は、どの位置からでもコスト0で始められる。
  let prev = new Array(h + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(h + 1);
    cur[0] = i; // needle の先頭 i 文字を空の hay に揃える＝i 回の削除
    const nc = needle[i - 1];
    let rowMin = cur[0];
    for (let j = 1; j <= h; j++) {
      const cost = nc === hay[j - 1] ? 0 : 1;
      let v = prev[j - 1] + cost; // 一致または置換
      const del = prev[j] + 1; // needle 側の削除
      const ins = cur[j - 1] + 1; // hay 側に余分な文字がある（挿入）
      if (del < v) v = del;
      if (ins < v) v = ins;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxErr) return false; // この行が丸ごとしきい値を超えたら、この先も成立しない（枝刈り）
    prev = cur;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let j = 0; j <= h; j++) if (prev[j] < best) best = prev[j];
  return best <= maxErr;
}

// 許す編集の回数を、語の長さに合わせて決める。短い語は 0（誤って当たる件数が跳ね上がる
// ため）、中くらいから長い語は 1〜2。
function errBudget(len: number) {
  return len <= 2 ? 0 : len <= 4 ? 1 : 2;
}

// クエリを一度だけ正規化・前処理し、各 haystack を判定する関数を返す（描画ごとに1回だけ
// コンパイルする）。空のクエリは常に true。
export function compile(query: string) {
  const nq = normalize(query).trim();
  if (!nq)
    return function () {
      return true;
    };
  const terms = nq
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ t, k: errBudget(t.length), kana: toKanaVariant(t) }));
  if (!terms.length)
    return function () {
      return true;
    };
  return function (rawHay: string) {
    const H = normalize(rawHay);
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      if (isSubsequence(H, term.t)) continue; // A: 順序を保った緩い一致
      if (term.k > 0 && approxSubstring(H, term.t, term.k)) continue; // C: 打ち間違いを許す
      // #761: ローマ字→カナで導いた語は、部分文字列だけで判定する（部分列も編集距離も
      // 使わない）＝カナは漢字のような語の切れ目の手がかりを持たないので、compile() の
      // いつもの緩さだと、例えば "neko" が、離れた ね と こ をその順に含むだけの長い文に
      // 当たってしまう。
      if (term.kana && term.kana !== term.t && H.includes(term.kana)) continue;
      return false;
    }
    return true;
  };
}

// --- 全文検索の体験のための抜粋の切り出し（#29） ----------------------------
// 上の compile()/isSubsequence/approxSubstring は、正規化した文字列（NFKC など）の上で
// 一致・不一致を判定する＝正規化は文字数を変えるので、正規化後の文字列で見つけた位置を
// 元の文へ戻すことはできない（#29 の設計コメント:「正規化後オフセットを原文へ逆写像しては
// いけない」）。だから抜粋は、上の一致の判定とは独立に、素の欄の文字列を直接探し直す。順序は
// 設計が求めるとおり: ①連続した完全一致の部分文字列（小文字化した indexOf）②compile() が
// 使うのと同じ許容回数での近似部分文字列 ③諦めて、強調の無い素の先頭の抜粋を返す。

// approxSubstring の Sellers の動的計画法だが、最良の窓がどこで終わるかを捨てずに残す＝
// approxSubstring は可否の答えだけで足りたが、抜粋には位置が要る。意図して素の（正規化して
// いない）文字列の上で走らせる（上のヘッダのコメントを参照）。左から右へ走査するので、
// 同点なら最も左（最も早く、最も安定した）一致が残る。
export function approxSubstringEnd(hay: string, needle: string, maxErr: number): number | null {
  const n = needle.length,
    h = hay.length;
  if (n === 0) return null;
  if (maxErr <= 0) {
    const idx = hay.indexOf(needle);
    return idx === -1 ? null : idx + n;
  }
  let prev = new Array(h + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(h + 1);
    cur[0] = i;
    const nc = needle[i - 1];
    for (let j = 1; j <= h; j++) {
      const cost = nc === hay[j - 1] ? 0 : 1;
      let v = prev[j - 1] + cost;
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      if (del < v) v = del;
      if (ins < v) v = ins;
      cur[j] = v;
    }
    prev = cur;
  }
  let bestEnd: number | null = null;
  let bestCost = maxErr + 1;
  for (let j = 0; j <= h; j++) {
    if (prev[j] < bestCost) {
      bestCost = prev[j];
      bestEnd = j;
    }
  }
  return bestCost <= maxErr ? bestEnd : null;
}

/** 素の `hay` の中で `query` に最もよく当たる区間 [start,end)。完全一致の走査でも近似の
 * 走査でも許容回数の内に見つからなければ null（「取れなければ」の場合＝呼び出し側は
 * 素の先頭の抜粋を代わりに使う）。 */
export function matchSpan(hay: string, query: string): { start: number; end: number } | null {
  const q = query.trim();
  if (!q) return null;
  const lq = q.toLowerCase();
  const idx = hay.toLowerCase().indexOf(lq);
  if (idx !== -1) return { start: idx, end: idx + q.length };
  const err = errBudget(q.length);
  if (err <= 0) return null;
  const end = approxSubstringEnd(hay, q, err);
  if (end == null) return null;
  return { start: Math.max(0, end - q.length - err), end };
}

export interface Snippet {
  text: string;
  /** `text` の中での位置（先頭の省略記号や窓の切り出し分は調整済み）。-1/-1 は一致が見つからなかったことを表す＝`text` は素の先頭の抜粋で、強調するものが無い。 */
  matchStart: number;
  matchEnd: number;
}

/** `query` の最初の一致の周りを窓で切り出した `raw` の抜粋。全文検索の結果の行のためのもの
 * （#29）。空白を畳むので、複数行の投稿本文も結果の行では1行として読める。 */
export function snippetOf(raw: string, query: string, radius = 40): Snippet {
  const s = raw.replace(/\s+/g, ' ').trim();
  const span = matchSpan(s, query);
  if (!span) {
    const head = s.slice(0, radius * 2);
    return { text: head + (s.length > head.length ? '…' : ''), matchStart: -1, matchEnd: -1 };
  }
  const start = Math.max(0, span.start - radius);
  const end = Math.min(s.length, span.end + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < s.length ? '…' : '';
  return { text: prefix + s.slice(start, end) + suffix, matchStart: span.start - start + prefix.length, matchEnd: span.end - start + prefix.length };
}

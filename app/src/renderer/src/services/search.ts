// 共有検索ユーティリティ＝単一スマート検索のマッチャー（P2④で方式切替を全廃・
// 常にこの loose マッチャー1本。旧 'searchMode' pref と ぴったり/おおまか seg は退場）。
//
// 検索は次の3要素を併用する:
//   B 表記ゆれ正規化 … NFKC(全角↔半角) + カタカナ→ひらがな統一 + 小文字化を両辺に適用
//   A サブシーケンス … 文字が順番に現れれば一致（部分・絞り込み用途、緩め）
//   C 編集距離       … 近似部分一致(Sellers法)でタイプミス（置換/挿入/欠落）を許容
//   → 正規化後に「A または C」で各語を判定し、空白区切りの全語を AND 結合。
//
// A real ES module (named exports) — imported directly by the orchestrator and
// query-builder.ts.

// カタカナ(U+30A1..U+30F6)→ひらがな(U+3041..U+3096)。長音符ー等はそのまま。
function kataToHira(s: string) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : s[i];
  }
  return out;
}

// 表記ゆれ正規化（B）。NFKC で全角英数→半角・半角カナ→全角カナ等を吸収し、
// 濁点・半濁点を落として（が→か・ぱ→は）小文字化＋カナ統一する。
// NFKC → NFD の順は必須（先に NFD だと半角カナの互換分解と干渉する）。除去するのは
// 結合濁点/半濁点だけで、最後に NFC へ戻す＝ラテン系の分音記号（é 等）は合成形のまま
// ＝濁点以外の編集距離・語長の勘定は従来どおり。
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
    /* 古い環境向けフォールバック */
  }
  return kataToHira(t.toLowerCase());
}

// needle の各文字が hay に出現順で現れるか（連続でなくてよい＝サブシーケンス一致, A）。
export function isSubsequence(hay: string, needle: string) {
  let i = 0;
  for (let k = 0; k < needle.length; k++) {
    i = hay.indexOf(needle[k], i);
    if (i === -1) return false;
    i++;
  }
  return true;
}

// 近似部分一致（C）。Sellers のアルゴリズムで、needle が hay の「どこかの部分文字列」と
// 編集距離 maxErr 以内で一致するか判定（開始/終了位置は自由＝部分一致）。
export function approxSubstring(hay: string, needle: string, maxErr: number) {
  const n = needle.length,
    h = hay.length;
  if (n === 0) return true;
  if (maxErr <= 0) return hay.indexOf(needle) !== -1;
  // 行0（空needle）はどの位置でもコスト0で始められる。
  let prev = new Array(h + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array(h + 1);
    cur[0] = i; // needle先頭i文字を空hayに合わせる＝i回の欠落
    const nc = needle[i - 1];
    let rowMin = cur[0];
    for (let j = 1; j <= h; j++) {
      const cost = nc === hay[j - 1] ? 0 : 1;
      let v = prev[j - 1] + cost; // 一致 or 置換
      const del = prev[j] + 1; // needle側の欠落
      const ins = cur[j - 1] + 1; // hay側の余分文字（挿入）
      if (del < v) v = del;
      if (ins < v) v = ins;
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxErr) return false; // この行が全て閾値超なら以降も不可（枝刈り）
    prev = cur;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let j = 0; j <= h; j++) if (prev[j] < best) best = prev[j];
  return best <= maxErr;
}

// 語長に応じた許容編集回数。短語は誤判定が増えるので 0、中〜長語で 1〜2。
function errBudget(len: number) {
  return len <= 2 ? 0 : len <= 4 ? 1 : 2;
}

// クエリを1度だけ正規化・前処理し、各 haystack を判定する関数を返す（描画毎に1回 compile）。
// 空クエリは常に true。
export function compile(query: string) {
  const nq = normalize(query).trim();
  if (!nq)
    return function () {
      return true;
    };
  const terms = nq
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ t, k: errBudget(t.length) }));
  if (!terms.length)
    return function () {
      return true;
    };
  return function (rawHay: string) {
    const H = normalize(rawHay);
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      if (isSubsequence(H, term.t)) continue; // A: 緩い順序一致
      if (term.k > 0 && approxSubstring(H, term.t, term.k)) continue; // C: タイプミス許容
      return false;
    }
    return true;
  };
}

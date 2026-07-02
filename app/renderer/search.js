// 共有検索ユーティリティ。検索方式（通常＝部分一致 / あいまい）を一元管理し、viewer.js が参照する。
// モードは config pref 'searchMode' に永続化（main.js）。
//
// あいまい検索は次の3要素を併用する:
//   B 表記ゆれ正規化 … NFKC(全角↔半角) + カタカナ→ひらがな統一 + 小文字化を両辺に適用
//   A サブシーケンス … 文字が順番に現れれば一致（部分・絞り込み用途、緩め）
//   C 編集距離       … 近似部分一致(Sellers法)でタイプミス（置換/挿入/欠落）を許容
//   → 正規化後に「A または C」で各語を判定し、空白区切りの全語を AND 結合。
(function () {
  'use strict';
  let mode = 'normal'; // 'normal' | 'fuzzy'
  // Set (not array) so subscribe can return an unsubscribe that actually removes the
  // listener — React islands subscribe via useSyncExternalStore and must detach on
  // unmount (and to avoid duplicate registrations across HMR reloads in dev).
  const listeners = new Set();
  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn(mode);
      } catch (_e) {
        /* ignore */
      }
    }
  };

  // カタカナ(U+30A1..U+30F6)→ひらがな(U+3041..U+3096)。長音符ー等はそのまま。
  function kataToHira(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : s[i];
    }
    return out;
  }

  // 表記ゆれ正規化（B）。NFKC で全角英数→半角・半角カナ→全角カナ等を吸収し、
  // 小文字化＋カナ統一する。
  function normalize(s) {
    if (s == null) return '';
    let t = String(s);
    try {
      t = t.normalize('NFKC');
    } catch (_e) {
      /* 古い環境向けフォールバック */
    }
    return kataToHira(t.toLowerCase());
  }

  // needle の各文字が hay に出現順で現れるか（連続でなくてよい＝サブシーケンス一致, A）。
  function isSubsequence(hay, needle) {
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
  function approxSubstring(hay, needle, maxErr) {
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
  function errBudget(len) {
    return len <= 2 ? 0 : len <= 4 ? 1 : 2;
  }

  // クエリを1度だけ正規化・前処理し、各 haystack を判定する関数を返す（描画毎に1回 compile）。
  // 空クエリは常に true。
  function compile(query) {
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
    return function (rawHay) {
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

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  window.corpusSearch = {
    getMode() {
      return mode;
    },
    isFuzzy() {
      return mode === 'fuzzy';
    },
    // ユーザー操作による変更（pref へ永続化）。
    setMode(m) {
      const next = m === 'fuzzy' ? 'fuzzy' : 'normal';
      const changed = next !== mode;
      mode = next;
      if (changed && window.corpus && window.corpus.setPref) {
        window.corpus.setPref('searchMode', mode).catch(() => {
          /* best-effort */
        });
      }
      notify();
    },
    toggle() {
      this.setMode(mode === 'fuzzy' ? 'normal' : 'fuzzy');
    },
    // pref からの初期反映（永続化しない）。
    applyMode(m) {
      mode = m === 'fuzzy' ? 'fuzzy' : 'normal';
      notify();
    },
    // Returns an unsubscribe fn (existing callers ignore it — backward compatible).
    // `subscribe` is the canonical name (same contract as corpusStore, so React
    // islands can pass it straight to useSyncExternalStore); `onChange` stays as
    // a compatibility alias for older vanilla call sites. Both are the same
    // standalone function (not a `this`-forwarding method), so a detached
    // reference like `useSyncExternalStore(corpusSearch.subscribe, …)` is safe.
    subscribe,
    onChange: subscribe,
    // 低レベルAPI（テスト・再利用用）。
    normalize,
    isSubsequence,
    approxSubstring,
    compile,
    // 単発判定の便宜ラッパ（hay/query 1組）。大量判定では compile を使うこと。
    fuzzy(hay, query) {
      return compile(query)(hay);
    },
  };
})();

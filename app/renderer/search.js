// 共有検索ユーティリティ。検索方式（通常＝部分一致 / あいまい＝サブシーケンス一致）を
// 一元管理し、投稿モード(viewer.js)・画像モード(image-viewer.js)の両方が参照する。
// モードは config pref 'searchMode' に永続化（main.js）。トグルで両モードが同期する。
(function () {
  'use strict';
  let mode = 'normal';                 // 'normal' | 'fuzzy'
  const listeners = [];
  const notify = () => { for (const fn of listeners) { try { fn(mode); } catch (_e) { /* ignore */ } } };

  // needle の各文字が hay に出現順で現れるか（連続でなくてよい＝サブシーケンス一致）。
  function isSubsequence(hay, needle) {
    let i = 0;
    for (let k = 0; k < needle.length; k++) {
      i = hay.indexOf(needle[k], i);
      if (i === -1) return false;
      i++;
    }
    return true;
  }

  window.corpusSearch = {
    getMode() { return mode; },
    isFuzzy() { return mode === 'fuzzy'; },
    // ユーザー操作による変更（pref へ永続化）。
    setMode(m) {
      const next = (m === 'fuzzy') ? 'fuzzy' : 'normal';
      const changed = next !== mode;
      mode = next;
      if (changed && window.corpus && window.corpus.setPref) {
        window.corpus.setPref('searchMode', mode).catch(() => { /* best-effort */ });
      }
      notify();
    },
    toggle() { this.setMode(mode === 'fuzzy' ? 'normal' : 'fuzzy'); },
    // pref からの初期反映（永続化しない）。
    applyMode(m) { mode = (m === 'fuzzy') ? 'fuzzy' : 'normal'; notify(); },
    onChange(fn) { if (typeof fn === 'function') listeners.push(fn); },
    isSubsequence,
    // hay: 連結済み小文字テキスト, query: 生クエリ。空白区切りの各語をすべて
    // サブシーケンス一致(AND)で判定。空クエリは常に true。
    fuzzy(hay, query) {
      const q = (query || '').trim().toLowerCase();
      if (!q) return true;
      const terms = q.split(/\s+/).filter(Boolean);
      for (const t of terms) if (!isSubsequence(hay, t)) return false;
      return true;
    }
  };
})();

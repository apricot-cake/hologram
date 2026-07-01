'use strict';

// Shared UI utilities — single source of truth, loaded before folders.js/viewer.js
// so both consume the SAME toast + escape implementation instead of their own copies.
//   window.corpusUI = { notify, escapeHtml }
(function () {
  let toastTimer = null;

  // Transient toast via the glass #ivToast surface (DESIGN.md: glass = transient
  // surface). Replaces viewer.js's old dynamically-created #toast (a solid #333
  // pill) and folders.js's own duplicate — one implementation, one look.
  function notify(msg) {
    const el = document.getElementById('ivToast');
    if (!el) return;
    el.textContent = msg == null ? '' : String(msg);
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  // Quote-safe HTML escape for text placed via innerHTML. Escapes " and ' too, so
  // a result accidentally used in an attribute stays safe (viewer's old div-based
  // escape left those unescaped). Display is unchanged for normal text content.
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  window.corpusUI = { notify, escapeHtml };
})();

// Display formatting service — pure count/date presentation formatters, extracted
// 1:1 from viewer.js as the next "pure logic → service" slice of the viewer
// decomposition (最終形B). Engagement counts, card/inspector dates and the backup
// rail's relative time were each formatted by private functions scattered across
// viewer.js, several rebuilding an Intl formatter per call; this module is the
// single owner and caches the formatters once. Plain IIFE on window (like
// geometry.js / users.js); loaded BEFORE viewer.js; touches no DOM and holds no
// i18n state (relative-time labels are passed in). CommonJS-exported for the pure
// unit test.
(function () {
  'use strict';

  // Engagement count: 1.2K / 3.4M style abbreviation. null/undefined → ''.
  function formatCount(n) {
    if (n == null) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  // Numeric short date used by the date-filter chips (M/D this year, else Y/M/D).
  function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    const thisYear = new Date().getFullYear().toString();
    return y === thisYear ? `${Number.parseInt(m)}/${Number.parseInt(d)}` : `${y}/${Number.parseInt(m)}/${Number.parseInt(d)}`;
  }

  // Card footer date: ONE compact month-name date (e.g. "Jun 13" / "6月13日") — a
  // bare "6/13" reads as a fraction next to the ×N image badge. Formatters cached:
  // compactDate runs once per card × up to 150 cards.
  const _compactFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const _compactFmtY = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  function compactDate(ds) {
    if (!ds) return '';
    const d = new Date(ds);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() === new Date().getFullYear() ? _compactFmt.format(d) : _compactFmtY.format(d);
  }

  // Full date + time for the card hover tooltip. Cached Intl formatters: a fresh
  // toLocaleDateString/TimeString per call dominated render time (2×/card × 150).
  const _dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' });
  const _timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  function formatDate(isoStr) {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '';
    return _dateFmt.format(d) + ' ' + _timeFmt.format(d);
  }

  // Backup tooltip: absolute Y/M/D HH:MM (zero-padded, locale-independent).
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // Backup rail: compact relative time (today/yesterday HH:MM, else M/D or Y/M/D).
  // The "今日"/"昨日" words are i18n-owned by the caller and passed as labels.
  function fmtBackupTime(iso, labels) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const hhmm = `${p(d.getHours())}:${p(d.getMinutes())}`;
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const yest = new Date(now);
    yest.setDate(now.getDate() - 1);
    if (sameDay(d, now)) return `${labels.today} ${hhmm}`;
    if (sameDay(d, yest)) return `${labels.yesterday} ${hhmm}`;
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  // Locale defaults for inspector fields (join date / posted / saved / updated).
  // Kept as the platform default (no explicit options) so output is byte-identical
  // to the inline `new Date(x).toLocale*()` calls these replaced. '' for falsy.
  const localeDate = (x) => (x ? new Date(x).toLocaleDateString() : '');
  const localeDateTime = (x) => (x ? new Date(x).toLocaleString() : '');

  const api = { formatCount, formatShortDate, compactDate, formatDate, fmtTime, fmtBackupTime, localeDate, localeDateTime };
  if (typeof window !== 'undefined') window.corpusFormat = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

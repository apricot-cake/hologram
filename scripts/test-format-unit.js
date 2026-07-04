'use strict';

// format.js（window.corpusFormat）のロジック単体テスト。CommonJS でも export
// するので直接 require し、件数の短縮（formatCount）・日付整形（formatShortDate/
// compactDate/formatDate）・バックアップ時刻（fmtTime/fmtBackupTime＝相対ラベルは
// 呼び出し側から注入）・ロケール既定ヘルパ（localeDate/localeDateTime）を検証する。
// 旧 viewer.js に散在していた整形関数が単一所有へ統合されたスライスの回帰ガード。
// ロケール依存の出力（compactDate/formatDate/locale*）はバイト値でなく「非空・falsy
// は空」等の不変条件で確認し、CI ロケール差でのフレーク化を避ける。
//
//   node scripts/test-format-unit.js

const path = require('node:path');

const F = require(path.join(__dirname, '..', 'app', 'renderer', 'format.js'));

let failed = 0;
function assert(name, cond) {
  if (cond) {
    console.log('ok  ', name);
  } else {
    console.log('FAIL', name);
    failed++;
  }
}

// --- formatCount: 1.2K / 3.4M 短縮と境界 ---
assert('formatCount: null → 空', F.formatCount(null) === '');
assert('formatCount: undefined → 空', F.formatCount(undefined) === '');
assert('formatCount: 0 は "0"（null と区別）', F.formatCount(0) === '0');
assert('formatCount: 9999 は素通し', F.formatCount(9999) === '9999');
assert('formatCount: 10000 で K 表記へ', F.formatCount(10000) === '10.0K');
assert('formatCount: 12345 → 12.3K（toFixed(1) 切り捨て）', F.formatCount(12345) === '12.3K');
assert('formatCount: 999999 はまだ K', F.formatCount(999999) === '1000.0K');
assert('formatCount: 1000000 で M 表記へ', F.formatCount(1000000) === '1.0M');
assert('formatCount: 3450000 → 3.5M', F.formatCount(3450000) === '3.5M');

// --- formatShortDate: 今年は M/D、他年は Y/M/D（ゼロ埋めしない） ---
{
  const y = new Date().getFullYear();
  assert('formatShortDate: 空文字は空', F.formatShortDate('') === '');
  assert('formatShortDate: 今年は M/D（先頭ゼロ落ち）', F.formatShortDate(`${y}-03-05`) === '3/5');
  assert('formatShortDate: 他年は Y/M/D', F.formatShortDate('1999-12-09') === '1999/12/9');
}

// --- compactDate / formatDate: 不正日付は空、正日付は非空（ロケール非依存の不変条件） ---
assert('compactDate: 空は空', F.compactDate('') === '');
assert('compactDate: 不正日付は空', F.compactDate('not-a-date') === '');
assert('compactDate: 正日付は非空', F.compactDate('2020-06-13T00:00:00Z').length > 0);
assert('formatDate: 不正日付は空', F.formatDate('not-a-date') === '');
assert('formatDate: 正日付は日付+時刻（空白1つで連結）', /\S \S/.test(F.formatDate('2020-06-13T09:41:00Z')));

// --- fmtTime: ゼロ埋め Y/M/D HH:MM（ロケール非依存＝バイト検証可） ---
assert('fmtTime: 空は空', F.fmtTime('') === '');
assert('fmtTime: 不正は空', F.fmtTime('nope') === '');
{
  // ローカルタイムで組むので、ローカル日時から期待値を作って一致を見る
  const d = new Date(2021, 0, 5, 7, 3); // 2021-01-05 07:03 local
  assert('fmtTime: 月日時分をゼロ埋め', F.fmtTime(d.toISOString()) === '2021/01/05 07:03');
}

// --- fmtBackupTime: 相対ラベルは注入・today/yesterday/同年/他年の分岐 ---
{
  const L = { today: 'TODAY', yesterday: 'YEST' };
  assert('fmtBackupTime: 空は空', F.fmtBackupTime('', L) === '');
  const now = new Date();
  const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 9);
  assert('fmtBackupTime: 今日は today ラベル + HH:MM', F.fmtBackupTime(todayAt.toISOString(), L) === 'TODAY 08:09');
  const yAt = new Date(now.getTime() - 24 * 3600 * 1000);
  const yLocal = new Date(yAt.getFullYear(), yAt.getMonth(), yAt.getDate(), 8, 9);
  assert('fmtBackupTime: 昨日は yesterday ラベル', F.fmtBackupTime(yLocal.toISOString(), L).startsWith('YEST '));
  // 他年（確実に過去年）は Y/M/D のみ（時刻なし）
  assert('fmtBackupTime: 他年は Y/M/D のみ', F.fmtBackupTime('2001-07-08T05:06:00', L) === '2001/7/8');
}

// --- localeDate / localeDateTime: falsy は空・非空日付は inline 呼びとバイト一致 ---
assert('localeDate: null は空', F.localeDate(null) === '');
assert('localeDate: 空文字は空', F.localeDate('') === '');
assert('localeDateTime: undefined は空', F.localeDateTime(undefined) === '');
{
  const iso = '2020-06-13T09:41:00Z';
  assert('localeDate: 旧 inline と一致', F.localeDate(iso) === new Date(iso).toLocaleDateString());
  assert('localeDateTime: 旧 inline と一致', F.localeDateTime(iso) === new Date(iso).toLocaleString());
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nall format unit tests passed');

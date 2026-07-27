// format.ts のロジック単体テスト。件数の短縮（formatCount）・日付整形
// （formatShortDate/compactDate/formatDate）・バックアップ時刻（fmtTime/
// fmtBackupTime＝相対ラベルは呼び出し側から注入）・ロケール既定ヘルパ
// （localeDate/localeDateTime）を検証する。旧 viewer.js に散在していた整形関数が
// 単一所有へ統合されたスライスの回帰ガード。ロケール依存の出力（compactDate/
// formatDate/locale*）はバイト値でなく「非空・falsy は空」等の不変条件で確認し、
// CI ロケール差でのフレーク化を避ける。

import { describe, expect, test } from 'vitest';
import * as F from '../app/src/renderer/src/services/format';

describe('formatCount: 1.2K / 3.4M 短縮と境界', () => {
  test('null → 空', () => {
    expect(F.formatCount(null)).toBe('');
  });

  test('undefined → 空', () => {
    expect(F.formatCount(undefined)).toBe('');
  });

  test('0 は "0"（null と区別）', () => {
    expect(F.formatCount(0)).toBe('0');
  });

  test('9999 は素通し', () => {
    expect(F.formatCount(9999)).toBe('9999');
  });

  test('10000 で K 表記へ', () => {
    expect(F.formatCount(10000)).toBe('10.0K');
  });

  test('12345 → 12.3K（toFixed(1) 切り捨て）', () => {
    expect(F.formatCount(12345)).toBe('12.3K');
  });

  test('999999 はまだ K', () => {
    expect(F.formatCount(999999)).toBe('1000.0K');
  });

  test('1000000 で M 表記へ', () => {
    expect(F.formatCount(1000000)).toBe('1.0M');
  });

  test('3450000 → 3.5M', () => {
    expect(F.formatCount(3450000)).toBe('3.5M');
  });
});

describe('formatShortDate: 今年は M/D、他年は Y/M/D（ゼロ埋めしない）', () => {
  test('空文字は空', () => {
    expect(F.formatShortDate('')).toBe('');
  });

  test('今年は M/D（先頭ゼロ落ち）', () => {
    const y = new Date().getFullYear();
    expect(F.formatShortDate(`${y}-03-05`)).toBe('3/5');
  });

  test('他年は Y/M/D', () => {
    expect(F.formatShortDate('1999-12-09')).toBe('1999/12/9');
  });
});

// ロケール依存の出力は「不正日付は空・正日付は非空」の不変条件だけ見る
describe('compactDate / formatDate', () => {
  test('compactDate: 空は空', () => {
    expect(F.compactDate('')).toBe('');
  });

  test('compactDate: 不正日付は空', () => {
    expect(F.compactDate('not-a-date')).toBe('');
  });

  test('compactDate: 正日付は非空', () => {
    expect(F.compactDate('2020-06-13T00:00:00Z').length).toBeGreaterThan(0);
  });

  test('formatDate: 不正日付は空', () => {
    expect(F.formatDate('not-a-date')).toBe('');
  });

  test('formatDate: 正日付は日付+時刻（空白1つで連結）', () => {
    expect(F.formatDate('2020-06-13T09:41:00Z')).toMatch(/\S \S/);
  });
});

describe('fmtTime: ゼロ埋め Y/M/D HH:MM（ロケール非依存＝バイト検証可）', () => {
  test('空は空', () => {
    expect(F.fmtTime('')).toBe('');
  });

  test('不正は空', () => {
    expect(F.fmtTime('nope')).toBe('');
  });

  test('月日時分をゼロ埋め', () => {
    // ローカルタイムで組むので、ローカル日時から期待値を作って一致を見る
    const d = new Date(2021, 0, 5, 7, 3); // 2021-01-05 07:03 local
    expect(F.fmtTime(d.toISOString())).toBe('2021/01/05 07:03');
  });
});

describe('fmtBackupTime: 相対ラベルは注入・today/yesterday/同年/他年の分岐', () => {
  const L = { today: 'TODAY', yesterday: 'YEST' };

  test('空は空', () => {
    expect(F.fmtBackupTime('', L)).toBe('');
  });

  test('今日は today ラベル + HH:MM', () => {
    const now = new Date();
    const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 9);
    expect(F.fmtBackupTime(todayAt.toISOString(), L)).toBe('TODAY 08:09');
  });

  test('昨日は yesterday ラベル', () => {
    const yAt = new Date(Date.now() - 24 * 3600 * 1000);
    const yLocal = new Date(yAt.getFullYear(), yAt.getMonth(), yAt.getDate(), 8, 9);
    expect(F.fmtBackupTime(yLocal.toISOString(), L).startsWith('YEST ')).toBe(true);
  });

  test('他年は Y/M/D のみ（時刻なし）', () => {
    expect(F.fmtBackupTime('2001-07-08T05:06:00', L)).toBe('2001/7/8');
  });
});

describe('localeDate / localeDateTime: falsy は空・非空日付は inline 呼びとバイト一致', () => {
  const iso = '2020-06-13T09:41:00Z';

  test('localeDate: null は空', () => {
    expect(F.localeDate(null)).toBe('');
  });

  test('localeDate: 空文字は空', () => {
    expect(F.localeDate('')).toBe('');
  });

  test('localeDateTime: undefined は空', () => {
    expect(F.localeDateTime(undefined)).toBe('');
  });

  test('localeDate: 旧 inline と一致', () => {
    expect(F.localeDate(iso)).toBe(new Date(iso).toLocaleDateString());
  });

  test('localeDateTime: 旧 inline と一致', () => {
    expect(F.localeDateTime(iso)).toBe(new Date(iso).toLocaleString());
  });
});

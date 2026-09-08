import { beforeEach, describe, expect, test } from 'vitest';
import * as R from './fulltext-dialog';
beforeEach(() => R.close());
describe('開閉状態', () => {
  test('open / close と購読', () => {
    let hits = 0;
    const off = R.subscribe(() => hits++);
    expect(R.isOpen()).toBe(false);
    R.open();
    expect(R.isOpen()).toBe(true);
    expect(hits).toBe(1);
    R.open(); // 同じ値を入れ直しても通知しない
    expect(hits).toBe(1);
    R.close();
    expect(R.isOpen()).toBe(false);
    expect(hits).toBe(2);
    off();
    R.open();
    expect(hits).toBe(2);
    R.close();
  });

  test('openId は開いた回数＝島の key（閉じるアニメーション中の開き直しでも作り直す）', () => {
    const before = R.openId();
    R.open();
    expect(R.openId()).toBe(before + 1);
    R.close();
    expect(R.openId()).toBe(before + 1); // 閉じても進まない
    R.open();
    expect(R.openId()).toBe(before + 2);
    R.close();
  });
});

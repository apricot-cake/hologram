// command-registry.ts のロジック単体テスト（#28 コマンドパレット）。既存の検索ユニット
// （search.test.ts / facets.test.ts）と同型で、レジストリの純粋な部分だけを直接検証する:
// 登録・セクションごとの束ね・スコア順（完全一致 > 前方一致 > 部分一致 > あいまい）・
// 面ごとの絞り込み（sections / limit）・開閉状態・runEntry の「閉じてから実行」。
//
// 器（Base UI Dialog + Autocomplete）とエントリの中身（command-builder.ts の perform
// クロージャ）は実機検証の担当。ここは供給源の意味論だけを見る。

import { beforeEach, describe, expect, test } from 'vitest';
import * as R from '../app/src/renderer/src/services/command-registry';

type Entry = R.CommandEntry;

// perform が呼ばれた順に id を積む（runEntry の順序検証にも使う）。
let ran: string[] = [];
const entry = (id: string, section: R.CommandSection, title: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  section,
  title,
  perform: () => ran.push(id),
  ...extra,
});

const titlesOf = (groups: R.CommandGroup[], section: R.CommandSection) => groups.find((g) => g.section === section)?.items.map((e) => e.title) ?? [];

beforeEach(() => {
  R.resetProviders();
  R.close();
  ran = [];
});

describe('登録と束ね', () => {
  test('固定エントリはセクションごとに束ねて返る', () => {
    R.registerCommands('c', [entry('a', 'command', '設定を開く'), entry('b', 'tag', '風景')]);
    const groups = R.queryEntries('');
    expect(groups.map((g) => g.section)).toEqual(['command', 'tag']);
    expect(titlesOf(groups, 'command')).toEqual(['設定を開く']);
  });

  test('セクションの並びは固定＝スコアで入れ替わらない', () => {
    // タグ側が完全一致・コマンド側が部分一致でも、見出しの順序は command → tag のまま。
    R.registerCommands('c', [entry('a', 'command', 'あ風景あ'), entry('b', 'tag', '風景')]);
    expect(R.queryEntries('風景').map((g) => g.section)).toEqual(['command', 'tag']);
  });

  test('provider はクエリを受け取り、返した母集合が絞り込まれる', () => {
    const seen: string[] = [];
    R.registerProvider({
      id: 'p',
      entries: (q) => {
        seen.push(q);
        return [entry('t1', 'tag', '風景'), entry('t2', 'tag', '料理')];
      },
    });
    expect(titlesOf(R.queryEntries('風景'), 'tag')).toEqual(['風景']);
    expect(seen).toEqual(['風景']);
  });

  test('空クエリは全件同点で返る（provider が空を返すかは provider の判断）', () => {
    R.registerCommands('c', [entry('a', 'command', '設定'), entry('b', 'command', '新しいタブ')]);
    expect(titlesOf(R.queryEntries(''), 'command')).toEqual(['設定', '新しいタブ']);
  });

  test('登録解除で候補から消える', () => {
    const off = R.registerCommands('c', [entry('a', 'command', '設定')]);
    expect(R.queryEntries('').length).toBe(1);
    off();
    expect(R.queryEntries('')).toEqual([]);
  });
});

describe('並びのスコア', () => {
  test('完全一致 > 前方一致 > 部分一致 > あいまい', () => {
    R.registerCommands('c', [
      // あいまい: サブシーケンス一致（「ねこ」が順番に現れる）
      entry('fuzzy', 'tag', 'ねずみとこども'),
      entry('substring', 'tag', 'くろねこ'),
      entry('prefix', 'tag', 'ねこじゃらし'),
      entry('exact', 'tag', 'ねこ'),
    ]);
    expect(titlesOf(R.queryEntries('ねこ'), 'tag')).toEqual(['ねこ', 'ねこじゃらし', 'くろねこ', 'ねずみとこども']);
  });

  test('同じスコア帯では weight（使用回数）が上に来る', () => {
    R.registerCommands('c', [entry('few', 'tag', 'ねこA', { weight: 2 }), entry('many', 'tag', 'ねこB', { weight: 40 })]);
    expect(titlesOf(R.queryEntries('ねこ'), 'tag')).toEqual(['ねこB', 'ねこA']);
  });

  test('weight も同じなら登録順（同じ入力なら毎回同じ並び）', () => {
    R.registerCommands('c', [entry('first', 'tag', 'ねこA'), entry('second', 'tag', 'ねこB')]);
    expect(titlesOf(R.queryEntries('ねこ'), 'tag')).toEqual(['ねこA', 'ねこB']);
  });

  test('マッチ意味論は search.ts と同じ＝表記ゆれもタイプミスも当たる', () => {
    R.registerCommands('c', [entry('a', 'tag', 'ネコ'), entry('b', 'user', 'アリス')]);
    // カタカナ/ひらがな + 全角半角の正規化（B）
    expect(titlesOf(R.queryEntries('ねこ'), 'tag')).toEqual(['ネコ']);
    // 編集距離（C）＝1文字違いでも拾う
    expect(titlesOf(R.queryEntries('アリヌ'), 'user')).toEqual(['アリス']);
  });

  test('keywords も haystack に入る（投稿者のスクリーンネーム）', () => {
    R.registerCommands('c', [entry('u', 'user', 'アリス', { keywords: 'alice' })]);
    expect(titlesOf(R.queryEntries('alice'), 'user')).toEqual(['アリス']);
  });

  test('どこにも当たらないエントリは落ちる', () => {
    R.registerCommands('c', [entry('a', 'tag', '風景')]);
    expect(R.queryEntries('zzzzzz')).toEqual([]);
  });
});

describe('面ごとの顔ぶれ（sections / limit）', () => {
  beforeEach(() => {
    R.registerCommands('c', [entry('cmd', 'command', 'ねこを開く'), entry('t1', 'tag', 'ねこ1', { weight: 3 }), entry('t2', 'tag', 'ねこ2', { weight: 2 }), entry('t3', 'tag', 'ねこ3', { weight: 1 }), entry('u1', 'user', 'ねこさん')]);
  });

  test('sections で見せる見出しを選べる（検索ボックスはタグと投稿者だけ）', () => {
    const groups = R.queryEntries('ねこ', { sections: ['tag', 'user'] });
    expect(groups.map((g) => g.section)).toEqual(['tag', 'user']);
  });

  test('limit はセクション単位＝上限の外は weight の低い方から落ちる', () => {
    const groups = R.queryEntries('ねこ', { limit: { tag: 2 } });
    expect(titlesOf(groups, 'tag')).toEqual(['ねこ1', 'ねこ2']);
    // 上限を指定していないセクションは出し切る
    expect(titlesOf(groups, 'command')).toEqual(['ねこを開く']);
  });
});

describe('開閉状態', () => {
  test('open / close と購読', () => {
    let hits = 0;
    const off = R.subscribe(() => hits++);
    expect(R.isOpen()).toBe(false);
    R.open();
    expect(R.isOpen()).toBe(true);
    expect(hits).toBe(1);
    R.open(); // 同じ値の再設定は通知しない
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
    expect(R.openId()).toBe(before + 1); // 閉じるでは進まない
    R.open();
    expect(R.openId()).toBe(before + 2);
    R.close();
  });
});

describe('runEntry は閉じてから実行する', () => {
  test('perform の中から見て、もう閉じている', () => {
    let openInsidePerform: boolean | null = null;
    R.open();
    R.runEntry({ id: 'x', section: 'command', title: 'x', perform: () => (openInsidePerform = R.isOpen()) });
    expect(openInsidePerform).toBe(false);
    expect(R.isOpen()).toBe(false);
  });
});

import { beforeEach, describe, expect, test } from 'vitest';
import * as R from './search-suggestions';

type Entry = R.SearchSuggestion;

// perform が呼ばれた順に id を積む（runEntry の順序を確かめるのにも使う）。
const register = (id: string, entries: Entry[]) => R.registerProvider({ id, entries: () => entries });
let ran: string[] = [];
const entry = (id: string, section: R.SuggestionSection, title: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  section,
  title,
  perform: () => ran.push(id),
  ...extra,
});

const titlesOf = (groups: R.SuggestionGroup[], section: R.SuggestionSection) => groups.find((g) => g.section === section)?.items.map((e) => e.title) ?? [];

beforeEach(() => {
  R.resetProviders();

  ran = [];
});

describe('登録と束ね', () => {
  test('固定エントリはセクションごとに束ねて返る', () => {
    register('c', [entry('a', 'folder', '設定を開く'), entry('b', 'tag', '風景')]);
    const groups = R.queryEntries('');
    expect(groups.map((g) => g.section)).toEqual(['tag', 'folder']);
    expect(titlesOf(groups, 'folder')).toEqual(['設定を開く']);
  });

  test('セクションの並びは固定＝スコアで入れ替わらない', () => {
    // タグ側が完全一致でコマンド側が部分一致でしかなくても、セクションの並びは command → tag のまま。
    register('c', [entry('a', 'folder', 'あ風景あ'), entry('b', 'tag', '風景')]);
    expect(R.queryEntries('風景').map((g) => g.section)).toEqual(['tag', 'folder']);
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
    register('c', [entry('a', 'folder', '設定'), entry('b', 'folder', '新しいタブ')]);
    expect(titlesOf(R.queryEntries(''), 'folder')).toEqual(['設定', '新しいタブ']);
  });

  test('登録解除で候補から消える', () => {
    const off = register('c', [entry('a', 'folder', '設定')]);
    expect(R.queryEntries('').length).toBe(1);
    off();
    expect(R.queryEntries('')).toEqual([]);
  });
});

describe('並びのスコア', () => {
  test('完全一致 > 前方一致 > 部分一致。飛び飛びの一致は除外', () => {
    register('c', [
      // 文字が離れた候補は一致しない。
      entry('nonmatch', 'tag', 'ねずみとこども'),
      entry('substring', 'tag', 'くろねこ'),
      entry('prefix', 'tag', 'ねこじゃらし'),
      entry('exact', 'tag', 'ねこ'),
    ]);
    expect(titlesOf(R.queryEntries('ねこ'), 'tag')).toEqual(['ねこ', 'ねこじゃらし', 'くろねこ']);
  });

  test('同じスコア帯では weight（使用回数）が上に来る', () => {
    register('c', [entry('few', 'tag', 'ねこA', { weight: 2 }), entry('many', 'tag', 'ねこB', { weight: 40 })]);
    expect(titlesOf(R.queryEntries('ねこ'), 'tag')).toEqual(['ねこB', 'ねこA']);
  });

  test('weight も同じなら登録順（同じ入力なら毎回同じ並び）', () => {
    register('c', [entry('first', 'tag', 'ねこA'), entry('second', 'tag', 'ねこB')]);
    expect(titlesOf(R.queryEntries('ねこ'), 'tag')).toEqual(['ねこA', 'ねこB']);
  });

  test('表記ゆれを吸収し、打ち間違いは区別する', () => {
    register('c', [entry('a', 'tag', 'ネコ'), entry('b', 'user', 'アリス')]);
    // カタカナ・ひらがなと全角・半角の正規化 (B)
    expect(titlesOf(R.queryEntries('ねこ'), 'tag')).toEqual(['ネコ']);
    // 1文字違いは一致しない。
    expect(titlesOf(R.queryEntries('アリヌ'), 'user')).toEqual([]);
  });

  test('keywords も haystack に入る（投稿者のスクリーンネーム）', () => {
    register('c', [entry('u', 'user', 'アリス', { keywords: 'alice' })]);
    expect(titlesOf(R.queryEntries('alice'), 'user')).toEqual(['アリス']);
  });

  test('どこにも当たらないエントリは落ちる', () => {
    register('c', [entry('a', 'tag', '風景')]);
    expect(R.queryEntries('zzzzzz')).toEqual([]);
  });
});

describe('面ごとの顔ぶれ（sections / limit）', () => {
  beforeEach(() => {
    register('c', [entry('cmd', 'folder', 'ねこを開く'), entry('t1', 'tag', 'ねこ1', { weight: 3 }), entry('t2', 'tag', 'ねこ2', { weight: 2 }), entry('t3', 'tag', 'ねこ3', { weight: 1 }), entry('u1', 'user', 'ねこさん')]);
  });

  test('sections で見せる見出しを選べる（検索ボックスはタグと投稿者だけ）', () => {
    const groups = R.queryEntries('ねこ', { sections: ['tag', 'user'] });
    expect(groups.map((g) => g.section)).toEqual(['tag', 'user']);
  });

  test('limit はセクション単位＝上限の外は weight の低い方から落ちる', () => {
    const groups = R.queryEntries('ねこ', { limit: { tag: 2 } });
    expect(titlesOf(groups, 'tag')).toEqual(['ねこ1', 'ねこ2']);
    // limit を指定していないセクションは全件出す
    expect(titlesOf(groups, 'folder')).toEqual(['ねこを開く']);
  });
});

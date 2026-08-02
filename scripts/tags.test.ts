// Pure unit tests for tags.ts (the 8th slice extracted from viewer.js). Verifies
// tagKindOf/tagKindOfName/kindLabel (entity vs name lookup, fallback for custom
// labels), posterTagsOf/posterTagEntriesOf/posterFilterVocab (raw names vs the
// effective entities, ordering by kind), groupedTagVocab (kind sections, separate
// general tag pools for post vs poster, query filtering), inspectorTagPickerData
// (vocab shape, imported hashtag source, co-occurrence suggestion tiers), and
// sameTags, all via stub deps injection.

import { beforeEach, describe, expect, test } from 'vitest';
import type { PosterTagRow, TagTypeRow } from '../app/src/main/ipc-payloads';
import { makeTags, sameTags } from '../app/src/renderer/src/services/tags';

const ja = (a: string, b: string) => a.localeCompare(b, 'ja');

// #810: the Kind store is keyed by tags.id, and a poster's tags are a row (names +
// ids + the effective set) rather than a name array. These two builders keep the
// fixtures readable.
const ID = { WorkA: 1, WorkB: 2, CharX: 3, siryo: 4, anzu: 5 };
const kinded = (rows: Array<[number, string, string, string?]>): Record<number, TagTypeRow> => {
  const out: Record<number, TagTypeRow> = {};
  for (const [id, name, kind, label] of rows) out[id] = { id, name, kind, label: label ?? name };
  return out;
};
// A poster row whose effective set is just its raw tags — the shape
// lib-db-write.ts hands back for a library with no parent rules at all.
const posterRow = (pairs: Array<[number, string]>): PosterTagRow => ({
  tags: pairs.map(([, name]) => name),
  tagIds: pairs.map(([id]) => id),
  effectiveTagIds: pairs.map(([id]) => id),
  effectiveTags: pairs.map(([, name]) => name),
  effectiveTagLabels: pairs.map(([, name]) => name),
});

// --- stub environment ---
// Read via getters, so swapping state inside a test is immediately reflected on the api side.
let state: {
  tagTypes: Record<number, TagTypeRow>;
  tagLabels: Record<string, any>;
  allPosts: any[];
  charCands: any[];
  relatedCands: any[];
  coocCalls: any[];
};
let api: ReturnType<typeof makeTags>;

const posterTags: Record<string, PosterTagRow> = {
  'x:1': posterRow([
    [ID.WorkA, 'WorkA'],
    [ID.siryo, '資料'],
  ]),
  'x:2': posterRow([
    [ID.CharX, 'CharX'],
    [ID.anzu, 'あんず'],
  ]),
  'x:3': {} as PosterTagRow, // broken entry (no arrays at all) — must not throw
};

const STATIC_MSG: Record<string, string> = {
  kindWork: '作品',
  kindCharacter: 'キャラ',
  tagUncategorized: '未分類',
  editCoocChars: 'このキャラたち',
  editCoocRelated: 'よく一緒に付くタグ',
};

const t = (key: string, subs: any[]) => {
  if (key === 'editCoocCharsOf') return `${subs[0]} のキャラ`;
  if (key === 'editCoocWhy') return `${subs[0]} と ${subs[1]} 回共起`;
  return STATIC_MSG[key];
};

beforeEach(() => {
  state = {
    tagTypes: kinded([
      [ID.WorkA, 'WorkA', 'work'],
      [ID.WorkB, 'WorkB', 'work'],
      [ID.CharX, 'CharX', 'character'],
    ]),
    tagLabels: {},
    allPosts: [
      { captureId: 'p1', tags: ['俯瞰', '自由帳'] }, // both are general tags → uncategorized pool
      { captureId: 'p2', tags: ['WorkA'] }, // has a kind → does not go into the uncategorized pool
      { captureId: 'p3' }, // no tags — must not throw
    ],
    charCands: [],
    relatedCands: [],
    coocCalls: [],
  };
  api = makeTags({
    tagTypes: () => state.tagTypes,
    tagLabels: () => state.tagLabels,
    posterTags: () => posterTags,
    allPosts: () => state.allPosts,
    t,
    charCandidatesFor: (w) => {
      state.coocCalls.push(['char', w]);
      return state.charCands;
    },
    relatedTagCandidates: (sel, opts) => {
      state.coocCalls.push(['related', sel, opts]);
      return state.relatedCands;
    },
  });
});

describe('tagKindOf / tagKindOfName / kindLabel', () => {
  test('種別つきタグ（実体キー）', () => {
    expect(api.tagKindOf(ID.WorkA)).toBe('work');
  });

  test('一般タグは null', () => {
    expect(api.tagKindOf(999)).toBeNull();
    expect(api.tagKindOfName('俯瞰')).toBeNull();
  });

  test('id が無ければ null（名前しか無い面は名前引きを使う）', () => {
    expect(api.tagKindOf(null)).toBeNull();
    expect(api.tagKindOfName('WorkA')).toBe('work');
  });

  // #810: two entities can share a name. The entity lookup tells them apart; the
  // name lookup deliberately does not — it answers "is a tag called this kinded",
  // which is the only question a typed string can ask.
  test('同名2実体は実体キーでだけ区別される', () => {
    state.tagTypes = kinded([[10, 'alice', 'character', 'alice(東方)']]);
    expect(api.tagKindOf(10)).toBe('character');
    expect(api.tagKindOf(11)).toBeNull(); // the same-named entity carrying no kind
    expect(api.tagKindOfName('alice')).toBe('character');
  });

  test('組み込みラベルへのフォールバック', () => {
    expect(api.kindLabel('work')).toBe('作品');
  });

  test('カスタムラベルが勝つ（live getter）', () => {
    state.tagLabels = { work: 'シリーズ' };
    expect(api.kindLabel('work')).toBe('シリーズ');
    expect(api.kindLabel('character')).toBe('キャラ'); // other kinds stay built-in
  });

  test('未知の種別は空文字', () => {
    expect(api.kindLabel('nope')).toBe('');
  });
});

describe('posterTagsOf / posterTagEntriesOf / posterFilterVocab', () => {
  test('配列はそのまま', () => {
    expect(api.posterTagsOf('x:1')).toEqual(['WorkA', '資料']);
  });

  test('壊れたエントリは []', () => {
    expect(api.posterTagsOf('x:3')).toEqual([]);
    expect(api.posterTagEntriesOf('x:3')).toEqual([]);
  });

  // #810: the entity read is what the poster filter and its facet rows use.
  test('実体エントリは id とラベルを持つ', () => {
    expect(api.posterTagEntriesOf('x:1')).toEqual([
      { id: ID.WorkA, name: 'WorkA', label: 'WorkA' },
      { id: ID.siryo, name: '資料', label: '資料' },
    ]);
  });

  // The optimistic row a tag edit leaves behind (ids unknown until the write comes
  // back) still reads — as names with no entity, which is what makes the predicate
  // fall back to name matching instead of matching nothing.
  test('id がまだ無い行は名前だけのエントリになる', () => {
    const pending = makeTags({
      tagTypes: () => state.tagTypes,
      tagLabels: () => state.tagLabels,
      posterTags: () => ({ 'x:9': { tags: ['新規'], tagIds: [], effectiveTagIds: [], effectiveTags: [], effectiveTagLabels: [] } }),
      allPosts: () => state.allPosts,
      t,
      charCandidatesFor: () => [],
      relatedTagCandidates: () => [],
    });
    expect(pending.posterTagEntriesOf('x:9')).toEqual([{ id: null, name: '新規', label: '新規' }]);
  });

  // #774 on the poster side: the effective set is what a filter matches, so a
  // poster tagged only with a child answers to its parent's row too — while the
  // raw list the editor shows stays exactly what the user typed.
  test('実効集合には親タグが含まれる（生タグは変わらない）', () => {
    const withParent = makeTags({
      tagTypes: () => state.tagTypes,
      tagLabels: () => state.tagLabels,
      posterTags: () => ({
        'x:9': { tags: ['レミリア'], tagIds: [20], effectiveTagIds: [20, 21], effectiveTags: ['レミリア', '東方'], effectiveTagLabels: ['レミリア', '東方'] },
      }),
      allPosts: () => state.allPosts,
      t,
      charCandidatesFor: () => [],
      relatedTagCandidates: () => [],
    });
    expect(withParent.posterTagsOf('x:9')).toEqual(['レミリア']);
    expect(withParent.posterTagEntriesOf('x:9').map((e) => e.id)).toEqual([20, 21]);
  });

  test('キーが無ければ []', () => {
    expect(api.posterTagsOf('zzz')).toEqual([]);
  });

  // #23 St1: membersOf union — a merged poster's tags are the union across every
  // posterKey its group bundles, not just the primary's own entry.
  test('membersOf 注入時は複数キーのタグを和集合で返す（#23 St1）', () => {
    const merged = makeTags({
      tagTypes: () => state.tagTypes,
      tagLabels: () => state.tagLabels,
      posterTags: () => posterTags,
      allPosts: () => state.allPosts,
      t,
      charCandidatesFor: () => [],
      relatedTagCandidates: () => [],
      membersOf: (key) => (key === 'x:1' ? ['x:1', 'x:2'] : [key]),
    });
    expect(merged.posterTagsOf('x:1').slice().sort()).toEqual(['CharX', 'WorkA', 'あんず', '資料'].sort());
  });

  test('membersOf 未注入なら単一キーのまま（既定・後方互換）', () => {
    expect(api.posterTagsOf('x:1')).toEqual(['WorkA', '資料']);
  });

  // Order: work (WorkA) → character (CharX) → general (あんず/資料 in ja collation order)
  test('種別順の並び', () => {
    expect(api.posterFilterVocab().map((e) => e.name)).toEqual(['WorkA', 'CharX', ...['あんず', '資料'].sort(ja)]);
  });

  // #810: one row per ENTITY, so two same-named poster tags are two entries.
  test('同名2実体は2エントリになる', () => {
    const homonyms = makeTags({
      tagTypes: () => state.tagTypes,
      tagLabels: () => state.tagLabels,
      posterTags: () => ({ 'x:1': posterRow([[30, 'alice']]), 'x:2': posterRow([[31, 'alice']]) }),
      allPosts: () => state.allPosts,
      t,
      charCandidatesFor: () => [],
      relatedTagCandidates: () => [],
    });
    expect(
      homonyms
        .posterFilterVocab()
        .map((e) => e.id)
        .sort(),
    ).toEqual([30, 31]);
  });
});

describe('groupedTagVocab（post スコープ）', () => {
  test('種別セクションが先、末尾に未分類', () => {
    expect(api.groupedTagVocab().map((g) => g.name)).toEqual(['作品', 'キャラ', '未分類']);
  });

  test('作品セクションは種別つきの作品を全部載せる', () => {
    expect(api.groupedTagVocab()[0].tags).toEqual(['WorkA', 'WorkB'].sort(ja));
  });

  test('未分類プールは「実際に付いている一般タグ」だけ（種別つきは除外）', () => {
    expect(api.groupedTagVocab()[2].tags).toEqual(['俯瞰', '自由帳'].sort(ja));
  });

  test('セクション見出しはカスタムラベルを使う', () => {
    state.tagLabels = { work: 'シリーズ' };
    expect(api.groupedTagVocab()[0].name).toBe('シリーズ');
  });
});

describe('groupedTagVocab（poster スコープ）', () => {
  test('セクション構成は post と共通', () => {
    expect(api.groupedTagVocab({ scope: 'poster' }).map((g) => g.name)).toEqual(['作品', 'キャラ', '未分類']);
  });

  // The general pool comes from posterTags (資料/あんず), not from the post-side pool
  test('一般プールは posterTags 由来', () => {
    const out = api.groupedTagVocab({ scope: 'poster' });
    const general = out.find((g) => g.name === '未分類');
    expect(general?.tags).toEqual(['あんず', '資料'].sort(ja));
  });
});

describe('inspectorTagPickerData', () => {
  test('vocabGroups は groupedTagVocab と同じ構成＋各項目に kind を持つ', () => {
    const d = api.inspectorTagPickerData(['WorkA'], [], 'post');
    expect(d.vocabGroups[0].items.every((it) => it.kind === 'work')).toBe(true);
  });

  test('取り込み元ハッシュタグは重複排除（壊れた形は無視）', () => {
    const d = api.inspectorTagPickerData(['WorkA'], [{ hashtags: ['ht1', 'ht1', 'ht2'] }, { hashtags: 'bad' }], 'post');
    expect(d.srcTagsForPicker.map((s) => s.tag)).toEqual(['ht1', 'ht2']);
  });

  describe('ティア1（作品→キャラ）', () => {
    beforeEach(() => {
      state.charCands = [
        ['CharX', 5],
        ['CharY', 3],
      ];
      state.relatedCands = [{ tag: '資料', withTag: 'WorkA', count: 4 }];
    });

    test('選択済みキャラは候補から外れる', () => {
      const d = api.inspectorTagPickerData(['WorkA', 'CharX'], [], 'post');
      expect(d.coocGroups[0].items.map((i) => i.tag)).toEqual(['CharY']);
    });

    test('作品1件の見出しは editCoocCharsOf', () => {
      const d = api.inspectorTagPickerData(['WorkA', 'CharX'], [], 'post');
      expect(d.coocGroups[0].name).toBe('WorkA のキャラ');
    });

    test('項目の title が根拠（共起回数）を持つ', () => {
      const d = api.inspectorTagPickerData(['WorkA', 'CharX'], [], 'post');
      expect(d.coocGroups[0].items[0].title).toBe('WorkA と 3 回共起');
    });

    test('8件で打ち切る', () => {
      state.charCands = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((n, i) => [`c${i + 1}`, n]);
      const d = api.inspectorTagPickerData(['WorkA', 'WorkB'], [], 'post');
      expect(d.coocGroups[0].items).toHaveLength(8);
    });

    test('作品が複数なら見出しは editCoocChars・根拠は ・ 連結', () => {
      state.charCands = [['c1', 9]];
      const d = api.inspectorTagPickerData(['WorkA', 'WorkB'], [], 'post');
      expect(d.coocGroups[0].name).toBe('このキャラたち');
      expect(d.coocGroups[0].items[0].title).toBe('WorkA・WorkB と 9 回共起');
    });
  });

  describe('ティア2（関連タグ）', () => {
    test('post スコープでは出る', () => {
      state.charCands = [['CharY', 3]];
      state.relatedCands = [{ tag: '資料', withTag: 'WorkA', count: 4 }];
      const d = api.inspectorTagPickerData(['WorkA'], [], 'post');
      expect(d.coocGroups[1].name).toBe('よく一緒に付くタグ');
    });

    test('ティア1と重複しないよう exclude 集合を渡す', () => {
      state.charCands = [['CharY', 3]];
      state.relatedCands = [{ tag: '資料', withTag: 'WorkA', count: 4 }];
      api.inspectorTagPickerData(['WorkA'], [], 'post');
      const relCall = state.coocCalls.find((c) => c[0] === 'related');
      expect(relCall[2].exclude.has('CharY')).toBe(true);
    });

    test('poster スコープでは呼ばれもしない', () => {
      state.relatedCands = [{ tag: 'x', withTag: 'y', count: 2 }];
      const d = api.inspectorTagPickerData(['WorkA'], [], 'poster');
      expect(d.coocGroups).toHaveLength(0);
      expect(state.coocCalls.some((c) => c[0] === 'related')).toBe(false);
    });
  });

  test('引数が null でも壊れない', () => {
    const d = api.inspectorTagPickerData(null, null, undefined);
    expect(d.vocabGroups.length).toBeGreaterThan(0);
    expect(d.srcTagsForPicker).toEqual([]);
    expect(d.coocGroups).toEqual([]);
  });
});

describe('sameTags', () => {
  test('順序を問わず等しい', () => {
    expect(sameTags(['a', 'b'], ['b', 'a'])).toBe(true);
  });

  test('長さ違い', () => {
    expect(sameTags(['a'], ['a', 'b'])).toBe(false);
  });

  test('要素違い', () => {
    expect(sameTags(['a', 'b'], ['a', 'c'])).toBe(false);
  });

  test('どちらも空', () => {
    expect(sameTags([], [])).toBe(true);
  });
});

// Visible even when the whole store is swapped, because it's read via getters
test('live getter: ストアの丸ごと差し替えが反映される', () => {
  state.allPosts = [{ captureId: 'q1', tags: ['新規タグ'] }];
  state.tagTypes = {};

  const out = api.groupedTagVocab();
  expect(out).toHaveLength(1);
  expect(out[0].tags).toEqual(['新規タグ']);
});

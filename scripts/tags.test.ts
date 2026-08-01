// Pure unit tests for tags.ts (the 8th slice extracted from viewer.js). Verifies
// tagKindOf/kindLabel (fallback for custom labels), posterTagsOf/posterFilterVocab
// (ordering by kind), groupedTagVocab (kind sections, separate general tag pools for
// post vs poster, query filtering), inspectorTagPickerData (vocab shape, imported
// hashtag source, co-occurrence suggestion tiers), and sameTags, all via stub deps
// injection.

import { beforeEach, describe, expect, test } from 'vitest';
import { makeTags, sameTags } from '../app/src/renderer/src/services/tags';

const ja = (a: string, b: string) => a.localeCompare(b, 'ja');

// --- stub environment ---
// Read via getters, so swapping state inside a test is immediately reflected on the api side.
let state: {
  tagTypes: Record<string, string>;
  tagLabels: Record<string, any>;
  allPosts: any[];
  charCands: any[];
  relatedCands: any[];
  coocCalls: any[];
};
let api: ReturnType<typeof makeTags>;

const posterTags = {
  'x:1': ['WorkA', '資料'],
  'x:2': ['CharX', 'あんず'],
  'x:3': 'not-an-array', // broken entry — must not throw
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
    tagTypes: { WorkA: 'work', WorkB: 'work', CharX: 'character' },
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

describe('tagKindOf / kindLabel', () => {
  test('種別つきタグ', () => {
    expect(api.tagKindOf('WorkA')).toBe('work');
  });

  test('一般タグは null', () => {
    expect(api.tagKindOf('俯瞰')).toBeNull();
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

describe('posterTagsOf / posterFilterVocab', () => {
  test('配列はそのまま', () => {
    expect(api.posterTagsOf('x:1')).toEqual(['WorkA', '資料']);
  });

  test('壊れたエントリは []', () => {
    expect(api.posterTagsOf('x:3')).toEqual([]);
  });

  test('キーが無ければ []', () => {
    expect(api.posterTagsOf('zzz')).toEqual([]);
  });

  // Order: work (WorkA) → character (CharX) → general (あんず/資料 in ja collation order)
  test('種別順の並び', () => {
    expect(api.posterFilterVocab()).toEqual(['WorkA', 'CharX', ...['あんず', '資料'].sort(ja)]);
  });
});

describe('groupedTagVocab（post スコープ）', () => {
  test('種別セクションが先、末尾に未分類', () => {
    expect(api.groupedTagVocab('').map((g) => g.name)).toEqual(['作品', 'キャラ', '未分類']);
  });

  test('作品セクションは種別つきの作品を全部載せる', () => {
    expect(api.groupedTagVocab('')[0].tags).toEqual(['WorkA', 'WorkB'].sort(ja));
  });

  test('未分類プールは「実際に付いている一般タグ」だけ（種別つきは除外）', () => {
    expect(api.groupedTagVocab('')[2].tags).toEqual(['俯瞰', '自由帳'].sort(ja));
  });

  test('クエリは大小文字を区別せず絞り込む', () => {
    const out = api.groupedTagVocab('work');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: '作品', tags: ['WorkA', 'WorkB'] });
  });

  test('セクション見出しはカスタムラベルを使う', () => {
    state.tagLabels = { work: 'シリーズ' };
    expect(api.groupedTagVocab('')[0].name).toBe('シリーズ');
  });
});

describe('groupedTagVocab（poster スコープ）', () => {
  test('セクション構成は post と共通', () => {
    expect(api.groupedTagVocab('', { scope: 'poster' }).map((g) => g.name)).toEqual(['作品', 'キャラ', '未分類']);
  });

  // The general pool comes from posterTags (資料/あんず), not from the post-side pool
  test('一般プールは posterTags 由来', () => {
    const out = api.groupedTagVocab('', { scope: 'poster' });
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

  const out = api.groupedTagVocab('');
  expect(out).toHaveLength(1);
  expect(out[0].tags).toEqual(['新規タグ']);
});

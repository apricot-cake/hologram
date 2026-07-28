// API スキーマカナリア（#191）の判定部（scripts/lib-schema-canary.cts）の単体テスト。
// ネットワークもファイルも要らない純関数だけを対象にする＝取得側（schema-canary.cts）は
// 実サンプルへの実走で確かめる領分。
//
// ここで守っているのは「鳴るべき時に鳴り、鳴るべきでない時に黙る」の両方:
//   - 消える／増える／型が痩せる を拾えること
//   - 空配列・空オブジェクト・ID をキーにしたマップで誤検知しないこと（偽陽性は
//     カナリアを読まれなくするので、消失を見落とすのと同じくらい致命的）

import { describe, expect, test } from 'vitest';
import { advanceStreak, carryBaseline, diffShapes, endpointMissingDiff, MISSING_STREAK_ALARM, shapeOf } from './lib-schema-canary.cts';

describe('shapeOf（値を捨てて構造だけ取り出す）', () => {
  test('入れ子のオブジェクトはパスに展開され、値は残らない', () => {
    expect(shapeOf({ user: { name: 'alice', id: 12, verified: true } })).toEqual({
      '': 'object',
      user: 'object',
      'user.id': 'number',
      'user.name': 'string',
      'user.verified': 'boolean',
    });
  });

  test('配列は要素シェイプを union へ畳む', () => {
    expect(shapeOf({ media: [{ url: 'a' }, { url: 'b', alt: null }] })).toEqual({
      '': 'object',
      media: 'array',
      'media[]': 'object',
      'media[].alt': 'null',
      'media[].url': 'string',
    });
  });

  test('null は独立した型（string と混ざれば union）', () => {
    expect(shapeOf({ items: [{ v: 'x' }, { v: null }] })['items[].v']).toBe('null|string');
  });

  test('空配列は unknown＝「消えた」と区別できる印を残す', () => {
    expect(shapeOf({ tags: [] })).toEqual({ '': 'object', tags: 'array', 'tags[]': 'unknown' });
  });

  test('空オブジェクトも同じ扱い（X の tombstone:{} 型）', () => {
    expect(shapeOf({ tombstone: {} })['tombstone{}']).toBe('unknown');
  });

  test('unknown は実型が1つでも分かった時点で落ちる', () => {
    // 同じパスに空配列と非空配列が両方来るケース（ネストした配列）
    expect(shapeOf({ rows: [{ cells: [] }, { cells: ['a'] }] })['rows[].cells[]']).toBe('string');
  });

  test('ID をキーにしたオブジェクトはマップとして {} へ畳む（pixiv userIllusts 型）', () => {
    expect(shapeOf({ userIllusts: { '147572770': null, '146691579': { title: 'x' } } })).toEqual({
      '': 'object',
      userIllusts: 'object',
      'userIllusts{}': 'null|object',
      'userIllusts{}.title': 'string',
    });
  });

  test('絵文字をキーにしたオブジェクトもマップ（Misskey reactions 型）', () => {
    expect(shapeOf({ reactions: { ':blobcat@.:': 3, '👍': 1 } })['reactions{}']).toBe('number');
  });

  test('フィールド名らしいキーが1つでもあればレコードのまま（畳むと監視が消えるので安全側）', () => {
    const shape = shapeOf({ urls: { mini: 'a', original: 'b' } });
    expect(shape['urls.original']).toBe('string');
    expect(shape['urls{}']).toBeUndefined();
  });
});

describe('diffShapes（前回との突き合わせ）', () => {
  test('パスが消えれば lost', () => {
    const diff = diffShapes({ a: 'object', 'a.b': 'string' }, { a: 'object' });
    expect(diff.lost).toEqual([{ path: 'a.b', types: ['string'] }]);
    expect(diff.gained).toEqual([]);
  });

  test('パスが増えれば gained', () => {
    expect(diffShapes({ a: 'object' }, { a: 'object', 'a.b': 'string' }).gained).toEqual([{ path: 'a.b', types: ['string'] }]);
  });

  test('型が痩せた（常に null になった）のも消失として扱う', () => {
    expect(diffShapes({ v: 'null|string' }, { v: 'null' }).lost).toEqual([{ path: 'v', types: ['string'] }]);
  });

  test('型が増えただけなら gained（無害な報告）', () => {
    const diff = diffShapes({ v: 'string' }, { v: 'null|string' });
    expect(diff.lost).toEqual([]);
    expect(diff.gained).toEqual([{ path: 'v', types: ['null'] }]);
  });

  test('部分木ごと消えた時は最上位の1行だけ報告する（子で埋もれさせない）', () => {
    const prev = { t: 'object', 't.text': 'object', 't.text.text': 'string', 't.text.rich': 'object' };
    const diff = diffShapes(prev, { t: 'object' });
    expect(diff.lost.map((l) => l.path)).toEqual(['t.text']);
  });

  test('部分木ごと増えた時も最上位の1行だけ', () => {
    const diff = diffShapes({ t: 'object' }, { t: 'object', 't.q': 'object', 't.q.id': 'string' });
    expect(diff.gained.map((g) => g.path)).toEqual(['t.q']);
  });

  test('今回だけ空配列なら比較不能＝消失にしない', () => {
    const diff = diffShapes({ m: 'array', 'm[]': 'object', 'm[].url': 'string' }, { m: 'array', 'm[]': 'unknown' });
    expect(diff.lost).toEqual([]);
    expect(diff.unobservable).toEqual(['m[]']);
  });

  test('比較不能なパスの子は報告しない（空配列1回で子が全部消失に見えるのを防ぐ）', () => {
    const diff = diffShapes({ 'm[]': 'object', 'm[].url': 'string' }, { 'm[]': 'unknown' });
    expect(diff.lost).toEqual([]);
    expect(diff.gained).toEqual([]);
  });

  test('毎回空のままなら何も言わない（同じ行を出し続けない）', () => {
    const diff = diffShapes({ 'm[]': 'unknown' }, { 'm[]': 'unknown' });
    expect(diff.unobservable).toEqual([]);
    expect(diff.lost).toEqual([]);
  });

  test('変化が無ければ全部空', () => {
    const shape = shapeOf({ a: { b: [1, 2] } });
    expect(diffShapes(shape, shape)).toEqual({ lost: [], gained: [], unobservable: [] });
  });
});

describe('advanceStreak（ヒステリシス＝2回連続で初めて警報）', () => {
  const lost = { lost: [{ path: 'a.b', types: ['string'] }], gained: [], unobservable: [] };

  test('1回目は様子見', () => {
    const out = advanceStreak({}, lost);
    expect(out.alarms).toEqual([]);
    expect(out.pending).toEqual([{ path: 'a.b', type: 'string', count: 1 }]);
    expect(out.streak).toEqual({ 'a.b :: string': 1 });
  });

  test('2回目で警報', () => {
    const out = advanceStreak({ 'a.b :: string': 1 }, lost);
    expect(out.alarms).toEqual([{ path: 'a.b', type: 'string', count: MISSING_STREAK_ALARM }]);
    expect(out.pending).toEqual([]);
  });

  test('警報を出したらカウンタを持ち越さない（同じ警報を毎回鳴らさない）', () => {
    expect(advanceStreak({ 'a.b :: string': 1 }, lost).streak).toEqual({});
  });

  test('復活すればカウンタはリセット', () => {
    expect(advanceStreak({ 'a.b :: string': 1 }, { lost: [], gained: [], unobservable: [] }).streak).toEqual({});
  });

  test('比較不能になった時はリセットせず据え置く（空配列は復活の証拠ではない）', () => {
    const out = advanceStreak({ 'm[].url :: string': 1 }, { lost: [], gained: [], unobservable: ['m[]'] });
    expect(out.streak).toEqual({ 'm[].url :: string': 1 });
  });

  test('エンドポイントごと取得されなくなった場合も同じヒステリシスに乗る', () => {
    expect(advanceStreak({}, endpointMissingDiff()).pending).toEqual([{ path: '(endpoint)', type: 'present', count: 1 }]);
    expect(advanceStreak({ '(endpoint) :: present': 1 }, endpointMissingDiff()).alarms).toHaveLength(1);
  });
});

describe('carryBaseline（次回の基準に何を残すか）', () => {
  test('様子見中のパスは基準に残す＝残さないと2回目が成立しない', () => {
    const prev = { a: 'object', 'a.b': 'string' };
    const next = { a: 'object' };
    const diff = diffShapes(prev, next);
    const outcome = advanceStreak({}, diff);
    expect(carryBaseline(prev, next, diff, outcome.pending)['a.b']).toBe('string');
  });

  test('警報を出したパスは基準から落とす＝新しい実態を受け入れる', () => {
    const prev = { a: 'object', 'a.b': 'string' };
    const next = { a: 'object' };
    const diff = diffShapes(prev, next);
    const outcome = advanceStreak({ 'a.b :: string': 1 }, diff);
    expect(carryBaseline(prev, next, diff, outcome.pending)).toEqual({ a: 'object' });
  });

  test('比較不能なパスとその子は基準に残す＝空配列1回で記憶を消さない', () => {
    const prev = { 'm[]': 'object', 'm[].url': 'string' };
    const next = { 'm[]': 'unknown' };
    const diff = diffShapes(prev, next);
    expect(carryBaseline(prev, next, diff, [])).toEqual({ 'm[]': 'object', 'm[].url': 'string' });
  });

  test('増えたパスはそのまま基準に入る', () => {
    const prev = { a: 'object' };
    const next = { a: 'object', 'a.b': 'string' };
    const diff = diffShapes(prev, next);
    expect(carryBaseline(prev, next, diff, [])).toEqual(next);
  });

  test('2回の実行で「様子見 → 警報 → 受け入れ」が一巡する', () => {
    const original = shapeOf({ tombstone: { text: { text: 'limits who can view' } } });
    const degraded = shapeOf({ tombstone: {} });
    // 1回目
    const d1 = diffShapes(original, degraded);
    const o1 = advanceStreak({}, d1);
    const base1 = carryBaseline(original, degraded, d1, o1.pending);
    expect(o1.alarms).toEqual([]);
    expect(base1['tombstone.text']).toBe('object');
    // 2回目＝同じ欠けが続く
    const d2 = diffShapes(base1, degraded);
    const o2 = advanceStreak(o1.streak, d2);
    expect(o2.alarms.map((a) => a.path)).toEqual(['tombstone.text']);
    const base2 = carryBaseline(base1, degraded, d2, o2.pending);
    // 3回目＝受け入れ済みなので静か
    const o3 = advanceStreak(o2.streak, diffShapes(base2, degraded));
    expect(o3.alarms).toEqual([]);
    expect(o3.pending).toEqual([]);
  });
});

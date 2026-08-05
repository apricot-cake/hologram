// Unit tests for #50's arithmetic half: app/src/main/lib-ai-tags.ts (label
// file, preprocessing, score decoding) and the derived.db tables that hold what
// it produces.
//
// The preprocessing assertions are the ones that matter most. Every one of
// them — BGR order, WHITE padding, centring, no normalisation — is a
// requirement of the model's own training, and getting one wrong does not throw
// or look broken: it produces confident scores for a picture that is not the
// one on screen. That silence is why #50 rejected letting a generic image
// processor guess at them.
//
// The half that CANNOT be tested here is which byte order nativeImage hands
// back, because that needs Electron. scripts/test-app-ai-tags.cts pins it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { clearAiTagOutput, derivedDbFile, dismissAiTag, openDerivedDatabase, purgeDerivedForCapture, readAiTagCandidates, writeAiTags } from '../app/src/main/lib-derived-db';
import { decodeTaggerOutput, fitLongEdge, letterboxToTaggerInput, normalizeTagName, parseSelectedTags, TAG_CATEGORY, TAGGER_INPUT_SIZE, TAGGER_THRESHOLDS } from '../app/src/main/lib-ai-tags';

const dirs: string[] = [];
function mkdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ai-tags-'));
  dirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

describe('normalizeTagName', () => {
  test('アンダースコアはスペースに置き換える', () => {
    expect(normalizeTagName('hair_ornament')).toBe('hair ornament');
    expect(normalizeTagName('long_hair')).toBe('long hair');
    expect(normalizeTagName('solo')).toBe('solo');
  });

  // 顔文字タグは置換すると別物になる(`^_^` は「顔」であって単語2つではない)。
  test('顔文字タグはそのまま残す', () => {
    for (const k of ['0_0', '^_^', '>_<', '@_@', '|_|', '||_||', '+_-', '<|>_<|>']) {
      expect(normalizeTagName(k)).toBe(k);
    }
  });
});

describe('parseSelectedTags', () => {
  test('name と category を出力順のまま読む', () => {
    const vocab = parseSelectedTags('tag_id,name,category,count\n1,solo,0,100\n2,hatsune_miku,4,50\n3,general,9,10\n');
    expect(vocab.names).toEqual(['solo', 'hatsune miku', 'general']);
    expect(vocab.categories).toEqual([0, 4, 9]);
  });

  // 実ファイルに1行だけ存在する形 — `612924,"don't_say_""lazy""",0,1062`。
  // split(',') で読むとこの行以降の category が1つずれ、タグの種別が黙って
  // 入れ替わる。
  test('引用符で囲まれ、内部に二重引用符を含むフィールドを正しく読む', () => {
    const vocab = parseSelectedTags('tag_id,name,category,count\n612924,"don\'t_say_""lazy""",0,1062\n612925,solo,4,5\n');
    expect(vocab.names).toEqual(['don\'t say "lazy"', 'solo']);
    expect(vocab.categories).toEqual([0, 4]);
  });

  test('列の順番が違っても見出しで引く', () => {
    const vocab = parseSelectedTags('category,name\n4,hatsune_miku\n');
    expect(vocab).toEqual({ names: ['hatsune miku'], categories: [4] });
  });

  test('見出しが無い/空のファイルは受け取らない', () => {
    expect(() => parseSelectedTags('')).toThrow(/empty/);
    expect(() => parseSelectedTags('a,b\n1,2\n')).toThrow(/name\/category/);
  });
});

describe('fitLongEdge', () => {
  test('長辺を目標サイズに合わせ、比率を保つ', () => {
    expect(fitLongEdge(1000, 500, 448)).toEqual({ width: 448, height: 224 });
    expect(fitLongEdge(500, 1000, 448)).toEqual({ width: 224, height: 448 });
    expect(fitLongEdge(448, 448, 448)).toEqual({ width: 448, height: 448 });
  });

  test('目標より小さい画像は拡大する(参照実装と同じ)', () => {
    expect(fitLongEdge(100, 50, 448)).toEqual({ width: 448, height: 224 });
  });

  // 極端に細長い画像で短辺が 0 に丸まると、以降の全計算が空のテンソルになる。
  test('極端な縦横比でも短辺は 1 を下回らない', () => {
    expect(fitLongEdge(10000, 3, 448).height).toBe(1);
    expect(fitLongEdge(3, 10000, 448).width).toBe(1);
  });
});

describe('letterboxToTaggerInput', () => {
  // 4x4 のキャンバスに 2x2 の画像を中央(left=1, top=1)へ置く。
  // 画素は R=(255,0,0) / G=(0,255,0) / B=(0,0,255) / K=(0,0,0)。
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]);
  const bgra = new Uint8Array([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);

  const at = (out: Float32Array, x: number, y: number, size = 4) => [out[(y * size + x) * 3], out[(y * size + x) * 3 + 1], out[(y * size + x) * 3 + 2]];

  test('出力は BGR で、入力のチャンネル順が違っても同じ結果になる', () => {
    const fromRgba = letterboxToTaggerInput(rgba, 2, 2, 'rgba', 4);
    const fromBgra = letterboxToTaggerInput(bgra, 2, 2, 'bgra', 4);
    expect(Array.from(fromRgba)).toEqual(Array.from(fromBgra));
    // 赤い画素は BGR では (0, 0, 255) になる — ここが逆だと色が入れ替わる。
    expect(at(fromRgba, 1, 1)).toEqual([0, 0, 255]);
    expect(at(fromRgba, 2, 1)).toEqual([0, 255, 0]);
    expect(at(fromRgba, 1, 2)).toEqual([255, 0, 0]);
    expect(at(fromRgba, 2, 2)).toEqual([0, 0, 0]);
  });

  // 詰め物は白。黒で詰まると(RawImage.pad() の既定がまさにそれ)モデルが学習
  // した入力と違うものを見ることになる。
  test('余白は白(255)で埋め、画像は中央に置く', () => {
    const out = letterboxToTaggerInput(rgba, 2, 2, 'rgba', 4);
    for (const [x, y] of [
      [0, 0],
      [3, 0],
      [0, 3],
      [3, 3],
      [2, 0],
      [0, 2],
    ]) {
      expect(at(out, x, y)).toEqual([255, 255, 255]);
    }
  });

  test('値は 0-255 のまま(正規化しない)で、長さは size*size*3', () => {
    const out = letterboxToTaggerInput(rgba, 2, 2, 'rgba', 4);
    expect(out.length).toBe(4 * 4 * 3);
    expect(Math.max(...out)).toBe(255);
    expect(out).toBeInstanceOf(Float32Array);
  });

  // サムネイルキャッシュは JPEG なので実運用では常に不透明。それでも合成して
  // おくのは、透過を落として黒く出る失敗が「透けた」ではなく「暗くなった」と
  // いう見えない形で出るから。
  test('半透明の画素は白へ合成する(切り捨てない)', () => {
    const halfRed = new Uint8Array([255, 0, 0, 128]);
    const out = letterboxToTaggerInput(halfRed, 1, 1, 'rgba', 3);
    // a = 128/255, so the untouched channels land on 255*(1-a) = 127, not 0.
    const [b, g, r] = at(out, 1, 1, 3);
    expect(r).toBeCloseTo(255);
    expect(g).toBeCloseTo(127);
    expect(b).toBeCloseTo(127);
  });

  test('キャンバスに収まらない画像とバイト数の足りないバッファは受け取らない', () => {
    expect(() => letterboxToTaggerInput(rgba, 5, 2, 'rgba', 4)).toThrow(/does not fit/);
    expect(() => letterboxToTaggerInput(new Uint8Array(4), 2, 2, 'rgba', 4)).toThrow(/expected/);
  });

  test('既定のキャンバスはモデルが宣言する 448', () => {
    expect(TAGGER_INPUT_SIZE).toBe(448);
    expect(letterboxToTaggerInput(rgba, 2, 2, 'rgba').length).toBe(448 * 448 * 3);
  });
});

describe('decodeTaggerOutput', () => {
  const vocab = {
    names: ['solo', 'smile', 'hatsune miku', 'kagamine rin', 'general', 'explicit'],
    categories: [TAG_CATEGORY.general, TAG_CATEGORY.general, TAG_CATEGORY.character, TAG_CATEGORY.character, TAG_CATEGORY.rating, TAG_CATEGORY.rating],
  };

  test('種別ごとの閾値で切る(general 0.35 / character 0.85)', () => {
    expect(TAGGER_THRESHOLDS).toEqual({ general: 0.35, character: 0.85 });
    // smile (0.34) と kagamine rin (0.84) はどちらも自分の閾値に届かない。
    const { tags } = decodeTaggerOutput([0.9, 0.34, 0.86, 0.84, 0, 0], vocab);
    expect(tags.map((t) => t.name)).toEqual(['solo', 'hatsune miku']);
  });

  test('スコアの高い順に並ぶ', () => {
    const { tags } = decodeTaggerOutput([0.4, 0.99, 0.9, 0, 0, 0], vocab);
    expect(tags.map((t) => t.name)).toEqual(['smile', 'hatsune miku', 'solo']);
  });

  // rating は候補にせず記録だけ残す(2026-07-11 確定) — 閾値も掛けない。
  test('rating は候補に混ぜず、全ラベルを記録用に返す', () => {
    const { tags, ratings } = decodeTaggerOutput([0, 0, 0, 0, 0.91, 0.02], vocab);
    expect(tags).toEqual([]);
    expect(ratings.map((r) => r.name)).toEqual(['general', 'explicit']);
    expect(ratings[0].score).toBeCloseTo(0.91);
  });

  // モデルと selected_tags.csv の版がずれると、全タグが黙って別の名前になる。
  test('スコア数と語彙数が食い違ったら止まる', () => {
    expect(() => decodeTaggerOutput([0.5], vocab)).toThrow(/6 rows/);
  });

  test('活性化関数を掛けない(グラフの出力をそのまま比較する)', () => {
    const { tags } = decodeTaggerOutput([0.36, 0.36, 0, 0, 0, 0], vocab);
    // softmax を掛けていれば 2 件とも 0.5 未満へ潰れて閾値を割る。
    expect(tags.map((t) => t.score)).toEqual([0.36, 0.36]);
  });
});

describe('derived.db の AI タグテーブル', () => {
  const sample = (over: Partial<Parameters<typeof writeAiTags>[1]> = {}) => ({
    captureId: 'cap-1',
    assetRef: 'image',
    segment: 0,
    modelId: 'SmilingWolf/wd-vit-tagger-v3',
    modelRev: 'rev-a',
    tags: [
      { name: 'solo', category: 0, score: 0.9 },
      { name: 'smile', category: 0, score: 0.5 },
    ],
    ratings: [{ rating: 'general', score: 0.8 }],
    ...over,
  });

  test('候補と rating を書き、modelId / modelRev を刻む', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    writeAiTags(sqlite, sample());
    const rows = readAiTagCandidates(sqlite, 'cap-1');
    expect(rows.map((r) => r.name)).toEqual(['solo', 'smile']);
    expect(rows[0]).toMatchObject({ assetRef: 'image', segment: 0, category: 0, modelId: 'SmilingWolf/wd-vit-tagger-v3', modelRev: 'rev-a' });
    expect(sqlite.prepare('SELECT rating, score FROM ai_tag_ratings').all()).toEqual([{ rating: 'general', score: 0.8 }]);
    sqlite.close();
  });

  // 新しい rev で流し直したとき、前の rev だけが出していたタグが残り続けては
  // いけない(upsert ではなく置き換えである理由)。
  test('同じアセットを流し直すと前回の候補は残らない', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    writeAiTags(sqlite, sample());
    writeAiTags(sqlite, sample({ modelRev: 'rev-b', tags: [{ name: 'solo', category: 0, score: 0.95 }], ratings: [] }));
    const rows = readAiTagCandidates(sqlite, 'cap-1');
    expect(rows.map((r) => r.name)).toEqual(['solo']);
    expect(rows[0].modelRev).toBe('rev-b');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM ai_tag_ratings').get()).toEqual({ n: 0 });
    sqlite.close();
  });

  // 受け入れ条件:「この候補を出さない」で候補が消え、再バックフィルでも復活しない。
  test('却下したタグは候補から外れ、流し直しても戻らない', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    writeAiTags(sqlite, sample());
    dismissAiTag(sqlite, 'cap-1', 'smile');
    expect(readAiTagCandidates(sqlite, 'cap-1').map((r) => r.name)).toEqual(['solo']);
    writeAiTags(sqlite, sample());
    expect(readAiTagCandidates(sqlite, 'cap-1').map((r) => r.name)).toEqual(['solo']);
    sqlite.close();
  });

  // 却下はレコード単位 — 同じタグでも別のレコードでは出続ける。
  test('却下は他のレコードには効かない', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    writeAiTags(sqlite, sample());
    writeAiTags(sqlite, sample({ captureId: 'cap-2' }));
    dismissAiTag(sqlite, 'cap-1', 'smile');
    expect(readAiTagCandidates(sqlite, 'cap-2').map((r) => r.name)).toEqual(['solo', 'smile']);
    sqlite.close();
  });

  // 受け入れ条件: モデルを削除すると候補が消え、再取得すれば作り直される
  // (＝進捗行も一緒に消える)。却下はユーザーの判断なので残す。
  test('モデル撤去で候補・rating・進捗行は消え、却下は残る', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    writeAiTags(sqlite, sample());
    dismissAiTag(sqlite, 'cap-1', 'smile');
    sqlite.prepare("INSERT INTO derived_progress (captureId, assetRef, jobKind, indexedSegments, totalSegments, updatedAt) VALUES ('cap-1','image','ai-tags',1,1,'2026-01-01')").run();
    sqlite.prepare("INSERT INTO derived_progress (captureId, assetRef, jobKind, indexedSegments, totalSegments, updatedAt) VALUES ('cap-1','image','ocr',1,1,'2026-01-01')").run();

    clearAiTagOutput(sqlite, 'ai-tags');

    const n = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
    expect(n('SELECT COUNT(*) AS n FROM ai_tags')).toBe(0);
    expect(n('SELECT COUNT(*) AS n FROM ai_tag_ratings')).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM derived_progress WHERE jobKind = 'ai-tags'")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM derived_progress WHERE jobKind = 'ocr'")).toBe(1);
    expect(n('SELECT COUNT(*) AS n FROM ai_tag_dismissals')).toBe(1);
    sqlite.close();
  });

  // 受け入れ条件: レコードを完全削除すると3テーブルの行も消える。3本とも
  // captureId 列を持つので purgeDerivedForCapture の動的探索に自動で乗る。
  test('完全削除の連動に3テーブルとも乗る', () => {
    const { sqlite } = openDerivedDatabase(derivedDbFile(mkdir()));
    writeAiTags(sqlite, sample());
    writeAiTags(sqlite, sample({ captureId: 'cap-2' }));
    dismissAiTag(sqlite, 'cap-1', 'smile');

    purgeDerivedForCapture(sqlite, 'cap-1');

    const n = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n;
    expect(n("SELECT COUNT(*) AS n FROM ai_tags WHERE captureId = 'cap-1'")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM ai_tag_ratings WHERE captureId = 'cap-1'")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM ai_tag_dismissals WHERE captureId = 'cap-1'")).toBe(0);
    expect(n("SELECT COUNT(*) AS n FROM ai_tags WHERE captureId = 'cap-2'")).toBe(2);
    sqlite.close();
  });
});

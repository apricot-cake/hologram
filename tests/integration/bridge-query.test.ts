// ブリッジの保存済み索引＝タイムラインの「保存済み」の印の読み経路（#54）。答えを
// 組み立てる3つの出所（アプリが書く bridge-saved-index.json のスナップショット、それ
// より新しい loose な inbox エンベロープ、ブリッジ自身のジャーナル＝#5 St6 / #299 の
// .index.json とサイドカー直読みを置き換えたもの）と、レンダラーと共有する URL の表記
// 正規化、そして長生きするポートの答えを最新に保つキャッシュ無効化を対象にする。
//
// この一式は順番に状態を積み上げていく（各節の書き込みが次の節の前提になる）ので、
// テストの宣言順に意味がある。

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { buildEnvelope } from '../../native-host/inbox.mts';
import { normalizePostRecord } from '../../native-host/post-record.mts';
import { postKeyOf } from '../../native-host/post-key.mts';

let saveFolder: string;
let configDir: string;
let handleQuery: any;
let noteSaved: any;
let _resetSavedIndex: any;

const ask = async (...urls: unknown[]) => (await handleQuery({ type: 'query', urls })).results;
// 応答は投稿ごとに {id, media}（#334）。captureId だけが欲しい節はこれ経由で読む。
const askId = async (url: string) => (await ask(url))[url]?.id ?? null;
// 投稿の保存済みの絵＝ライブラリが記録した URL の配列（並びは media 行の seq に対応）。
const askMedia = async (url: string) => (await ask(url))[url]?.media ?? null;
const askTotal = async (url: string) => (await ask(url))[url]?.total ?? null;

// ブリッジが書くのと同じ形の inbox エンベロープ（native-host/inbox.mts の
// writeInboxEvent と等価）。eventId（先頭の epoch）が、scanRecentInbox の読む保存時刻に
// なる。
function writeInboxEnvelope(id: string, url: string, media: Array<{ url: string; file: string }> = []) {
  const record = normalizePostRecord({ captureId: id, url, image: `${id}.jpg`, media });
  const envelope = buildEnvelope(record);
  const dir = path.join(saveFolder, '.hologram-inbox', 'new');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(envelope), 'utf8');
}

// アプリ側のスナップショット（configDir/bridge-saved-index.json。lib-saved-index.ts が
// DB から作り直すのと同じ postKey → captureId の形）。mtime は明示して入れる＝索引が
// 古いかどうかの判定はこの時刻との比較だけでできているので、ファイルシステムの時計と
// 競争させずテスト側が持つ。
function writeSavedIndex(records: Array<{ captureId: string; url: string; media?: Array<string | null>; total?: number | null }>, mtimeMs: number) {
  const entries: Record<string, { id: string; media: Array<string | null>; total?: number | null }> = {};
  for (const rec of records) {
    const key = postKeyOf(rec.url);
    if (key) entries[key] = { id: rec.captureId, media: rec.media || [], ...(rec.total == null ? {} : { total: rec.total }) };
  }
  fs.mkdirSync(configDir, { recursive: true });
  const p = path.join(configDir, 'bridge-saved-index.json');
  fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 2, saveFolder, generatedAt: new Date(mtimeMs).toISOString(), entries }), 'utf8');
  fs.utimesSync(p, new Date(mtimeMs), new Date(mtimeMs));
}

const SNAP_MS = 1_700_000_000_000;

beforeAll(async () => {
  configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleQuery, noteSaved, _resetSavedIndex } = await import('../../native-host/bridge.mts'));

  writeSavedIndex([{ captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' }], SNAP_MS);
  _resetSavedIndex();
});

describe('1. スナップショットが答える（持っている投稿だけ）', async () => {
  test('ヒットしたら captureId を返す', async () => {
    expect(await askId('https://x.com/someone/status/111')).toBe('1700000000000-aa');
  });

  test('未保存の投稿は null', async () => {
    expect(await askId('https://x.com/someone/status/999')).toBeNull();
  });
});

// レンダラーと同じ規則の唯一の実装
describe('2. URL の表記ゆれを正規化する', async () => {
  test('twitter.com＋クエリ文字列でも同じ投稿', async () => {
    const u = 'https://twitter.com/other_handle/status/111?s=20';
    expect(await askId(u)).toBe('1700000000000-aa');
  });

  test('/photo/N のパーマリンクも同じ投稿', async () => {
    const u = 'https://x.com/someone/status/111/photo/1';
    expect(await askId(u)).toBe('1700000000000-aa');
  });

  test('プロフィール URL は投稿ではない', async () => {
    expect(await askId('https://x.com/someone')).toBeNull();
  });

  test('解釈できない URL は投稿ではない', async () => {
    expect(await askId('not a url')).toBeNull();
  });
});

// アプリを閉じている間に保存したもの。bridge-saved-index.json へ畳み込むにはデスクトップ
// アプリが動いている必要があるが、印はそれを待ってはいけない。
describe('3. スナップショットより新しい loose inbox エンベロープ', async () => {
  test('言語接頭辞つき URL でも見つかる', async () => {
    writeInboxEnvelope(`${SNAP_MS + 5000}-bb`, 'https://www.pixiv.net/artworks/4242');
    _resetSavedIndex();

    expect(await askId('https://www.pixiv.net/en/artworks/4242')).toBe(`${SNAP_MS + 5000}-bb`);
  });
});

// noteSaved は保存ハンドラが inbox エンベロープを書き終えた時に呼ぶもの
describe('4. ジャーナル＝このプロセスが保存した直後', async () => {
  const url = 'https://bsky.app/profile/alice.test/post/3kzz';

  test('保存直後から即答できる（メモリ上の対応表）', async () => {
    noteSaved(url, '1700000009999-cc');

    expect(await askId(url)).toBe('1700000009999-cc');
  });

  test('再起動後も bridge-journal.jsonl 経由で同じ答えに届く', async () => {
    _resetSavedIndex(); // 新しいプロセス（新しいポート）と等価

    expect(await askId(url)).toBe('1700000009999-cc');
  });

  test('ジャーナルは configDir に書かれる', async () => {
    expect(fs.existsSync(path.join(configDir, 'bridge-journal.jsonl'))).toBe(true);
  });
});

// ジャーナル行のタイムスタンプより後の mtime でスナップショットを書き直す＝その行は冗長に
// なる。それでも「保存済み」と答えるはず。今度はスナップショット自身を根拠にして。
describe('5. スナップショットが追いついたジャーナル行は捨てられる', async () => {
  test('追いついた後も保存済みと答える', async () => {
    const url = 'https://bsky.app/profile/alice.test/post/3kzz';
    writeSavedIndex(
      [
        { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' },
        { captureId: '1700000009999-cc', url },
      ],
      Date.now() + 60_000,
    );
    _resetSavedIndex();

    expect(await askId(url)).toBe('1700000009999-cc');
  });
});

// ここでは _resetSavedIndex を呼ばない＝これは無効化の経路であって、冷えた状態から組み
// 立てる話ではない（1つのポートは1つのフィードの寿命のあいだ生きたままになる）
describe('6. キャッシュはスナップショットの mtime に追従する', async () => {
  const url = 'https://x.com/someone/status/9newnote';

  test('アプリが書く前は未知', async () => {
    expect(await askId(url)).toBeNull();
  });

  test('スナップショットを書き直すとキャッシュが無効になる', async () => {
    writeSavedIndex(
      [
        { captureId: '1700000000000-aa', url: 'https://x.com/someone/status/111' },
        { captureId: '1700000011111-dd', url },
      ],
      Date.now() + 120_000,
    );

    expect(await askId(url)).toBe('1700000011111-dd');
  });
});

describe('7. バッチの上限と、混ざったゴミの扱い', async () => {
  test('300 件で打ち切る', async () => {
    const many = Array.from({ length: 400 }, (_, i) => `https://x.com/u/status/${900000 + i}`);
    expect(Object.keys((await handleQuery({ type: 'query', urls: [...many, null, 42, ''] })).results)).toHaveLength(300);
  });

  test('空のバッチは拒否せず答える', async () => {
    expect(Object.keys((await handleQuery({ type: 'query', urls: [] })).results)).toHaveLength(0);
  });

  test('壊れたメッセージも throw せず答える', async () => {
    expect(Object.keys((await handleQuery({ type: 'query' })).results)).toHaveLength(0);
  });
});

describe('8. 保存フォルダ・スナップショットが無い', async () => {
  // bridge-saved-index.json は configDir にあり、saveFolder が存在するかどうかに依存
  // しない（#299 の設計＝ .index.json のような saveFolder 内のスナップショットと違い、
  // DB から作り直せるスナップショットを configDir へ書く）。だから直前にアプリが書いた
  // レコードは、saveFolder が消えても生き残る。
  test('保存フォルダが消えていても throw せず答える', async () => {
    fs.renameSync(saveFolder, `${saveFolder}-unavailable`);
    _resetSavedIndex();

    expect(await askId('https://x.com/someone/status/111')).toBe('1700000000000-aa');
  });

  test('スナップショット自体が無ければ throw せず「保存されていない」と答える', async () => {
    fs.rmSync(path.join(configDir, 'bridge-saved-index.json'), { force: true });
    fs.rmSync(path.join(configDir, 'bridge-journal.jsonl'), { force: true });
    _resetSavedIndex();

    expect(await askId('https://x.com/someone/status/111')).toBeNull();
  });
});

// #334: 印の問いは投稿ごとではなく絵ごと＝「この絵が既にライブラリにあるか」。複数枚の
// 投稿のうち1枚だけが保存済みなのはよくあることなので、応答はその投稿のレコードが持つ
// 絵の粒度まで答えられなければならない。
describe('9. 保存済みの絵を投稿ごとに答える', async () => {
  const url = 'https://x.com/multi/status/1234';
  const A = 'https://pbs.twimg.com/media/AAA?format=jpg&name=orig';
  const B = 'https://pbs.twimg.com/media/BBB?format=jpg&name=orig';

  beforeAll(() => {
    fs.renameSync(`${saveFolder}-unavailable`, saveFolder);
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));
  });

  test('スナップショットが持つ絵をそのまま返す', async () => {
    // スナップショットを「今より前」に置く＝後に続く noteSaved のジャーナル行が
    //「もうスナップショットへ畳み込み済み」として捨てられないようにする（5 節の規則）。
    writeSavedIndex([{ captureId: '1700000020000-e1', url, media: [A], total: 3 }], Date.now() - 60_000);
    _resetSavedIndex();

    expect(await askId(url)).toBe('1700000020000-e1');
    expect(await askMedia(url)).toEqual([A]);
    expect(await askTotal(url)).toBe(3);
  });

  // 2枚目の絵を保存すると別のレコードになる（1つ目に追記されない）ので、投稿の絵は
  // レコードをまたいで散らばる。片方しか読まないと、既に保存済みの絵に保存ボタンが出る。
  test('同じ投稿の2つ目のレコードの絵が合流する', async () => {
    noteSaved(url, '1700000021000-e2', [{ url: B, file: 'x.jpg' }], 3);

    expect(await askMedia(url)).toEqual([A, B]);
    expect(await askTotal(url)).toBe(3);
  });

  test('同じ絵を2度保存しても並びは増えない', async () => {
    noteSaved(url, '1700000022000-e3', [{ url: A, file: 'y.jpg' }]);

    expect(await askMedia(url)).toEqual([A, B]);
  });

  test('再構築後も（ジャーナル経由で）同じ答えに届く', async () => {
    _resetSavedIndex();

    expect(await askMedia(url)).toEqual([A, B]);
    expect(await askTotal(url)).toBe(3);
  });

  test('アプリを閉じている間に保存した投稿は inbox エンベロープが絵を運ぶ', async () => {
    const other = 'https://x.com/multi/status/5678';
    writeInboxEnvelope(`${Date.now() + 240_000}-e4`, other, [{ url: B, file: 'z.jpg' }]);
    _resetSavedIndex();

    expect(await askMedia(other)).toEqual([B]);
  });

  // 絵が分からないこと（テキストのみの投稿、ダウンロードが全部失敗した取り込み、#334
  // より前に書かれたスナップショット）は「絵が1枚も保存されていない」とは違う。空の一覧
  // ＝「保存済み、粒度は不明」であり、呼び出し側は投稿まるごととして扱えばよい。
  test('絵を持たないレコードは空の一覧（未保存ではない）', async () => {
    const textOnly = 'https://x.com/plain/status/77';
    writeSavedIndex([{ captureId: '1700000023000-e5', url: textOnly }], Date.now() + 300_000);
    _resetSavedIndex();

    expect(await askId(textOnly)).toBe('1700000023000-e5');
    expect(await askMedia(textOnly)).toEqual([]);
  });

  test('v1 のスナップショット（captureId だけの文字列）も読める', async () => {
    const legacy = 'https://x.com/legacy/status/88';
    const key = postKeyOf(legacy) as string;
    const p = path.join(configDir, 'bridge-saved-index.json');
    const mtime = new Date(Date.now() + 360_000);
    fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 1, saveFolder, generatedAt: mtime.toISOString(), entries: { [key]: '1700000024000-e6' } }), 'utf8');
    fs.utimesSync(p, mtime, mtime);
    _resetSavedIndex();

    expect(await askId(legacy)).toBe('1700000024000-e6');
    expect(await askMedia(legacy)).toEqual([]);
  });
});

// #158: 実ファイルがゴミ箱に残っている投稿の告知。保存済みの答えとは別のマップで返る＝
// results の側は null のまま（印を光らせてはいけない）で、trashed の側に載せて運ぶ。
// ここまでの節が書いたスナップショットには trashed フィールドが無く、その状態が
//「#158 より前のアプリ」を再現している（最初のテストがそれを固定する）。
describe('10. ゴミ箱の告知', async () => {
  const TRASHED = 'https://x.com/gone/status/501';
  const LIVE_AND_TRASHED = 'https://x.com/both/status/502';
  const askTrashed = async (url: string) => (await handleQuery({ type: 'query', urls: [url] })).trashed?.[url] ?? null;

  // 明示して書く＝スナップショットに trashed マップを足す。キャッシュを確実に無効化する
  // ため、mtime は他の節と同じ方法で未来に置く。
  function writeIndexWithTrash(entries: Record<string, unknown>, trashed: Record<string, unknown>, offsetMs: number) {
    const p = path.join(configDir, 'bridge-saved-index.json');
    const mtime = new Date(Date.now() + offsetMs);
    fs.writeFileSync(p, JSON.stringify({ format: 'hologram-bridge-saved-index', version: 4, saveFolder, generatedAt: mtime.toISOString(), entries, trashed }), 'utf8');
    fs.utimesSync(p, mtime, mtime);
    _resetSavedIndex();
  }

  test('trashed マップを持たないスナップショットは「ゴミ箱に何も無い」と読む', async () => {
    expect((await handleQuery({ type: 'query', urls: ['https://x.com/legacy/status/88'] })).trashed).toEqual({});
  });

  test('ゴミ箱の投稿は results が null・trashed に削除日つきで載る', async () => {
    writeIndexWithTrash({}, { [postKeyOf(TRASHED) as string]: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' } }, 420_000);

    expect(await askId(TRASHED)).toBeNull();
    expect(await askTrashed(TRASHED)).toEqual({ id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' });
  });

  // ライブラリに生きているレコードがあれば、それが答え。アプリ側のビルダーも同じ規則で
  // trashed から落とす。ただしブリッジ側には、スナップショットが決して知りえない出所
  //（ジャーナルと loose inbox の追いつき）がある。ここでも同じ規則をかけないと取りこぼす。
  test('保存済みが勝つ＝同じ投稿が両方に載っていても trashed には出さない', async () => {
    const key = postKeyOf(LIVE_AND_TRASHED) as string;
    writeIndexWithTrash({ [key]: { id: 'cap-live', media: [] } }, { [key]: { id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' } }, 480_000);

    expect(await askId(LIVE_AND_TRASHED)).toBe('cap-live');
    expect(await askTrashed(LIVE_AND_TRASHED)).toBeNull();
  });

  // ジャーナル経由（アプリを閉じている間にブリッジ自身が保存した）＝スナップショットの
  // trashed エントリはその保存を知らない。後から保存済みの答えが加われば、告知は消える。
  test('スナップショット後にブリッジが保存した投稿の告知も消える', async () => {
    const url = 'https://x.com/resaved/status/503';
    writeIndexWithTrash({}, { [postKeyOf(url) as string]: { id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' } }, 540_000);
    expect(await askTrashed(url)).toEqual({ id: 'cap-old', deletedAt: '2026-07-01T09:00:00Z' });

    noteSaved(url, '1700000030000-f1', []);

    expect(await askId(url)).toBe('1700000030000-f1');
    expect(await askTrashed(url)).toBeNull();
  });

  // スナップショットはこのプロセスが書いたものではない＝壊れた値がそのまま応答へ抜けると、
  // 日付を描く拡張機能の側が落ちる。読むときに型の検証を通す。
  test('壊れたゴミ箱エントリは型を通してから載る', async () => {
    const bad = 'https://x.com/bad/status/504';
    const worse = 'https://x.com/worse/status/505';
    writeIndexWithTrash(
      {},
      {
        [postKeyOf(bad) as string]: { id: 42, deletedAt: { nope: true } },
        [postKeyOf(worse) as string]: 'not an object',
      },
      600_000,
    );

    expect(await askTrashed(bad)).toEqual({ id: '', deletedAt: null });
    expect(await askTrashed(worse)).toBeNull();
  });

  test('空のバッチ・壊れたメッセージでも trashed は空で返る', async () => {
    expect((await handleQuery({ type: 'query', urls: [] })).trashed).toEqual({});
    expect((await handleQuery({ type: 'query' })).trashed).toEqual({});
  });
});

describe('11. 索引とジャーナルを保存先に束縛する', async () => {
  const url = 'https://x.com/library/status/70001';
  let otherFolder: string;
  const select = (folder: string) => fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder: folder }));

  beforeAll(() => {
    otherFolder = path.join(configDir, 'other-library');
    fs.mkdirSync(otherFolder, { recursive: true });
    fs.rmSync(path.join(configDir, 'bridge-journal.jsonl'), { force: true });
  });

  test('別ライブラリの同じ投稿・ゴミ箱を現在のライブラリの結果にしない', async () => {
    const key = postKeyOf(url)!;
    const p = path.join(configDir, 'bridge-saved-index.json');
    fs.writeFileSync(p, JSON.stringify({ saveFolder: otherFolder, entries: { [key]: { id: 'other-owner', media: [] } }, trashed: { [key]: { id: 'other-trash', deletedAt: null } } }));
    select(saveFolder);
    _resetSavedIndex();
    const answer = await handleQuery({ type: 'query', urls: [url] });
    expect(answer.saveFolder).toBe(saveFolder);
    expect(answer.results[url]).toBeNull();
    expect(answer.trashed[url]).toBeUndefined();
    select(otherFolder);
    expect(await askId(url)).toBe('other-owner');
    select(saveFolder);
    expect(await askId(url)).toBeNull();
  });

  test('別ライブラリの新しい索引時刻で現在の inbox とジャーナルを読み飛ばさない', async () => {
    writeInboxEnvelope(`${SNAP_MS + 10}-a1`, url);
    noteSaved('https://x.com/library/status/70002', '1700000000020-a2', [], null, true, [], saveFolder);
    const p = path.join(configDir, 'bridge-saved-index.json');
    const future = new Date(Date.now() + 900_000);
    fs.utimesSync(p, future, future);
    _resetSavedIndex();
    expect(await askId(url)).toBe(`${SNAP_MS + 10}-a1`);
    expect(await askId('https://x.com/library/status/70002')).toBe('1700000000020-a2');
  });

  test('旧ライブラリの保存完了を現在のキャッシュへ混ぜず、元のライブラリで回復する', async () => {
    const saved = 'https://x.com/library/status/70003';
    select(otherFolder);
    expect(await askId(saved)).toBeNull();
    noteSaved(saved, '1700000000030-a3', [], null, true, [], saveFolder);
    expect(await askId(saved)).toBeNull();
    select(saveFolder);
    expect(await askId(saved)).toBe('1700000000030-a3');
  });

  test('帰属不明の旧索引・ジャーナルを現在のライブラリの保存証拠にしない', async () => {
    const unknown = 'https://x.com/library/status/70004';
    const k = postKeyOf(unknown)!;
    fs.writeFileSync(path.join(configDir, 'bridge-saved-index.json'), JSON.stringify({ entries: { [k]: 'unknown-owner' } }));
    fs.appendFileSync(path.join(configDir, 'bridge-journal.jsonl'), JSON.stringify({ k, id: 'unknown-owner', t: Date.now() + 900_000 }) + '\n');
    _resetSavedIndex();
    expect(await askId(unknown)).toBeNull();
    expect(await askId(url)).toBe(`${SNAP_MS + 10}-a1`);
  });

  test('現在の索引に取り込んだ行を圧縮しても、別ライブラリと帰属不明の行は残す', async () => {
    const p = path.join(configDir, 'bridge-journal.jsonl');
    const foreign = { saveFolder: otherFolder, k: postKeyOf('https://x.com/library/status/70005'), id: 'other-journal', t: SNAP_MS };
    const unknown = { k: postKeyOf('https://x.com/library/status/70006'), id: 'unknown-journal', t: SNAP_MS };
    const covered = { saveFolder, k: postKeyOf(url), id: 'covered', t: SNAP_MS, padding: 'x'.repeat(1024) };
    fs.writeFileSync(p, [JSON.stringify(foreign), JSON.stringify(unknown), ...Array.from({ length: 70 }, () => JSON.stringify(covered))].join('\n') + '\n');
    writeSavedIndex([{ captureId: 'snapshot-owner', url }], Date.now() + 1_000_000);
    _resetSavedIndex();
    expect(await askId(url)).toBe('snapshot-owner');
    const retained = fs
      .readFileSync(p, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(retained).toEqual([foreign, unknown]);
    select(otherFolder);
    expect(await askId('https://x.com/library/status/70005')).toBe('other-journal');
    expect(await askId('https://x.com/library/status/70006')).toBeNull();
    select(saveFolder);
  });

  test('同じフォルダの区切り文字・末尾区切り・ドット表記でも索引を採用する', async () => {
    writeSavedIndex([{ captureId: 'alias-owner', url }], Date.now() + 1_100_000);
    select(saveFolder.replaceAll('\\', '/') + '/./');
    _resetSavedIndex();
    expect(await askId(url)).toBe('alias-owner');
    const journalUrl = 'https://x.com/library/status/70007';
    noteSaved(journalUrl, '1700000000070-a7');
    select(saveFolder);
    _resetSavedIndex();
    // 正規化した帰属は、索引の未来時刻による圧縮対象になる前に確認する。
    fs.rmSync(path.join(configDir, 'bridge-saved-index.json'), { force: true });
    expect(await askId(journalUrl)).toBe('1700000000070-a7');
  });
});

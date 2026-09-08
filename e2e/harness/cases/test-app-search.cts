'use strict';

// アプリ内で単一のスマート検索をエンドツーエンドで検証する（P2④: ぴったり(exact)/
// おおまか(loose)の切り替えは無くなり、looseなマッチャーだけが振る舞いになった）:
//   B正規化: "ねこ"がカタカナの本文"ネコかわいい"にマッチ → 1
//   C編集距離: 誤字"こんにとは"が"こんにちは世界"にマッチ → 1
//   無関係な語 → 0
//
// 併せて、日付フィルタの述語のタイムゾーン境界（postPredOf / localDayRange）を
// 実際のUIを通して検証する＝「+ フィルタ」フローの日付フォーム（P2③
// filterbar。廃止されたqfの日付ポップオーバーは無い）。ピッカーの値はローカルの
// 暦日なので、UTCの瞬間がローカルの日と異なるUTC日に落ちる投稿は、ローカルの
// 日で振り分けなければならない（カードがアプリに表示するものと一致する）。
// TZ=Asia/Tokyo（UTC+9）を強制し、JST深夜をまたぐ投稿をシードして、from=to=6/20の
// 範囲がローカル時間で6/20と読める2件の投稿だけを含むことを検証する。UTCに固定
// した境界だと、この2件の境界投稿を取り違える（regressionのガード）。
// dateField=capturedAtの経路（フォーム内のBase UI Select＝合成イベントでは確実に
// 操作できない）はtest-query-unit.ctsが述語レベルでカバーしている。
//
//   node e2e/harness/cases/test-app-search.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-se-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const records: any[] = [];
const texts = ['ネコかわいい', 'こんにちは世界', 'いぬのおさんぽ'];
for (let i = 0; i < texts.length; i++) {
  const id = '170000000000' + i + '-se' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + (900 + i),
    platform: 'x',
    text: texts[i],
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}

// 日付フィルタの境界フィクスチャ。TZはAsia/Tokyo（UTC+9）なので、各`date`の瞬間の
// ローカル日が問題になる。フィルタ対象＝ローカル2026-06-20。
//   dz0: UTC 6/19 16:00 = JST 6/20 01:00  -> ローカル 6/20  -> IN
//   dz1: UTC 6/20 14:59 = JST 6/20 23:59  -> ローカル 6/20  -> IN
//   dz2: UTC 6/20 15:00 = JST 6/21 00:00  -> ローカル 6/21  -> OUT（境界の直後）
//   dz3: UTC 6/19 14:59 = JST 6/19 23:59  -> ローカル 6/19  -> OUT（境界の直前）
// UTCに固定した境界だとdz0（->OUT）とdz2（->IN）が逆になる: これがregression。
const dateFixtures = [
  { id: 'dz0', date: '2026-06-19T16:00:00Z' },
  { id: 'dz1', date: '2026-06-20T14:59:00Z' },
  { id: 'dz2', date: '2026-06-20T15:00:00Z' },
  { id: 'dz3', date: '2026-06-19T14:59:00Z' },
];
for (const dz of dateFixtures) {
  const id = '1750000000000-' + dz.id;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u/status/' + dz.id,
    platform: 'x',
    text: 'boundary ' + dz.id,
    displayName: 'D',
    screenName: 'd',
    likes: 0,
    capturedAt: dz.date,
    date: dz.date,
    media: [],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor, waitStable }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  // Reactが制御する入力欄（searchboxコンポーネント／日付フォーム）: 素の.value
  // 書き込みはReactのvalueトラッカーからは見えない＝prototypeのsetterを経由し、
  // その後'input'を発火する。
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!valueSetter) throw new Error('HTMLInputElement.prototype にReactのトラッカーを経由させる"value"のsetterが無い');
  const setInput = (el: HTMLInputElement, text: string) => {
    valueSetter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // searchboxコンポーネントのAutocomplete入力（P2④以降 #searchBox のidは無い）。
  const searchInput = document.querySelector<HTMLInputElement>('input[placeholder="テキスト・ユーザー名で検索"]');
  // オプショナルチェーンではなく名前を付ける: 入力することこそがこのハーネスの
  // すること。欄が無ければ、後の全ての検査に単に変化しなかったグリッドを報告
  // させるのではなく、実行を止めてそう言わなければならない。
  if (!searchInput) throw new Error('検索ボックスの入力欄がありません');
  const typeSearch = (text: string) => setInput(searchInput, text);
  // グリッドが「どの」投稿を表示しているかであって、単なる件数ではない。以下の
  // 2つのスマート検索ステップはどちらもちょうど1枚のカードに着地するので、
  // 件数ベースの待機だと2番目のクエリが適用される前に満たされてしまう
  // （1→1は変化ではない）＝両者の間で実際に動くのはカードの身元。
  const gridKey = () => [...document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]')].map((c) => (c.textContent || '').trim()).join('|');
  // クエリを入力し、結果セットが「別のもの」になって動きが止まるのを待つ。
  // searchboxの150msデバウンス自体には何の待機も要らない＝ポーリングは、それが
  // 発火してReactが再描画するまで単に見続けるだけ。
  const search = async (label: string, text: string) => {
    const before = gridKey();
    typeSearch(text);
    await waitFor('the grid to leave its previous results behind after searching for ' + label, () => gridKey() !== before);
    await waitStable('the results for ' + label + ' to stop moving', gridKey);
  };
  await waitFor('the grid to show all 7 seeded posts', () => cards() >= 7); // 検索用3件 + 日付境界用4件。post viewは非同期に読み込む

  // --- 単一のスマート検索（唯一の振る舞い＝モード切替なし） ---
  // B正規化: ひらがなのクエリがカタカナの本文にヒットする
  await search('ねこ', 'ねこ');
  const smartKana = cards();
  // C編集距離: 'こんにとは'（ち→との誤字置換）が'こんにちは世界'にマッチする
  await search('こんにとは', 'こんにとは');
  const smartTypo = cards();
  // 無関係な語はマッチしない
  await search('存在しない語', '存在しない語');
  const smartMiss = cards();

  // --- 日付フィルタ: ローカル日の境界（TZ=Asia/Tokyo、フィクスチャ参照） ---
  // 検索語をクリアしてグリッドを共同でフィルタしないようにし、それから実際の
  // 「+ フィルタ」フロー（filterbarコンポーネント）を操作する: ポップオーバーを開き、
  // 「日付」を選び、from/toの日付入力を埋め、「適用」をクリックする。
  typeSearch('');
  await waitFor('the grid to refill once the search term is cleared', () => cards() >= 7);
  // 今グリッドにある境界フィクスチャのid（dz*）を集め、ソートして結合する。
  // 件数だけでは弱すぎる: UTCに固定した境界だとdz0を（落として）誤って振り分け、
  // かつdz2を（加えて）誤って振り分けるので、件数は2のまま集合だけが変わる＝
  // 正しい(dz0,dz1)とバグった(dz1,dz2)を区別できるのは集合だけ。
  // カード自身のテキスト（'boundary dz0'）から読む＝セルにdata-urlは無い（#618）。
  const dzSet = () =>
    Array.from(document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]'))
      .map((c) => ((c.textContent || '').match(/boundary (dz\d)/) || [])[1])
      .filter(Boolean)
      .sort()
      .join(',');
  const byText = (sel: string, text: string) => Array.from(document.querySelectorAll<HTMLElement>(sel)).find((el) => (el.textContent || '').trim() === text) || null;
  // 上の検索ボックスと同じ理由: `?.`でクリックを消してしまい日付の検証に誤報告
  // させるのではなく、無いコントロールの名前を言って止まる。
  const clickByText = (sel: string, text: string) => {
    const el = byText(sel, text);
    if (!el) throw new Error(sel + ' に一致する要素で、テキストが ' + text + ' のものがありません');
    el.click();
  };
  // 「+ フィルタ」ボタン（AddFilterButton: アイコン + 'フィルタ'）
  clickByText('button', 'フィルタ');
  await waitFor('the filter menu to list the 日付 category', () => !!byText('[data-slot="command-item"]', '日付'));
  clickByText('[data-slot="command-item"]', '日付'); // 日付カテゴリ → DateForm
  await waitFor('the date form to show its from/to inputs', () => document.querySelectorAll('[data-slot="popover-content"] input[type="date"]').length === 2);
  const [fromEl, toEl] = document.querySelectorAll<HTMLInputElement>('[data-slot="popover-content"] input[type="date"]');
  setInput(fromEl, '2026-06-20');
  setInput(toEl, '2026-06-20');
  const beforeApply = dzSet();
  clickByText('[data-slot="popover-content"] button', '適用');
  // グリッドは非同期に再描画する。境界の集合が「変化」してから動きが止まるのを
  // 待つ＝期待する件数を待つと、このセクションが検証すること自体を先取りして
  // 前提にしてしまうし、安定性だけのポーリングは、フィルタが全く適用されて
  // いないときに最も早く返ってしまう。
  await waitFor('the boundary posts to be re-filtered by the applied date range', () => dzSet() !== beforeApply);
  await waitStable('the date-filtered grid to stop moving', dzSet);
  const dateRange = dzSet(); // dz0 + dz1 ちょうどを期待する（どちらもJSTで6/20と読める）

  return { smartKana, smartTypo, smartMiss, dateRange };
});

// TZ=Asia/Tokyo（UTC+9）にし、日付フィルタのセクションが非UTCの境界を試すようにする。
const env = Object.assign({}, process.env, { TZ: 'Asia/Tokyo', APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});
child.on('close', () => {
  let r: Record<string, any> = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* 無視 */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = r.smartKana === 1 && r.smartTypo === 1 && r.smartMiss === 0 && r.dateRange === 'dz0,dz1';
  console.log(`smartKana=${r.smartKana} smartTypo=${r.smartTypo} smartMiss=${r.smartMiss} dateRange=${r.dateRange}`);
  console.log(ok ? 'SEARCH_TEST_PASS' : 'SEARCH_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});

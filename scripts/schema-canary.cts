'use strict';

// API スキーマカナリア（#191）: 固定した公開サンプル投稿の集合を取得し、各応答を
// 値を持たないフィールドパス→型の木に還元し、それを前回の実行が保存した木と
// 突き合わせる。フィールドが消えることは、依存先が壊れかけている早期警告であり、
// フィールドが現れることは、新しく使えるようになった何かのただ乗りの発見である。
//
//   node scripts/schema-canary.cts                 # 全プラットフォーム
//   node scripts/schema-canary.cts x bluesky       # これらのみ
//   node scripts/schema-canary.cts --dry-run       # スナップショットを書き換えず報告
//   node scripts/schema-canary.cts --payloads      # 保存済みの原本と比較（#292）
//
// 終了コード: 0 = 変化なし、1 = 消失が確定した、またはサンプルが宣言と違う応答を
// 返した、2 = 警報は無いが少なくとも1つのサンプルに生きている候補が残っていない
// （カナリアが部分的に盲目になっている＝そのサンプルは samples.json に候補を
// 足す必要がある）。最初の候補が死んでいても2番目が応答したサンプルは不通ではない:
// それは報告され、監視は続く。人手を介さずにその死を吸収することこそが、そもそも
// 複数の候補を持たせている理由だから（#464）。
//
// サンプルは、プラットフォームが伏せた本文こそが自分が「期待している」ものだと
// 宣言できる（`"expect": "tombstone"`）。これが、そういう応答を永遠に死んだ
// サンプルとして読むのではなく監視できるようにする唯一の方法である＝
// lib-schema-canary.cts の judgeResponse を参照（#588）。
//
// 応答は、専用の URL ビルダー集合ではなく fetchPostMetadata() 自身から来る。
// これは設計時点では不可能だった: fetch の連鎖は各本文をパースして捨てていた。
// #292 が本文をそのままレコードに残すようにしたことで、カナリアは
// 拡張機能が実際に行う要求（同じエンドポイント、同じ順序、同じパラメータ）を
// 正確に監視できるようになった＝ずれていく手作りの模造品ではなく。
//
// リクエストは1件ずつ、サンプルの間に間を空けて発行する: これは何の義理も無い
// 公開エンドポイントを読むものであり、手動のカナリアには急ぐ理由が無い。

const fs = require('node:fs');
const path = require('node:path');
const { fetchPostMetadata } = require('../extension/utils/extractor/index.ts');
const { advanceStreak, candidateOrder, carryBaseline, diffShapes, endpointMissingDiff, judgeResponse, labelPath, rebaseOnSourceChange, shapeOf, sortShape, MISSING_STREAK_ALARM } = require('./lib-schema-canary.cts');

const CANARY_DIR = path.join(__dirname, 'canary');
const SAMPLES_FILE = path.join(CANARY_DIR, 'samples.json');
const SNAPSHOT_DIR = path.join(CANARY_DIR, 'snapshots');
const REQUEST_GAP_MS = 500;
// --payloadsがエンドポイントごとに要約へ入る前に表示する差分パスの数。
const LIST_LIMIT = 40;

// 本文が投稿そのものであるエンドポイント。無いということは、サンプル自体が
// 消えたことを意味する（削除・制限・インスタンス停止）＝スキーマ変化とは別物で、
// スキーマ変化として報告してはならない。
const PRIMARY_ENDPOINT: Record<string, string> = {
  x: 'api:x/tweet-result',
  bluesky: 'api:bluesky/getPostThread',
  misskey: 'api:misskey/notes-show',
  pixiv: 'api:pixiv/illust',
};

type Shape = Record<string, string>;
interface Candidate {
  url: string;
  note?: string;
}
interface Sample {
  label: string;
  candidates: Candidate[];
  // このサンプルが応答をどうあるべきと宣言しているか。無ければ「投稿」を意味する。
  // これは X のトゥームストーンのサンプルを除く全サンプルに当てはまる（#588 / judgeResponse）。
  expect?: string;
}
interface Snapshot {
  platform: string;
  updatedAt: string;
  shapes: Record<string, Record<string, Shape>>;
  missingStreak: Record<string, Record<string, Record<string, number>>>;
  // 各基準がどの候補 URL から観測されたか。基準は1つの投稿を記述するので、
  // その投稿に対してのみ有効（rebaseOnSourceChange を参照）。
  sources: Record<string, string>;
}

const { sleep } = require('./lib-wait.cts');

function loadSamples(): Record<string, Sample[]> {
  const raw = JSON.parse(fs.readFileSync(SAMPLES_FILE, 'utf8'));
  return raw.platforms || {};
}

function snapshotFile(platform: string): string {
  return path.join(SNAPSHOT_DIR, `${platform}.json`);
}

function readSnapshot(platform: string): Snapshot {
  try {
    const j = JSON.parse(fs.readFileSync(snapshotFile(platform), 'utf8'));
    return { platform, updatedAt: j.updatedAt || '', shapes: j.shapes || {}, missingStreak: j.missingStreak || {}, sources: j.sources || {} };
  } catch {
    return { platform, updatedAt: '', shapes: {}, missingStreak: {}, sources: {} };
  }
}

function writeSnapshot(snap: Snapshot) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  // 各階層でキーをソートし、何も変わらない実行が差分を生まないようにする。
  const shapes: Snapshot['shapes'] = {};
  for (const label of Object.keys(snap.shapes).sort()) {
    shapes[label] = {};
    for (const kind of Object.keys(snap.shapes[label] as object).sort()) (shapes[label] as Record<string, Shape>)[kind] = sortShape((snap.shapes[label] as Record<string, Shape>)[kind] as Shape);
  }
  const streak: Snapshot['missingStreak'] = {};
  for (const label of Object.keys(snap.missingStreak).sort()) {
    const byKind: Record<string, Record<string, number>> = {};
    for (const kind of Object.keys(snap.missingStreak[label] as object).sort()) {
      const entries = (snap.missingStreak[label] as Record<string, Record<string, number>>)[kind] as Record<string, number>;
      if (Object.keys(entries).length) byKind[kind] = entries;
    }
    if (Object.keys(byKind).length) streak[label] = byKind;
  }
  const sources: Snapshot['sources'] = {};
  for (const label of Object.keys(snap.sources).sort()) sources[label] = snap.sources[label] as string;
  fs.writeFileSync(snapshotFile(snap.platform), `${JSON.stringify({ platform: snap.platform, updatedAt: snap.updatedAt, sources, shapes, missingStreak: streak }, null, 2)}\n`, 'utf8');
}

// 1サンプルぶんの観測: fetch の連鎖が受け取った全ての応答本文を、既に形へ
// 還元したもの。もはやパースできない本文はスキップせずエラーとして保持する＝
// それが考えうる最も大きなスキーマの信号だから。
interface Observation {
  shapes: Record<string, Shape>;
  parseErrors: Record<string, string>;
  dead: boolean;
  reason: string;
  // 応答がサンプルの宣言と矛盾している（#588）。そうでなければ空。
  alarm: string;
}

async function observe(platform: string, url: string, expect?: string): Promise<Observation> {
  const out: Observation = { shapes: {}, parseErrors: {}, dead: false, reason: '', alarm: '' };
  let rec: any;
  try {
    rec = await fetchPostMetadata(url);
  } catch (err) {
    return { ...out, dead: true, reason: `取得が例外で落ちた: ${err.message}` };
  }
  for (const raw of rec.raw || []) {
    try {
      out.shapes[raw.sourceKind] = shapeOf(JSON.parse(raw.body));
    } catch (err) {
      out.parseErrors[raw.sourceKind] = err.message;
    }
  }
  const primary = PRIMARY_ENDPOINT[platform];
  if (primary && !(primary in out.shapes) && !(primary in out.parseErrors)) return { ...out, dead: true, reason: `${primary} の応答が無い（投稿が消えた/取得できない）` };
  // 本物の投稿本文だけが運べる何かが返ってきたか。それが無いことは通常、
  // サンプルが消えたことを意味する（X のトゥームストーン本文、pixiv の
  // { error: true }、エラー文書を返すインスタンス）＝ただしトゥームストーンを
  // 宣言しているサンプルにとってはそれが期待どおりの答えであり、それが
  // #588 の全て。この判定は judgeResponse が持つ＝ネットワーク無しでテスト
  // できるように。
  const alive = rec.likes != null || rec.text != null || rec.title != null || (rec.media && rec.media.length > 0);
  const verdict = judgeResponse(expect, { primaryParsed: !primary || primary in out.shapes, metaError: rec.metaError || '', alive });
  return { ...out, dead: verdict.dead, reason: verdict.reason, alarm: verdict.alarm };
}

interface Finding {
  platform: string;
  label: string;
  kind: string;
  lines: string[];
  alarms: number;
}

function compareSample(snap: Snapshot, label: string, obs: Observation): { lines: string[]; alarms: number } {
  const lines: string[] = [];
  let alarms = 0;
  const prevByKind: Record<string, Shape> = (snap.shapes[label] as Record<string, Shape>) || {};
  const streakByKind: Record<string, Record<string, number>> = (snap.missingStreak[label] as Record<string, Record<string, number>>) || {};
  const nextByKind: Record<string, Shape> = {};
  const nextStreak: Record<string, Record<string, number>> = {};
  const kinds = [...new Set([...Object.keys(prevByKind), ...Object.keys(obs.shapes), ...Object.keys(obs.parseErrors)])].sort();

  for (const kind of kinds) {
    const prev = (prevByKind[kind] as Shape) || null;
    const streak = (streakByKind[kind] as Record<string, number>) || {};

    if (obs.parseErrors[kind]) {
      // 本文は届いたがもう JSON ではない。比較すべきものは無い＝基準は保持し、
      // 次回の実行でも以前の形が分かるようにする。
      lines.push(`  ⚠ ${kind}: 応答が JSON として解析できない — ${obs.parseErrors[kind]}`);
      alarms++;
      if (prev) nextByKind[kind] = prev;
      nextStreak[kind] = streak;
      continue;
    }

    const next = (obs.shapes[kind] as Shape) || null;
    if (!prev) {
      // このエンドポイントを見るのは初めて＝記録するだけで何も報告しない。
      if (next) nextByKind[kind] = next;
      continue;
    }
    if (!next) {
      // この連鎖がこのエンドポイントを要求しなくなった。フィールドと同じ
      // ヒステリシスを適用する。
      const outcome = advanceStreak(streak, endpointMissingDiff());
      if (outcome.alarms.length) {
        lines.push(`  ⚠ ${kind}: エンドポイントが取得されなくなった（${MISSING_STREAK_ALARM}回連続）`);
        alarms++;
      } else {
        lines.push(`  ・${kind}: 今回は取得されなかった（様子見 ${outcome.pending[0]?.count}/${MISSING_STREAK_ALARM}）`);
        nextByKind[kind] = prev;
      }
      if (Object.keys(outcome.streak).length) nextStreak[kind] = outcome.streak;
      continue;
    }

    const diff = diffShapes(prev, next);
    const outcome = advanceStreak(streak, diff);
    for (const a of outcome.alarms) {
      lines.push(`  ⚠ ${kind}: 消失（${a.count}回連続）— ${labelPath(a.path)} :: ${a.type}`);
      alarms++;
    }
    for (const p of outcome.pending) lines.push(`  ・${kind}: 消失（様子見 ${p.count}/${MISSING_STREAK_ALARM}）— ${labelPath(p.path)} :: ${p.type}`);
    for (const g of diff.gained) lines.push(`  ＋${kind}: 新規 — ${labelPath(g.path)} :: ${g.types.join('|')}`);
    for (const u of diff.unobservable) lines.push(`  ？${kind}: 比較不能（配列が空）— ${labelPath(u)}`);
    nextByKind[kind] = carryBaseline(prev, next, diff, outcome.pending);
    if (Object.keys(outcome.streak).length) nextStreak[kind] = outcome.streak;
  }

  snap.shapes[label] = nextByKind;
  snap.missingStreak[label] = nextStreak;
  return { lines, alarms };
}

// サンプルの候補を固定順に歩き、実際の投稿で応答した最初の1つで止まる。途中で
// スキップした候補も返す＝カナリアはそれらが無くても動き続けるが、死んだ候補は
// それが最後の1つになる前に刈っておく価値がある。
interface Pick {
  url: string;
  obs: Observation | null;
  skipped: Array<{ url: string; reason: string }>;
}

async function pickCandidate(platform: string, sample: Sample, previous: string | undefined): Promise<Pick> {
  const skipped: Array<{ url: string; reason: string }> = [];
  for (const url of candidateOrder(
    sample.candidates.map((c) => c.url),
    previous,
  )) {
    const obs = await observe(platform, url, sample.expect);
    // 固定値かつ意図的なもの: これは何かを待っているのではなくスロットリング。
    // カナリアは1回の実行で複数の公開エンドポイントを歩き、リクエスト間の間隔が
    // これを行儀の良いクライアントに保つ。
    await sleep(REQUEST_GAP_MS);
    if (!obs.dead) return { url, obs, skipped };
    skipped.push({ url, reason: obs.reason });
  }
  return { url: '', obs: null, skipped };
}

async function runCanary(platforms: string[], dryRun: boolean): Promise<number> {
  const samples = loadSamples();
  const findings: Finding[] = [];
  const outages: string[] = [];
  const stale: string[] = [];
  let alarms = 0;
  let responses = 0;
  let sampleCount = 0;
  let baselines = 0;

  for (const platform of platforms) {
    const list = samples[platform] || [];
    if (!list.length) {
      console.log(`(${platform}: サンプル未登録 — samples.json）`);
      continue;
    }
    const snap = readSnapshot(platform);
    const isNew = !Object.keys(snap.shapes).length;
    console.log(`\n== ${platform} （${list.length} サンプル${isNew ? '・初回＝基準を作成' : ''}）`);
    for (const sample of list) {
      sampleCount++;
      const pick = await pickCandidate(platform, sample, snap.sources[sample.label]);
      if (!pick.obs) {
        // 全ての候補が消えた。ここに来て初めて人手で新しい候補を見つける必要が
        // あり、スキップした候補は下の「まだ監視中」のリストではなくこの行に
        // 属する＝もう何も監視していない。
        outages.push(`${platform}/${sample.label}: 候補が全滅（${pick.skipped.length}本）— ${pick.skipped.map((s) => s.url).join(' / ')}`);
        console.log(`  × ${sample.label}: 候補が全滅（${pick.skipped.length}本）— samples.json に候補を足す`);
        continue;
      }
      for (const s of pick.skipped) stale.push(`${platform}/${sample.label}: ${s.reason} — ${s.url}`);
      if (pick.obs.alarm) {
        // サンプルは自身の宣言が除外するもので応答した＝保存済みの基準はこの
        // 本文を全く記述していない。両者を比較すると、別物同士の差分をスキーマの
        // 変化として報告してしまう（これはまさに rebaseOnSourceChange が防ぐのと
        // 同じ種類の誤り）し、その後間違った本文の形で基準を上書きしてしまう。
        // そのためスナップショットには一切手を付けない: 警報そのものが報告であり、
        // 宣言どおりの応答が返ってきたときには基準がまだそこにある。
        const lines = [`  ⚠ ${pick.obs.alarm}`, `    ${pick.url}`];
        findings.push({ platform, label: sample.label, kind: '', lines, alarms: 1 });
        console.log(`  ⚠ ${sample.label}（期待した応答と違う＝基準は据え置き）`);
        for (const line of lines) console.log(line);
        alarms++;
        continue;
      }
      responses += Object.keys(pick.obs.shapes).length;
      const switched = rebaseOnSourceChange(snap, sample.label, pick.url);
      const hadBaseline = !!snap.shapes[sample.label];
      const res = compareSample(snap, sample.label, pick.obs);
      if (!hadBaseline) baselines++;
      const note = switched ? '（観測対象を切り替え＝基準を作り直した）' : hadBaseline ? '' : '（基準を作成）';
      if (res.lines.length) {
        findings.push({ platform, label: sample.label, kind: '', lines: res.lines, alarms: res.alarms });
        console.log(`  ${res.alarms ? '⚠' : '・'} ${sample.label}${note}`);
        for (const line of res.lines) console.log(line);
      } else {
        console.log(`  ○ ${sample.label}${note}`);
      }
      alarms += res.alarms;
    }
    snap.updatedAt = new Date().toISOString();
    if (!dryRun) writeSnapshot(snap);
  }

  console.log('\n—— まとめ ——');
  console.log(`サンプル ${sampleCount} / 応答 ${responses}${baselines ? ` / 新規に基準を作成 ${baselines}` : ''}`);
  console.log(`警報 ${alarms} / 不通のサンプル ${outages.length}${stale.length ? ` / 不通の候補 ${stale.length}（監視は継続）` : ''}`);
  for (const o of outages) console.log(`  × ${o}`);
  if (outages.length) console.log('  → 不通のサンプルは samples.json に候補を足す（消えた投稿はスキーマ変化ではない）');
  // 報告はするが意図的に終了コードには含めない: サンプルにはまだ生きている
  // 候補があるので、カナリアは盲目ではなく緊急のことは何も無い。
  for (const s of stale) console.log(`  ・候補が不通（他の候補で継続中）: ${s}`);
  if (dryRun) console.log('（--dry-run: スナップショットは書き換えていない）');
  if (alarms) return 1;
  return outages.length ? 2 : 0;
}

// --- 警報後の調査: 実際に保存された原本はどんな形をしているか ---
//
// #292 は拡張機能が受け取った全ての応答本文を保存するので、いったんカナリアが
// 鳴れば、サンプル投稿から推測する必要は無い＝ライブラリが同じエンドポイントの
// 実際の本文を持っている。これは、保存済みペイロードで見つかった形の和集合を、
// 同じエンドポイントのスナップショット基準の和集合と比較する。意図的に粗い
// （基準は投稿の種類ごと、保存済みペイロードは実際に保存されたもの次第）＝
// これはフィールドを指し示すだけで、判定はしない。
function inspectPayloads(filter: string | null, limit: number) {
  const { configDir, defaultLibraryDir } = require('../native-host/paths.mts');
  const { openDatabase } = require('../app/src/main/lib-db.ts');
  const { unpackRawPayload } = require('../native-host/raw-payload.mts');
  // #176: hologram.db は今は configDir ではなく保存フォルダの中にある。
  let folder = defaultLibraryDir();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (typeof cfg.saveFolder === 'string' && cfg.saveFolder) folder = cfg.saveFolder;
  } catch {
    /* まだ config が無い＝代わりに既定のライブラリディレクトリを使う */
  }
  const dbFile = path.join(folder, 'hologram.db');
  if (!fs.existsSync(dbFile)) {
    console.log('データベースが無い:', dbFile);
    return 2;
  }
  // 読み取り専用: アプリは書き込み手を1つだけ保つ。これは読むだけ。
  const { sqlite } = openDatabase(dbFile, { readonly: true });
  // このテーブルは #292 のマイグレーションで入るが、それはアプリがデータベースを
  // 書き込みで開いたときにしか走らない。読み取り専用の接続はそれを作れないので、
  // #292 入りのビルドでまだ再起動していないアプリには単に原本がまだ無いだけ＝
  // SQLITE_ERROR を投げるのではなくそう伝える。
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='raw_payloads'").get()) {
    console.log('raw_payloads テーブルが無い＝#292 の入ったビルドでアプリをまだ開いていない（移行は書き込み接続で走る）。');
    sqlite.close();
    return 2;
  }
  const rows = sqlite.prepare(`SELECT sourceKind, encoding, sha256, payload FROM raw_payloads ${filter ? 'WHERE sourceKind LIKE ?' : ''} ORDER BY id DESC`).all(...(filter ? [`%${filter}%`] : [])) as Array<{ sourceKind: string; encoding: string; sha256: string; payload: Buffer | null }>;
  if (!rows.length) {
    console.log('該当する保存原本が無い', filter ? `（filter: ${filter}）` : '');
    sqlite.close();
    return 0;
  }
  const perKind: Record<string, { seen: number; read: number; shape: Shape }> = {};
  for (const row of rows) {
    const acc = (perKind[row.sourceKind] ||= { seen: 0, read: 0, shape: {} });
    acc.seen++;
    if (acc.read >= limit) continue;
    const body = unpackRawPayload(row);
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      console.log(`  ⚠ ${row.sourceKind}: 保存原本が JSON として解析できない（sha256=${row.sha256.slice(0, 12)}）`);
      continue;
    }
    acc.read++;
    for (const [p, t] of Object.entries(shapeOf(parsed) as Shape)) acc.shape[p] = acc.shape[p] && acc.shape[p] !== t ? `${acc.shape[p]}|${t}` : t;
  }
  sqlite.close();

  // エンドポイントごとの、コミット済み基準すべての和集合。
  const baseline: Record<string, Set<string>> = {};
  for (const file of fs.existsSync(SNAPSHOT_DIR) ? fs.readdirSync(SNAPSHOT_DIR) : []) {
    if (!file.endsWith('.json')) continue;
    const snap = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), 'utf8'));
    for (const byKind of Object.values(snap.shapes || {}) as Record<string, Shape>[]) {
      for (const [kind, shape] of Object.entries(byKind)) for (const p of Object.keys(shape)) (baseline[kind] ||= new Set()).add(p);
    }
  }

  for (const kind of Object.keys(perKind).sort()) {
    const acc = perKind[kind] as { seen: number; read: number; shape: Shape };
    console.log(`\n== ${kind}  保存 ${acc.seen} 件 / 読めた ${acc.read} 件`);
    const base = baseline[kind];
    if (!base) {
      console.log('  （このエンドポイントの基準スナップショットが無い）');
      continue;
    }
    const onlySaved = Object.keys(acc.shape).filter((p) => !base.has(p));
    const onlyBaseline = [...base].filter((p) => !(p in acc.shape)).sort();
    const more = (all: string[]) => (all.length > LIST_LIMIT ? `    …他 ${all.length - LIST_LIMIT} 件` : '');
    console.log(`  保存原本にだけ在るパス: ${onlySaved.length}`);
    for (const p of onlySaved.slice(0, LIST_LIMIT)) console.log(`    + ${labelPath(p)} :: ${acc.shape[p]}`);
    if (more(onlySaved)) console.log(more(onlySaved));
    console.log(`  基準にだけ在るパス: ${onlyBaseline.length}`);
    for (const p of onlyBaseline.slice(0, LIST_LIMIT)) console.log(`    - ${labelPath(p)}`);
    if (more(onlyBaseline)) console.log(more(onlyBaseline));
  }
  console.log('\n※ 基準はサンプル投稿の種別ごと、保存原本は実際に保存した投稿＝差分は「壊れている」の意味ではない。鳴った項目の実物を見るための入口。');
  return 0;
}

(async () => {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const limitAt = argv.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(argv[limitAt + 1]) || 20 : 20;
  if (argv.includes('--payloads')) {
    const at = argv.indexOf('--payloads');
    const next = argv[at + 1];
    process.exitCode = inspectPayloads(next && !next.startsWith('--') ? next : null, limit);
    return;
  }
  const known = Object.keys(loadSamples());
  const asked = argv.filter((a) => !a.startsWith('--') && known.includes(a));
  const platforms = asked.length ? asked : known;
  console.log(`API スキーマカナリア（#191）  対象: ${platforms.join(', ')}`);
  process.exitCode = await runCanary(platforms, dryRun);
})();

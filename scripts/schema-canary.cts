'use strict';

// API スキーマカナリア（#191）: 固定した公開サンプル投稿の集合を取得し、各応答を
// 値を持たないフィールドパス→型の木に還元し、それを前回の実行が保存した木と
// 突き合わせる。フィールドが消えることは、依存先が壊れかけている早期警告であり、
// フィールドが現れることは、新しく使えるようになった何かのただ乗りの発見である。
//
//   node scripts/schema-canary.cts                 # 全プラットフォーム
//   node scripts/schema-canary.cts x bluesky       # これらのみ
//   node scripts/schema-canary.cts --dry-run       # スナップショットを書き換えず報告
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
// 応答は、専用の URL ビルダー集合ではなく fetchPostMetadata() 自身が行う fetch を
// その場で観測する。拡張機能が実際に行う要求（同じエンドポイント、同じ順序、
// 同じパラメータ）を監視しつつ、応答本文を保存レコードへ混ぜない。
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

// 本文が投稿そのものであるエンドポイント。無いということは、サンプル自体が
// 消えたことを意味する（削除・制限・インスタンス停止）＝スキーマ変化とは別物で、
// スキーマ変化として報告してはならない。
const PRIMARY_ENDPOINT: Record<string, string> = {
  x: 'api:x/tweet-result',
  bluesky: 'api:bluesky/getPostThread',
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

function sourceKindOf(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.hostname === 'cdn.syndication.twimg.com' && url.pathname.includes('/tweet-result')) return 'api:x/tweet-result';
  if (url.pathname.endsWith('/xrpc/com.atproto.identity.resolveHandle')) return 'api:bluesky/resolveHandle';
  if (url.pathname.endsWith('/xrpc/app.bsky.feed.getPostThread')) return 'api:bluesky/getPostThread';
  if (url.pathname.endsWith('/xrpc/app.bsky.actor.getProfile')) return 'api:bluesky/getProfile';
  if (url.hostname === 'plc.directory' || url.pathname.endsWith('/.well-known/did.json')) return 'api:bluesky/didDocument';
  if (/^\/ajax\/illust\/[^/]+\/pages$/.test(url.pathname)) return 'api:pixiv/illust-pages';
  if (/^\/ajax\/illust\/[^/]+$/.test(url.pathname)) return 'api:pixiv/illust';
  if (/^\/ajax\/user\/[^/]+$/.test(url.pathname)) return 'api:pixiv/user';
  return null;
}

async function observe(platform: string, url: string, expect?: string): Promise<Observation> {
  const out: Observation = { shapes: {}, parseErrors: {}, dead: false, reason: '', alarm: '' };
  let rec: any;
  const responses: Array<{ sourceKind: string; body: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    const input = args[0];
    const requestUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const sourceKind = sourceKindOf(requestUrl);
    if (sourceKind) responses.push({ sourceKind, body: await response.clone().text() });
    return response;
  };
  try {
    rec = await fetchPostMetadata(url);
  } catch (err) {
    return { ...out, dead: true, reason: `取得が例外で落ちた: ${err.message}` };
  } finally {
    globalThis.fetch = originalFetch;
  }
  for (const raw of responses) {
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

(async () => {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const known = Object.keys(loadSamples());
  const asked = argv.filter((a) => !a.startsWith('--') && known.includes(a));
  const platforms = asked.length ? asked : known;
  console.log(`API スキーマカナリア（#191）  対象: ${platforms.join(', ')}`);
  process.exitCode = await runCanary(platforms, dryRun);
})();

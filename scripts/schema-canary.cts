'use strict';

// API schema canary (#191): fetch a fixed set of public sample posts, reduce
// each response to a value-free field-path → type tree, and diff that against
// the tree the previous run stored. A field that disappears is the early
// warning that a dependency is about to break; a field that appears is a free
// discovery of something newly available.
//
//   node scripts/schema-canary.cts                 # every platform
//   node scripts/schema-canary.cts x bluesky       # only these
//   node scripts/schema-canary.cts --dry-run       # report without rewriting snapshots
//   node scripts/schema-canary.cts --payloads      # compare against SAVED originals (#292)
//
// Exit code: 0 = no change, 1 = a confirmed disappearance or a sample answering
// something other than what it declared, 2 = no alarm but at least one sample
// has no living candidate left (the canary is partly blind — that sample needs
// another candidate in samples.json). A sample whose FIRST candidate died but
// whose second answered is not an outage: it is reported and keeps watching,
// because absorbing that death without a human is the point of carrying
// candidates at all (#464).
//
// A sample may declare that a body withheld by the platform is what it EXPECTS
// to see (`"expect": "tombstone"`), which is the only way such a response can be
// watched instead of being read as a dead sample forever — see judgeResponse in
// lib-schema-canary.cts (#588).
//
// The responses come from fetchPostMetadata() itself rather than a private set
// of URL builders. That was not possible when this was designed: the fetch
// chain parsed each body and threw it away. #292 (ADR 0011) made it keep every
// body verbatim on the record, so the canary can now watch EXACTLY the requests
// the extension makes — same endpoints, same order, same parameters — instead
// of a hand-maintained imitation that would drift.
//
// Requests are issued one at a time with a pause between samples: this reads
// public endpoints that owe us nothing, and a manual canary has no reason to
// hurry.

const fs = require('node:fs');
const path = require('node:path');
const { fetchPostMetadata } = require('../extension/utils/extractor/index.ts');
const { advanceStreak, candidateOrder, carryBaseline, diffShapes, endpointMissingDiff, judgeResponse, labelPath, rebaseOnSourceChange, shapeOf, sortShape, MISSING_STREAK_ALARM } = require('./lib-schema-canary.cts');

const CANARY_DIR = path.join(__dirname, 'canary');
const SAMPLES_FILE = path.join(CANARY_DIR, 'samples.json');
const SNAPSHOT_DIR = path.join(CANARY_DIR, 'snapshots');
const REQUEST_GAP_MS = 500;
// How many differing paths --payloads prints per endpoint before summarizing.
const LIST_LIMIT = 40;

// The endpoint whose body IS the post. Missing means the sample itself is gone
// (deleted, restricted, instance down) — a different thing from a schema
// change, and it must not be reported as one.
const PRIMARY_ENDPOINT: Record<string, string> = {
  x: 'api:x/tweet-result',
  bluesky: 'api:bluesky/getPostThread',
  misskey: 'api:misskey/notes-show',
  mastodon: 'api:mastodon/status',
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
  // What this sample declares the response should be. Absent means "a post",
  // which is every sample but the X tombstone one (#588 / judgeResponse).
  expect?: string;
}
interface Snapshot {
  platform: string;
  updatedAt: string;
  shapes: Record<string, Record<string, Shape>>;
  missingStreak: Record<string, Record<string, Record<string, number>>>;
  // Which candidate URL each baseline was observed from. A baseline describes
  // one post, so it is only valid for that post (see rebaseOnSourceChange).
  sources: Record<string, string>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
  // Keys sorted at every level so a run that changes nothing produces no diff.
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

// One sample's observation: every response body the fetch chain received,
// already reduced to a shape. A body that no longer parses is kept as an error
// rather than skipped — it is the loudest possible schema signal.
interface Observation {
  shapes: Record<string, Shape>;
  parseErrors: Record<string, string>;
  dead: boolean;
  reason: string;
  // The response contradicts what the sample declared (#588). Empty otherwise.
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
  // Whether anything only a real post body can carry came back. Its absence
  // normally means the sample is gone (X tombstone bodies, pixiv's
  // { error: true }, an instance serving an error document) — but for a sample
  // that declares a tombstone it is the expected answer, which is the whole of
  // #588. judgeResponse owns that reading so it can be tested without network.
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
      // The body arrived but is no longer JSON. Nothing to compare; keep the
      // baseline so the next run still knows what the shape used to be.
      lines.push(`  ⚠ ${kind}: 応答が JSON として解析できない — ${obs.parseErrors[kind]}`);
      alarms++;
      if (prev) nextByKind[kind] = prev;
      nextStreak[kind] = streak;
      continue;
    }

    const next = (obs.shapes[kind] as Shape) || null;
    if (!prev) {
      // First time this endpoint is seen — record it, report nothing.
      if (next) nextByKind[kind] = next;
      continue;
    }
    if (!next) {
      // The chain stopped requesting this endpoint. Same hysteresis as a field.
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

// Walks a sample's candidates in sticky order and stops at the first one that
// answers with a real post. Candidates skipped on the way are returned too: the
// canary keeps working without them, but a dead candidate is worth pruning
// before it is the last one left.
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
        // Every candidate is gone. Only now does a human have to find a new one,
        // and the skipped ones belong to this line rather than to the "still
        // watching" list below — nothing is still watching.
        outages.push(`${platform}/${sample.label}: 候補が全滅（${pick.skipped.length}本）— ${pick.skipped.map((s) => s.url).join(' / ')}`);
        console.log(`  × ${sample.label}: 候補が全滅（${pick.skipped.length}本）— samples.json に候補を足す`);
        continue;
      }
      for (const s of pick.skipped) stale.push(`${platform}/${sample.label}: ${s.reason} — ${s.url}`);
      if (pick.obs.alarm) {
        // The sample answered with something its declaration rules out, so the
        // stored baseline does not describe this body at all. Comparing them
        // would report two different things' differences as schema movement —
        // the same category error rebaseOnSourceChange exists to prevent — and
        // would then overwrite the baseline with the wrong body's shape. So the
        // snapshot is left completely untouched: the alarm is the report, and
        // the baseline is still there when the declared answer comes back.
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
  // Reported but deliberately not part of the exit code: the sample still has a
  // living candidate, so the canary is not blind and nothing is urgent.
  for (const s of stale) console.log(`  ・候補が不通（他の候補で継続中）: ${s}`);
  if (dryRun) console.log('（--dry-run: スナップショットは書き換えていない）');
  if (alarms) return 1;
  return outages.length ? 2 : 0;
}

// --- post-alarm investigation: what do the ACTUAL saved originals look like ---
//
// #292 stores every response body the extension received, so once the canary
// fires there is no need to guess from a sample post: the library holds real
// bodies for the same endpoints. This compares the union of the shapes found in
// stored payloads against the union of the snapshot baselines for the same
// endpoint. Rough on purpose (baselines are per post type, the stored payloads
// are whatever was saved) — it points at the field, it does not judge.
function inspectPayloads(filter: string | null, limit: number) {
  const { configDir, defaultLibraryDir } = require('../native-host/paths.cts');
  const { openDatabase } = require('../app/src/main/lib-db.ts');
  const { unpackRawPayload } = require('../native-host/raw-payload.mts');
  // #176: hologram.db lives inside the save folder now, not configDir (ADR 0025).
  let folder = defaultLibraryDir();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (typeof cfg.saveFolder === 'string' && cfg.saveFolder) folder = cfg.saveFolder;
  } catch {
    /* no config yet — fall back to the default library dir */
  }
  const dbFile = path.join(folder, 'hologram.db');
  if (!fs.existsSync(dbFile)) {
    console.log('データベースが無い:', dbFile);
    return 2;
  }
  // Read-only: the app keeps a single writer, and this only ever reads.
  const { sqlite } = openDatabase(dbFile, { readonly: true });
  // The table arrives with #292's migration, which only runs when the app opens
  // the database for writing. A read-only connection cannot create it, so an
  // app that has not been restarted on a build with #292 simply has no
  // originals yet — say that instead of throwing SQLITE_ERROR.
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

  // Union of every committed baseline, per endpoint.
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

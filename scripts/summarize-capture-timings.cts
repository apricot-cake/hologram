'use strict';

// capture.log は配布済みの保存処理とは別に、各保存の開始・native host
// 到着・完了を記録している。この開発用コマンドはその既存ログだけを読み、
// どの区間で待ったかを集計する。保存経路には参加しない。
//
//   npm run diag:capture -- [投稿 URL の一部]

const fs = require('node:fs');
const path = require('node:path');

const { configDir } = require('../native-host/paths.mts');

type SaveTiming = {
  saveId: string;
  url: string | null;
  started?: string;
  bridgeStarted?: string;
  finished?: string;
  outcome?: string;
  metaReason?: string | null;
};

function readEntries(file: string) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .flatMap((line: string) => {
      try {
        return line ? [JSON.parse(line)] : [];
      } catch {
        return [];
      }
    });
}

function elapsedMs(from: string | undefined, to: string | undefined) {
  if (!from || !to) return null;
  const elapsed = Date.parse(to) - Date.parse(from);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

function formatMs(ms: number | null) {
  if (ms == null) return '—';
  return ms < 1_000 ? `${ms}ms` : `${(ms / 1_000).toFixed(2)}s`;
}

function summarize(entries: any[], query: string | undefined) {
  const saves = new Map<string, SaveTiming>();
  for (const entry of entries) {
    if (!entry?.saveId) continue;
    if (query && !String(entry.url || '').includes(query)) continue;
    const current: SaveTiming = saves.get(entry.saveId) || { saveId: entry.saveId, url: entry.url || null };
    current.url ||= entry.url || null;
    if (entry.stage === 'save' && entry.phase === 'begin') current.started = entry.ts;
    if (entry.stage === 'bridge' && entry.phase === 'begin') current.bridgeStarted = entry.ts;
    if (entry.stage === 'bridge' && (entry.phase === 'ok' || entry.phase === 'fail')) {
      current.finished = entry.ts;
      current.outcome = entry.phase;
      current.metaReason = entry.metaReason || null;
    }
    saves.set(entry.saveId, current);
  }
  return [...saves.values()]
    .filter((save) => save.started || save.bridgeStarted || save.finished)
    .map((save) => ({
      ...save,
      metadataAndHandoff: elapsedMs(save.started, save.bridgeStarted),
      nativeSave: elapsedMs(save.bridgeStarted, save.finished),
      total: elapsedMs(save.started, save.finished),
    }))
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
}

function main() {
  const query = process.argv.slice(2).join(' ') || undefined;
  const file = path.join(configDir(), 'capture.log');
  const rows = summarize(readEntries(file), query);
  if (!rows.length) {
    console.log(JSON.stringify({ file, query: query || null, saves: [] }, null, 2));
    return;
  }
  console.table(
    rows.map((save) => ({
      total: formatMs(save.total),
      'metadata + handoff': formatMs(save.metadataAndHandoff),
      'native save': formatMs(save.nativeSave),
      result: save.outcome || 'in progress',
      fallback: save.metaReason || 'none',
      url: save.url,
    })),
  );
  console.log(`ログ: ${file}`);
}

module.exports = { elapsedMs, summarize };

if (require.main === module) main();

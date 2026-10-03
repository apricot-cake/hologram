import { appActivity } from './app-activity.ts';
('use strict');

// 同じ PC 内での復旧と、手動エクスポートの通知を扱う。
// 外部の保存先へデータを送る処理は持たない。ローカル復元ポイントは誤操作や
// 破損から戻すためのもので、外部バックアップの代わりにはしない。

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type Database from 'better-sqlite3';

import { configDir } from './native-host.ts';
import { getSaveFolder, readLibraryExportReminderConfig, writeLibraryExportReminderConfig, readLibraryIntegrityStatus, writeLibraryIntegrityStatus } from './lib-config.ts';
import { createGeneration, latestGeneration, listGenerations, pruneGenerations } from './lib-db-generations.ts';
import { checkOrphans, recoverOrphanRecords } from './lib-db-integrity.ts';
import type { DbHandle } from './ipc-context.ts';

export interface LibrarySafetyDeps {
  ensurePostsSynced(): DbHandle | null;
  scheduleSavedIndexWrite(handle: { sqlite: Database.Database }): void;
  send(channel: string, ...args: unknown[]): void;
}

const GENERATION_HEARTBEAT_MS = 60 * 1000;
const GENERATION_CHANGE_THRESHOLD = 50;
const GENERATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const readIntegrityStatus = readLibraryIntegrityStatus;
const writeIntegrityStatus = writeLibraryIntegrityStatus;

function exportReminderState() {
  const cfg = readLibraryExportReminderConfig();
  return { ...cfg, due: cfg.enabled && cfg.changesSinceExport >= cfg.threshold };
}

function pathIsInside(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

function validateSaveFolder(dir) {
  if (!dir || typeof dir !== 'string' || !dir.trim()) return { ok: false, error: 'invalid' };
  const cur = getSaveFolder();
  if (path.resolve(dir) === path.resolve(cur)) return { ok: false, error: 'same' };
  if (pathIsInside(dir, cur) || pathIsInside(cur, dir)) return { ok: false, error: 'nested' };
  if (pathIsInside(dir, configDir()) || pathIsInside(configDir(), dir)) return { ok: false, error: 'config-overlap' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.hologram-write-probe-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch {
    return { ok: false, error: 'not-writable' };
  }
  return { ok: true };
}

function createLibrarySafety({ ensurePostsSynced, scheduleSavedIndexWrite, send }: LibrarySafetyDeps) {
  const publishExportReminder = () => {
    const state = exportReminderState();
    send('export-reminder-changed', state);
    return state;
  };
  const getExportReminder = () => exportReminderState();
  const setExportReminderEnabled = (enabled: unknown) => {
    writeLibraryExportReminderConfig({ enabled: enabled !== false });
    return publishExportReminder();
  };
  const setExportReminderThreshold = (threshold: unknown) => {
    writeLibraryExportReminderConfig({ threshold });
    return publishExportReminder();
  };
  const markExported = (changesIncluded?: number) => {
    const current = readLibraryExportReminderConfig();
    const included = changesIncluded === undefined ? current.changesSinceExport : Math.max(0, Math.floor(Number(changesIncluded) || 0));
    writeLibraryExportReminderConfig({ changesSinceExport: Math.max(0, current.changesSinceExport - included), lastExportAt: new Date().toISOString() });
    return publishExportReminder();
  };

  function runIntegrityPass(folder: string, sqlite: any) {
    let dbOk = true;
    try {
      const check = sqlite.pragma('integrity_check', { simple: true });
      dbOk = check === 'ok';
      if (!dbOk) log.error(`integrity_check failed: ${check}`);
    } catch (err) {
      dbOk = false;
      log.error('integrity_check threw:', err);
    }
    const { orphanMedia, missingMedia } = checkOrphans(folder, sqlite);
    const status = writeIntegrityStatus({ lastCheckAt: new Date().toISOString(), dbOk, orphanCount: orphanMedia.length, missingCount: missingMedia.length });
    send('integrity-check-done', status);
    return status;
  }

  async function runStartupIntegrityCheck() {
    const folder = getSaveFolder();
    if (!folder || !fs.existsSync(folder)) return;
    try {
      const handle = await ensurePostsSynced();
      if (handle) runIntegrityPass(folder, handle.sqlite);
    } catch (err) {
      log.error('startup integrity check failed:', err);
    }
  }

  async function runOrphanRecovery() {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, error: 'not-configured' };
    if (!fs.existsSync(folder)) return { ok: false, error: 'library-missing' };
    const handle = await ensurePostsSynced();
    if (!handle) return { ok: false, error: 'not-configured' };
    const written = recoverOrphanRecords(folder, handle.sqlite);
    if (written.length) scheduleSavedIndexWrite(handle);
    runIntegrityPass(folder, handle.sqlite);
    const adopted = written.filter((w) => w.via === 'sidecar').length;
    if (written.length) log.info(`orphan recovery: ${written.length} recovered (${adopted} from a sidecar, ${written.length - adopted} synthesized)`);
    return { ok: true, recovered: written.length, adopted };
  }

  let generationRunning = false;
  let mutationsSinceGeneration = 0;
  function generationDue(folder: string): boolean {
    const list = listGenerations(folder);
    if (!list.length || mutationsSinceGeneration >= GENERATION_CHANGE_THRESHOLD) return true;
    return Date.now() - Date.parse(list[0].at) >= GENERATION_INTERVAL_MS;
  }

  async function runDbGeneration(reason: string, force = false) {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, error: 'not-configured' };
    if (!fs.existsSync(folder)) return { ok: false, error: 'src-missing' };
    if (generationRunning) return { ok: false, error: 'busy' };
    if (!force && !generationDue(folder)) return { ok: false, error: 'not-due' };
    generationRunning = true;
    const end = appActivity.begin();
    const startedAt = Date.now();
    try {
      const handle = await ensurePostsSynced();
      if (!handle) return { ok: false, error: 'not-configured' };
      const file = await createGeneration(handle.sqlite, folder);
      mutationsSinceGeneration = 0;
      const removed = await pruneGenerations(folder);
      log.info(`db generation written (${reason}) in ${Date.now() - startedAt}ms: ${path.basename(file)}${removed.length ? ` — thinned ${removed.length}` : ''}`);
      return { ok: true, file, thinned: removed.length };
    } catch (err: any) {
      log.error('db generation failed:', err);
      return { ok: false, error: err?.message || 'failed' };
    } finally {
      generationRunning = false;
      end();
    }
  }

  let scheduleArmed = false;
  let generationHeartbeatTimer: any = null;
  function noteLibraryMutation(count = 1) {
    const delta = Math.max(1, Math.floor(Number(count) || 1));
    mutationsSinceGeneration += delta;
    if (scheduleArmed && mutationsSinceGeneration >= GENERATION_CHANGE_THRESHOLD) void runDbGeneration('changes');
  }
  function notePostsSaved(count = 1) {
    const delta = Math.floor(Number(count));
    if (!Number.isFinite(delta) || delta <= 0) return exportReminderState();
    const current = readLibraryExportReminderConfig();
    writeLibraryExportReminderConfig({ changesSinceExport: current.changesSinceExport + delta });
    return publishExportReminder();
  }
  function armRecoverySchedule() {
    scheduleArmed = true;
    if (generationHeartbeatTimer) clearInterval(generationHeartbeatTimer);
    generationHeartbeatTimer = setInterval(() => void runDbGeneration('daily'), GENERATION_HEARTBEAT_MS);
  }

  return {
    getExportReminder,
    setExportReminderEnabled,
    setExportReminderThreshold,
    markExported,
    runDbGeneration,
    armRecoverySchedule,
    runStartupIntegrityCheck,
    runOrphanRecovery,
    noteLibraryMutation,
    notePostsSaved,
    isBusy: () => generationRunning,
  };
}

function latestRestorableSnapshot(): string | null {
  const folder = getSaveFolder();
  return folder ? latestGeneration(folder) : null;
}

export { latestRestorableSnapshot, readIntegrityStatus, validateSaveFolder, createLibrarySafety };

// Backup service — auto-backup config + run status (get/set config, pick target
// dir, kick a run, start/done events), wrapping the flat corpusIpc.getBackup/
// setBackup/pickBackupDir/runBackup/onBackupStart/onBackupDone calls (P4
// "IPC→service" domain-grouping slice — BACKLOG「手書き .jsゼロ ＋ React 実プ
// ロダクト化」). Plain IIFE on window like the sibling renderer/*.ts services;
// loaded before viewer.js. Two consumers share this domain — viewer.ts (the
// always-visible #mirrorStatus rail) and the Settings > データ island — pure
// 1:1 forwarding, no wrapping logic (same as trash).
(function () {
  'use strict';

  function getBackup() {
    return window.corpusIpc.getBackup();
  }
  function setBackup(patch: unknown) {
    return window.corpusIpc.setBackup(patch);
  }
  function pickBackupDir() {
    return window.corpusIpc.pickBackupDir();
  }
  function runBackup() {
    return window.corpusIpc.runBackup();
  }
  function onBackupStart(cb: (...args: any[]) => void) {
    return window.corpusIpc.onBackupStart(cb);
  }
  function onBackupDone(cb: (...args: any[]) => void) {
    return window.corpusIpc.onBackupDone(cb);
  }

  const api = { getBackup, setBackup, pickBackupDir, runBackup, onBackupStart, onBackupDone };
  if (typeof window !== 'undefined') window.corpusBackup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();

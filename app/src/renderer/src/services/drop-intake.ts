'use strict';

// ウィンドウへのドロップで取り込む（#234）＝OS からローカルのファイルやフォルダをアプリの
// ウィンドウへドラッグする。ローカルのファイルの入り口は他に2つあり、Data.tsx（ファイルの
// 選択ダイアログ）と clipboard-intake.ts（Ctrl+V）に既にある。これが3つ目で、しかも異質だ。
// フォルダのドロップは、利用者が思っていたよりずっと多くを引き込みうるから。複数件なら
// ダイアログで件数を先に確認する。その件数の元になる再帰的な走査は、問いを出す前に
// 走り切る＝走査の途中では尋ねないので、「いいえ」と答えればライブラリには何も触れて
// いない（#234 の設計のコメント）。1件だけなら、ドロップ自体が対象の明示なので直ちに
// 取り込む。
//
// 登録（ウィンドウ全体のオーバーレイと、ネイティブのドラッグ／ドロップのリスナー）は
// DropOverlay コンポーネント（app/App.tsx）にある。このモジュールが持つのは、IPC を2回
// 往復するロジックと、確認と報告の結線＝GlobalShortcuts や clipboard-intake.ts が自分の
// 機能で取っているのと同じ分担。
import { collectDroppedPaths, getPathForFile, importDroppedPaths } from './posts.ts';
import { open as confirmOpen } from './confirm.ts';
import { loadPosts } from './post-grid-builder.ts';
import { notify } from './ui.ts';
import { t } from '../_shared/i18n.ts';
import { toast } from 'sonner';
import type { DropCollectResult, DroppedFile } from '../../../main/ipc-payloads.ts';

/** ドロップされた項目ごとの webUtils.getPathForFile＝ドロップされた File が持つ OS 上の
 * パス（File.path は Electron 32 で削除された。これが preload 側の置き換え）。 */
export function pathsFromFileList(list: FileList): string[] {
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) {
    try {
      const p = getPathForFile(list[i]);
      if (p) out.push(p);
    } catch {
      /* OS 上のパスを解決できない File（稀）＝飛ばす */
    }
  }
  return out;
}

const reload = async () => {
  if (loadPosts) await loadPosts();
};

function reportImportError(error: string | undefined): void {
  notify(error === 'library-missing' ? t('saveFolderErrLibraryMissing') : t('importFailed'));
}

async function runImport(files: DroppedFile[], stackFolders: boolean): Promise<void> {
  const id = 'hologram-drop-import';
  toast.loading(t('importing'), { id, description: t('dropImportProgress', { count: files.length }) });
  try {
    const out = await importDroppedPaths(files, stackFolders);
    if (out.error) {
      reportImportError(out.error);
      return;
    }
    await reload();
    if (out.skipped > 0) notify(t('importSkipped', { count: out.imported, skipped: out.skipped }));
    else notify(t('imported', { count: out.imported }));
  } catch {
    notify(t('importFailed'));
  } finally {
    toast.dismiss(id);
  }
}

/**
 * ドロップの流れの全体＝収集 → （複数件なら件数の確認）→ 取り込み → 報告。
 */
export async function handleDroppedPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const id = 'hologram-drop-collect';
  toast.loading(t('dropCollecting'), { id });
  let res: DropCollectResult;
  try {
    res = await collectDroppedPaths(paths);
  } catch {
    notify(t('importFailed'));
    return;
  } finally {
    toast.dismiss(id);
  }
  if (res.error) {
    reportImportError(res.error);
    return;
  }
  if (!res.files.length) {
    notify(t('dropNothingToImport'));
    return;
  }
  if (res.files.length === 1) {
    await runImport(res.files, false);
    return;
  }
  confirmOpen({
    message: t('dropImportConfirm', { count: res.files.length }),
    okLabel: t('dropImportOk'),
    cancelLabel: t('confirmCancel'),
    optionLabel: res.hasFolder ? t('dropImportStackFolders') : undefined,
    optionDefault: false,
    optionDescription: res.hasFolder ? t('dropImportGroupedDescription', { count: res.files.length, groups: res.groups.length }) : undefined,
    optionDetails: res.hasFolder ? res.groups.map((group) => t('dropImportGroupItem', { name: group.name, count: group.mediaCount })) : undefined,
    okDestructive: false,
    onOk: ({ option }) => void runImport(res.files, option === true),
  });
}

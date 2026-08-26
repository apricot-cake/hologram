'use strict';

// ウィンドウへのドロップで取り込む（#234）＝OS からローカルのファイルやフォルダをアプリの
// ウィンドウへドラッグする。ローカルのファイルの入り口は他に2つあり、Data.tsx（ファイルの
// 選択ダイアログ）と clipboard-intake.ts（Ctrl+V）に既にある。これが3つ目で、しかも異質だ。
// フォルダのドロップは、利用者が思っていたよりずっと多くを引き込みうるから。ダイアログ
// （明示的で範囲の決まった選択）と違い、この入り口は必ず件数を先に確認し、その件数の元に
// なる再帰的な走査は、問いを出す前に走り切る＝走査の途中では尋ねないので、「いいえ」と
// 答えればライブラリには何も触れていない（#234 の設計のコメント）。
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

const reload = () => {
  if (loadPosts) loadPosts();
};

function reportImportError(error: string | undefined): void {
  notify(error === 'library-missing' ? t('saveFolderErrLibraryMissing') : t('importFailed'));
}

async function runImport(files: DroppedFile[]): Promise<void> {
  try {
    const out = await importDroppedPaths(files);
    if (out.error) {
      reportImportError(out.error);
      return;
    }
    reload();
    if (out.skipped > 0) notify(t('importSkipped', [out.imported, out.skipped]));
    else notify(t('imported', [out.imported]));
  } catch {
    notify(t('importFailed'));
  }
}

/**
 * ドロップの流れの全体＝収集 → 件数の確認 → 取り込み → 報告。利用者が件数を受け入れる前に、
 * 何かを書き込むことは決してない。
 */
export async function handleDroppedPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  let res: DropCollectResult;
  try {
    res = await collectDroppedPaths(paths);
  } catch {
    notify(t('importFailed'));
    return;
  }
  if (res.error) {
    reportImportError(res.error);
    return;
  }
  if (!res.files.length) {
    notify(t('dropNothingToImport'));
    return;
  }
  confirmOpen({
    message: t('dropImportConfirm', [res.files.length, res.mediaCount, res.otherCount]),
    okLabel: t('dropImportOk'),
    cancelLabel: t('confirmCancel'),
    okDestructive: false,
    onOk: () => void runImport(res.files),
  });
}

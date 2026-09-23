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
import { close as confirmClose, open as confirmOpen, update as confirmUpdate } from './confirm.ts';
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
 * ドロップの流れの全体＝収集 → （複数件またはフォルダなら件数の確認）→ 取り込み → 報告。
 */
export async function handleDroppedPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  confirmOpen({
    message: t('dropImportPreparing'),
    okLabel: t('dropImportOk'),
    cancelLabel: t('confirmCancel'),
    icon: 'folder',
    loading: true,
    okDestructive: false,
    onOk: () => {},
  });
  let res: DropCollectResult;
  try {
    res = await collectDroppedPaths(paths);
  } catch {
    confirmClose();
    notify(t('importFailed'));
    return;
  }
  // 走査中にキャンセルされたら、結果を表示も取り込みもせず終える。
  if (!confirmUpdate({})) return;
  if (res.error) {
    confirmClose();
    reportImportError(res.error);
    return;
  }
  if (!res.files.length) {
    confirmClose();
    notify(t('dropNothingToImport'));
    return;
  }
  if (res.files.length === 1 && !res.hasFolder) {
    confirmClose();
    await runImport(res.files, false);
    return;
  }
  confirmUpdate({
    message: t('dropImportConfirm', { count: res.files.length }),
    description: undefined,
    okLabel: t('dropImportOk'),
    cancelLabel: t('confirmCancel'),
    icon: 'help',
    optionLabel: res.hasFolder ? t('dropImportStackFolders') : undefined,
    optionDefault: false,
    optionDescription: undefined,
    optionPreviewItems: res.hasFolder
      ? res.groups.map((group) => ({
          label: group.isRoot ? t('dropImportRootFolder', { name: group.rootName }) : group.name,
          description: t('dropImportFolderItem', { count: group.mediaCount }),
          imageSrc: group.previewDataUrl,
          section: group.rootName,
        }))
      : undefined,
    okDestructive: false,
    loading: false,
    onOk: ({ option }) => void runImport(res.files, option === true),
  });
}

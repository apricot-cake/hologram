'use strict';

// ピン留め（浮動ミニビューア）ウィンドウの IPC ハンドラ（#79）。ウィンドウの
// 作成と、稼働中ウィンドウの登録簿は lib-pin-window.ts にある（ここには
// ctx 経由で届く。ipc-window.ts の openNewWindow が lib-window.ts に対して
// 使うのと同じ間接参照）——このモジュールは、実際にレンダラー境界を越える
// 3つのチャネルと、「このセットをフォルダとして保存」だけ。
import { ipcMain } from './activity-ipc.ts';
import type { IpcContext } from './ipc-context.ts';
import type { FoldersState, OkResult, PinItem } from './ipc-payloads.ts';

// services/folders.ts の genId がライブラリフォルダ用に生成するのと同じ id の形
// （idPrefix 'f'）——再利用ではなくここで合わせて作る。あの生成器はレンダラー
// 限定のモジュールクロージャで、ピン留めウィンドウはそれを一切読み込まないため
// （下のモジュールコメント参照）。
function makeFolderId(): string {
  return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function register(ctx: IpcContext) {
  const { getSaveFolder, getDbWriter, sendExcept, pinSend, pinGetInitial, pinToggleAlwaysOnTop } = ctx;

  // `handle` ではなく `on`: 投げっぱなし。open-new-window が既に
  // 使っているのと同じ形——呼び出し元が待つべきものは無く、opts.newWindow
  // （フォルダの「ピンで開く」の入り口）は即座に感じられるべき。
  ipcMain.on('pin-send', (_e, items: unknown, opts: unknown) => {
    if (!Array.isArray(items) || !items.length) return;
    const clean = items.filter((it): it is PinItem => !!it && typeof it.file === 'string' && it.file && typeof it.captureId === 'string' && typeof it.video === 'boolean');
    if (!clean.length) return;
    pinSend(clean, !!(opts && typeof opts === 'object' && (opts as { newWindow?: unknown }).newWindow));
  });

  // ピン留めウィンドウ自身が、何を持って開かれたかを最初に読む——なぜこれを
  // push ではなく pull にしているかは lib-pin-window.ts の takeInitial 参照。
  ipcMain.handle('pin-get-initial', (_e): PinItem[] => pinGetInitial(_e.sender.id));

  ipcMain.handle('pin-toggle-always-on-top', (_e): boolean => pinToggleAlwaysOnTop(_e.sender.id));

  // 「セットをフォルダとして保存」（#79）: 素の静的フォルダで、
  // services/folders.ts の createFolder + applyFolderItems が主レンダラーから
  // 作るのと同じ形——ただしここでは直接書く。ピン留めウィンドウはあのモジュールを
  // 一切読み込まないため（それは IPC のペアだけでなくレンダラー側のフォルダ
  // 「ストア」そのものであり、新しいエントリを1つ書くためだけにその他の状態まで
  // 引き込むのは、フォルダを読み返すことのないウィンドウにとって純粋な重荷に
  // なる）。`activeId` は変更せずそのまま素通りさせる——これは legacy で、
  // もうどの書き手もこれを設定しない（ipc-organize.ts 自身の get/set-folders の
  // コメント参照）。
  ipcMain.handle('pin-save-as-folder', (_e, name: unknown, captureIds: unknown): OkResult => {
    if (!getSaveFolder() || typeof name !== 'string' || !name.trim() || !Array.isArray(captureIds)) return { ok: false };
    const ids = [...new Set(captureIds.filter((c): c is string => typeof c === 'string' && !!c))];
    if (!ids.length) return { ok: false };
    try {
      const state: FoldersState = getDbWriter().getFolders();
      const folder: FoldersState['folders'][number] = { id: makeFolderId(), name: name.trim(), kind: 'static', created: Date.now(), parentId: null, items: ids };
      getDbWriter().setFolders({ folders: [...state.folders, folder], activeId: state.activeId });
      sendExcept(_e.sender.id, 'org-changed', 'folders');
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

export { register };

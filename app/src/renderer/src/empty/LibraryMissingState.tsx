import { useState, useSyncExternalStore } from 'react';
import { FolderSymlink, FolderX, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { t } from '../_shared/i18n.ts';
import { open as confirmOpen } from '../services/confirm.ts';
import { getLibraryStatus, pickRepointFolder, applyRepoint } from '../services/library-path.ts';
import { notify } from '../services/ui.ts';
import { store, subscribeKey } from '../services/store.ts';

// #37: 現在の保存フォルダがディスク上に無いとき、コンテンツ列（AppShell）全体を差し替える。
// 無いというのは、アプリの外側で移動・改名されたか、それを載せていたドライブが外された状態。
// 通常の empty/EmptyState.tsx の 'firstRun' 版は意図して使わない。#302 以降 posts テーブルは
// 保存フォルダから独立して DB にあり、フォルダが無くなっても postGroups は空にならない＝
// そのままでは、何が起きたかを説明する代わりに、グリッドが全カードを壊れたサムネイルで描画
// してしまう。hologramStore の 'libraryMissing'/'libraryMissingPath' は起動時に App.tsx の
// LibraryStatusGate が入れる（services/library-path.ts の getLibraryStatus。呼ぶたびに
// statSync し直す＝push の経路は無い。index.ts の refreshLibraryStatus のコメントを参照）。
// ここでは再試行・フォルダの再指定のあとに入れ直す。
const subMissing = (cb: () => void) => subscribeKey('libraryMissing', cb);
const getMissing = () => store.getState().libraryMissing;
const subPath = (cb: () => void) => subscribeKey('libraryMissingPath', cb);
const getPath = () => store.getState().libraryMissingPath;

export function LibraryMissingState() {
  const missing = useSyncExternalStore(subMissing, getMissing);
  const path = useSyncExternalStore(subPath, getPath);
  const [busy, setBusy] = useState(false);
  if (!missing) return null;

  const refresh = async () => {
    try {
      const status = await getLibraryStatus();
      store.setState({ libraryMissing: !!(status && status.missing) });
      store.setState({ libraryMissingPath: (status && status.path) || null });
      if (!status || !status.missing) notify(t('libraryMissingResolved'));
    } catch {
      /* 画面はそのまま出しておく＝利用者がもう一度やり直せる */
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const doRepoint = async (dest: string) => {
    setBusy(true);
    try {
      const res = await applyRepoint(dest);
      if (res && res.ok) {
        store.setState({ libraryMissing: false });
        store.setState({ libraryMissingPath: null });
        notify(t('libraryMissingRepointDone'));
      } else {
        notify(t('saveFolderErrGeneric'));
      }
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const repoint = async () => {
    setBusy(true);
    try {
      const res = await pickRepointFolder();
      if (!res || res.canceled) return;
      if (!res.ok || !res.dest) {
        notify(t('saveFolderErrGeneric'));
        return;
      }
      if (res.hasEvidence) {
        await doRepoint(res.dest);
        return;
      }
      // 選ばれたフォルダに既存ライブラリの手がかりが無い場合（#37）＝黙って再指定せず確認を
      // 出す。ライブラリを本当にそこへ移動したのでない限り、既存の投稿の画像が解決できない
      // ため。
      const dest = res.dest;
      confirmOpen({
        message: t('libraryMissingRepointConfirm'),
        description: t('libraryMissingRepointConfirmDesc'),
        okLabel: t('libraryMissingRepointConfirmOk'),
        cancelLabel: t('confirmCancel'),
        onOk: () => void doRepoint(dest),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Empty data-slot="library-missing" className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderX />
        </EmptyMedia>
        <EmptyTitle>{t('libraryMissingTitle')}</EmptyTitle>
        <EmptyDescription>
          {t('libraryMissingDesc')}
          <br />
          <code className="bg-muted mt-2 inline-block max-w-full rounded-md px-2.5 py-1.5 font-mono text-xs break-all">{path}</code>
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={() => void retry()} disabled={busy}>
            <RotateCw />
            {t('libraryMissingRetry')}
          </Button>
          <Button variant="outline" onClick={() => void repoint()} disabled={busy}>
            <FolderSymlink />
            {t('libraryMissingRepoint')}
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}

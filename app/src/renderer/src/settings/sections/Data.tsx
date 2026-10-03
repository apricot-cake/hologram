import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Hint } from '../components/Hint.tsx';
import { Highlight } from '../components/Highlight.tsx';
import { toast } from 'sonner';
import { t } from '../../_shared/i18n.ts';
import { notify } from '../../services/ui.ts';
import { getExportReminder, setExportReminderEnabled, setExportReminderThreshold, getIntegrityStatus, runOrphanRecovery, onIntegrityCheckDone } from '../../services/backup.ts';
import { createBackupFile } from '../../services/backup-file.ts';
import { onExportProgress, onSaveFolderProgress, pickSaveFolder, moveSaveFolder, exportComplete, importImages } from '../../services/posts.ts';
import { loadPosts } from '../../services/post-grid-builder.ts';
import { runZipImport } from '../../services/zip-import.ts';
import type { ExportReminderState, IntegrityStatus, SaveFolderProgress } from '../../../../main/ipc-payloads.ts';

// ブリッジが無い状態での呼び出しは例外を投げ、呼び出し側の try/catch に落ちる。型の無い
// 元のコードと同じ＝{} の代わりは、素の開発サーバーのためだけに存在する。
const hologram = (): HologramPreload => window.hologram || ({} as HologramPreload);
const reloadPosts = () => {
  if (loadPosts) loadPosts();
};

// save-folder-progress / get-integrity-status の
// payload は共有の IPC の取り決め（#228）＝このコンポーネントは以前、4つとも手書きの
// 写しを自分で持っていた。あの取り決めが止めようとしているのは、まさにそのずれ。

// preload の on* ブリッジは呼ばれるたびに新しい ipcRenderer のリスナーを付け、外す手段を
// 持たない。しかもこのコンポーネントはモーダルが開くたびに載せ直る。だから下地の IPC の
// リスナーの登録は1回だけにして、生きている React の購読者の集合へ配る＝effect は自分を
// 出し入れするだけで、IPC を購読し直すことは一切しない。
const progressSubs = new Set<(p: SaveFolderProgress) => void>();
const integritySubs = new Set<(s: IntegrityStatus) => void>();
let ipcWired = false;
function wireIpcOnce() {
  if (ipcWired) return;
  ipcWired = true;
  try {
    onSaveFolderProgress((p) => progressSubs.forEach((cb) => cb(p)));
  } catch {
    /* 素の開発サーバー: hologramPosts の裏に preload のブリッジが無い */
  }
  try {
    onIntegrityCheckDone((s: IntegrityStatus) => integritySubs.forEach((cb) => cb(s)));
  } catch {
    /* 素の開発サーバー: hologramBackup の裏に preload のブリッジが無い */
  }
}

// 移行のエラーコード → メッセージのキー。viewer.js の setupSaveFolder.errMsg に忠実。
const saveFolderErr = (code?: string) => {
  switch (code) {
    case 'same':
      return t('saveFolderErrSame');
    case 'nested':
      return t('saveFolderErrNested');
    case 'config-overlap':
      return t('saveFolderErrOverlap');
    case 'collision':
      return t('saveFolderErrCollision');
    case 'copy-failed':
      return t('saveFolderErrCopyFailed');
    case 'not-writable':
      return t('saveFolderErrNotWritable');
    // #37: 今の保存先フォルダがディスク上に無い＝そこから複写する移動は、はなから
    // 拒む。抜け道はこのダイアログの変更ボタンではなく、内容の列にある指し直しの
    // ボタン。
    case 'library-missing':
      return t('saveFolderErrLibraryMissing');
    default:
      return t('saveFolderErrGeneric');
  }
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// ファイルシステムのパスを、行中のコードのチップとして見せる。
function PathChip({ children }: { children?: string | null }) {
  return <code className="bg-muted min-w-0 flex-1 rounded-md px-2.5 py-1.5 font-mono text-xs break-all">{children}</code>;
}

// データ: 保存先フォルダ、書き出しと取り込み、ローカル復旧、エクスポート通知。
export function Data() {
  // --- 保存先フォルダ ---
  const [saveFolder, setSaveFolder] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; log: string[] } | null>(null); // 移動の最中と、その後

  const [exportReminder, setExportReminder] = useState<ExportReminderState | null>(null);
  // --- 整合性（#301） ---
  const [integrity, setIntegrity] = useState<IntegrityStatus | null>(null);
  const [recovering, setRecovering] = useState(false);

  // モーダルは開くたびに載せ直るので、現在の状態をその都度読む。
  useEffect(() => {
    Promise.resolve(hologram().getConfig ? hologram().getConfig() : null)
      .then((cfg) => setSaveFolder((cfg && cfg.saveFolder) || ''))
      .catch(() => {});
    Promise.resolve(getExportReminder())
      .then((state) => setExportReminder(state || null))
      .catch(() => {});
    Promise.resolve(getIntegrityStatus())
      .then((s) => setIntegrity(s || null))
      .catch(() => {});
  }, []);

  // 移行の進み具合を実時間で伝えるイベント。複写の百分率はバーだけを動かし、ログの行は
  // 段階の節目（開始 / 切り替え / 掃除 / 完了）＝「…20%」の垂れ流しはしない。
  useEffect(() => {
    wireIpcOnce();
    const onProg = (p: SaveFolderProgress) => {
      if (!p) return;
      setProgress((prev) => {
        const log = prev ? prev.log.slice() : [];
        let pct = prev ? prev.pct : 0;
        if (p.phase === 'copy') {
          if (p.done === 0) log.push(t('logCopyStart', { count: p.total }));
          pct = p.percent as number; // 'copy' のイベントには必ず入っている
        } else if (p.phase === 'switch') {
          pct = 100;
          log.push(t('logSwitch'));
        } else if (p.phase === 'cleanup') {
          log.push(t('logCleanup'));
        } else if (p.phase === 'done') {
          pct = 100;
          log.push(t('logMoveDone', { count: p.moved }));
          if ((p.leftover as number) > 0) log.push(t('logLeftover', { count: p.leftover }));
        } else if (p.phase === 'straggler') {
          log.push(t('logStraggler', { count: p.moved }));
        } else if (p.phase === 'error') {
          log.push(saveFolderErr(p.error));
        }
        return { pct, log };
      });
    };
    progressSubs.add(onProg);
    return () => {
      progressSubs.delete(onProg);
    };
  }, []);

  // 選択と移動の往復の結果を反映する（どちらも同じ形を返す）。
  const applyMoveResult = (res: any) => {
    if (res && res.ok) {
      setSaveFolder(res.saveFolder);
      notify(t('saveFolderMoved', { count: res.moved }));
      reloadPosts();
    } else {
      notify(saveFolderErr(res && res.error));
    }
  };

  const chooseSaveFolder = async () => {
    setMigrating(true);
    setProgress(null); // 箱は最初の進み具合のイベントで現れる（フォルダを選んだ後）
    try {
      const res = await pickSaveFolder();
      if (!res || res.canceled) {
        setProgress(null);
        return;
      }
      // クラウド同期の警告と承認は main 所有のネイティブ UI で既に完了している。
      // renderer は移動先を受け取らず、同じ WebContents の一回限りの許可だけを消費する。
      if (res.confirm === 'cloud-sync') {
        applyMoveResult(await moveSaveFolder());
        return;
      }
      applyMoveResult(res);
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setMigrating(false);
    }
  };

  // --- 書庫を書き出す ---
  // main 側の呼び出し1つに対してボタンが2つある。#233 が、以前の「Export ZIP」という
  // 操作部品1つが混ぜていた2つの語を分けたから＝バックアップのファイルはライブラリ全体と
  // その整理を合わせたもので、復元されるために作る。書き出しは他の何かへ渡すメディア。
  // `mode` は main が元から受け取っていたもの（'full' / 'images'）なので、この分割は UI の
  // 語彙であって2本目のコード経路ではない（#57 の「手動の完全 ZIP はバックアップの下へ
  // 移すが、実装はそのまま」）。
  const [exportIncludeTrash, setExportIncludeTrash] = useState(false); // #300/St7: 明示的に選ぶ方式で、既定は off
  const writeArchive = async (mode: 'full' | 'images') => {
    if (mode === 'full') {
      const result = await createBackupFile(exportIncludeTrash);
      if (result?.saved) {
        setExportReminder(await getExportReminder());
      }
      return;
    }
    // 貼り付いたままの読み込み中のトーストが、ディスクへ流し込んだ百分率を実時間で見せる
    // （main の 'export-progress' を onExportProgress 経由で受ける）。保存ダイアログの
    // 待ち時間もこれで覆う。
    const id = 'hologram-export';
    toast.loading(t('exporting'), { id, description: '0%' });
    const off = onExportProgress((p) => {
      if (!p || p.done) return;
      toast.loading(t('exporting'), { id, description: `${p.pct ?? 0}%` });
    });
    try {
      const res = await exportComplete(mode, false);
      off();
      toast.dismiss(id);
      if (res && res.saved) notify(t('exported'));
      else if (res && res.empty) notify(t('noData'));
      else if (res && res.error) notify(t('exportFailed'));
      // ダイアログを取り消した場合（res.saved が false で、empty も error も無い）: トースト
      // は既に閉じてある。
    } catch {
      off();
      toast.dismiss(id);
      notify(t('exportFailed'));
    }
  };

  // --- ZIP の取り込み ---（新しい完全な形式と、旧来の metadata.json + images/）
  // 流れそのものは services/zip-import.ts にあり、空状態の CTA と共有している＝この節が
  // 持つのはボタンだけ。

  // --- メディアの取り込み（任意のローカルの画像・動画のファイル） ---
  const importMedia = async () => {
    try {
      const res = await importImages();
      if (!res || res.canceled) return;
      // #37: 保存先フォルダが無い間、main は拒む（ipc-transfer.ts の import-images の
      // 防ぎを参照）＝「0件取り込んだ」と報せるのではなく、そのことを見せる。
      if (res.error) {
        notify(res.error === 'library-missing' ? t('saveFolderErrLibraryMissing') : t('importFailed'));
        return;
      }
      reloadPosts();
      if (res.skipped > 0) notify(t('importSkipped', { count: res.imported, skipped: res.skipped }));
      else notify(t('imported', { count: res.imported }));
    } catch {
      notify(t('importFailed'));
    }
  };

  // --- 整合性のイベント: 起動時の検査が終わったら更新する ---
  useEffect(() => {
    wireIpcOnce();
    const onDone = (s: IntegrityStatus) => setIntegrity(s || null);
    integritySubs.add(onDone);
    return () => {
      integritySubs.delete(onDone);
    };
  }, []);

  const recoverOrphans = async () => {
    setRecovering(true);
    try {
      const res = await runOrphanRecovery();
      if (res && res.ok) {
        notify(t('integrityRecovered', { count: res.recovered }));
        reloadPosts();
      }
      try {
        setIntegrity((await getIntegrityStatus()) || null);
      } catch {
        /* 無視する */
      }
    } catch {
      /* 無視する */
    } finally {
      setRecovering(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 保存先フォルダ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('saveFolderSubTitle')} />
          </CardTitle>
          <CardDescription>
            <Highlight text={t('saveFolderHint')} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <PathChip>{saveFolder}</PathChip>
            <Button variant="outline" onClick={chooseSaveFolder} disabled={migrating}>
              {migrating ? t('saveFolderMoving') : t('saveFolderChange')}
            </Button>
          </div>
          {/* 移行の進み具合（移動中以外は隠す） */}
          {progress && (
            <div className="space-y-2.5">
              <div className="text-sm font-medium">{t('saveFolderProgressTitle')}</div>
              <div className="flex items-center gap-3">
                <Progress value={progress.pct} className="flex-1" />
                <span className="text-muted-foreground min-w-10 text-right text-xs tabular-nums">{progress.pct}%</span>
              </div>
              <div className="bg-muted text-muted-foreground max-h-36 overflow-y-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {progress.log.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* メディアの書き出しと取り込み＝バックアップではなく、他の何かへファイルを渡すこと */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('exportSubTitle')} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Button variant="outline" onClick={() => void writeArchive('images')}>
              {t('exportZip')}
            </Button>
            <Hint text={t('hintZip')} />
          </div>
          <Separator />
          <div>
            <Button variant="outline" onClick={importMedia}>
              {t('importImages')}
            </Button>
            <Hint text={t('hintMedia')} />
          </div>
        </CardContent>
      </Card>

      {/* 手動バックアップと、この PC 内での復元。 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('backupSubTitle')} />
          </CardTitle>
          <CardDescription>
            <Highlight text={t('hintBackup')} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-medium">
              <Highlight text={t('backupFileSubTitle')} />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              <Button variant="outline" onClick={() => void writeArchive('full')}>
                {t('backupFileCreate')}
              </Button>
              <Button variant="outline" onClick={() => void runZipImport()}>
                {t('importZip')}
              </Button>
              <div className="flex items-center gap-1.5">
                <Checkbox id="export-include-trash" checked={exportIncludeTrash} onCheckedChange={(v) => setExportIncludeTrash(v === true)} />
                <Label htmlFor="export-include-trash" className="font-normal">
                  {t('exportIncludeTrash')}
                </Label>
              </div>
            </div>
            <Hint text={t('hintBackupFile')} />
            <div className="mt-3 flex items-center gap-2">
              <Checkbox
                id="export-reminder"
                checked={exportReminder?.enabled !== false}
                onCheckedChange={(value) => {
                  const enabled = value === true;
                  void setExportReminderEnabled(enabled)
                    .then(setExportReminder)
                    .catch(() => {});
                }}
              />
              <Label htmlFor="export-reminder" className="font-normal">
                {t('exportReminderEnabled')}
              </Label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <Label htmlFor="export-reminder-threshold" className="font-normal">
                {t('exportReminderThreshold')}
              </Label>
              <Select
                value={String(exportReminder?.threshold ?? 100)}
                onValueChange={(value) => {
                  const threshold = Number(value);
                  void setExportReminderThreshold(threshold)
                    .then(setExportReminder)
                    .catch(() => {});
                }}
              >
                <SelectTrigger id="export-reminder-threshold" className="w-28" disabled={exportReminder?.enabled === false}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 250].map((threshold) => (
                    <SelectItem key={threshold} value={String(threshold)}>
                      {t('exportReminderCount', { count: threshold })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Hint text={t('exportReminderHint')} />
            {exportReminder?.lastExportAt && <div className="text-muted-foreground mt-2 text-[0.8rem]">{t('exportReminderLast', { date: fmtTime(exportReminder.lastExportAt) })}</div>}
          </div>
        </CardContent>
      </Card>

      {/* 整合性の検査（#301）＝問題が無いときは段階的な開示によって隠す */}
      {integrity && (integrity.dbOk === false || (integrity.orphanCount ?? 0) > 0 || (integrity.missingCount ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <Highlight text={t('integritySubTitle')} />
            </CardTitle>
            <CardDescription>
              <Highlight text={t('hintIntegrity')} />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {integrity.dbOk === false && <div className="text-destructive text-[0.8rem]">{`⚠ ${t('integrityDbBad')}`}</div>}
            {(integrity.orphanCount ?? 0) > 0 && (
              <div className="text-destructive flex flex-wrap items-center gap-2.5 text-[0.8rem]">
                <span>{`⚠ ${t('integrityOrphanLine', { count: integrity.orphanCount })}`}</span>
                <Button variant="outline" size="sm" onClick={recoverOrphans} disabled={recovering}>
                  {t('integrityRecoverBtn')}
                </Button>
              </div>
            )}
            {(integrity.missingCount ?? 0) > 0 && <div className="text-destructive text-[0.8rem]">{`⚠ ${t('integrityMissingLine', { count: integrity.missingCount })}`}</div>}
            {integrity.lastCheckAt && <div className="text-muted-foreground text-[0.8rem]">{t('integrityLastChecked', { date: fmtTime(integrity.lastCheckAt) })}</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

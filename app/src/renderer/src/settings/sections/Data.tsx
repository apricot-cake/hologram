import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Hint } from '../components/Hint.tsx';
import { Highlight } from '../components/Highlight.tsx';
import { toast } from 'sonner';
import { t } from '../../_shared/i18n.ts';
import { notify } from '../../services/ui.ts';
import { getBackup, setBackup as setBackupConfig, pickBackupDir, onBackupDone, getIntegrityStatus, runOrphanRecovery, onIntegrityCheckDone, listDbGenerations, rollbackDbGeneration } from '../../services/backup.ts';
import { onExportProgress, onSaveFolderProgress, pickSaveFolder, moveSaveFolder, exportComplete, importImages, getWatchImport, pickWatchImportFolder, setWatchImport } from '../../services/posts.ts';
import { pickLibraryFolder, switchLibrary as switchLibraryIpc, getRecentLibraries, removeRecentLibrary as removeRecentLibraryIpc } from '../../services/library-path.ts';
import { open as confirmOpen } from '../../services/confirm.ts';
import { loadPosts } from '../../services/post-grid-builder.ts';
import { runZipImport } from '../../services/zip-import.ts';
import type { BackupConfig, BackupRunResult, DbGeneration, IntegrityStatus, RecentLibraryEntry, SaveFolderProgress, WatchImportFolder } from '../../../../main/ipc-payloads.ts';

// ブリッジが無い状態での呼び出しは例外を投げ、呼び出し側の try/catch に落ちる。型の無い
// 元のコードと同じ＝{} の代わりは、素の開発サーバーのためだけに存在する。
const hologram = (): HologramPreload => window.hologram || ({} as HologramPreload);
const reloadPosts = () => {
  if (loadPosts) loadPosts();
};

// save-folder-progress / get-backup / backup-done / get-integrity-status の
// payload は共有の IPC の取り決め（#228）＝このコンポーネントは以前、4つとも手書きの
// 写しを自分で持っていた。あの取り決めが止めようとしているのは、まさにそのずれ。

// preload の on* ブリッジは呼ばれるたびに新しい ipcRenderer のリスナーを付け、外す手段を
// 持たない。しかもこのコンポーネントはモーダルが開くたびに載せ直る。だから下地の IPC の
// リスナーの登録は1回だけにして、生きている React の購読者の集合へ配る＝effect は自分を
// 出し入れするだけで、IPC を購読し直すことは一切しない。
const progressSubs = new Set<(p: SaveFolderProgress) => void>();
const backupSubs = new Set<(r: BackupRunResult) => void>();
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
    onBackupDone((r: BackupRunResult) => backupSubs.forEach((cb) => cb(r)));
  } catch {
    /* 素の開発サーバー: hologramBackup の裏に preload のブリッジが無い */
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
    case 'backup-overlap':
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

// #176: pick-library-folder / switch-library のエラーコード。'not-a-library' が新しく
// （4通りの分類の 'reject' の枝）、それ以外は saveFolderErr 経由で validateSaveFolder の
// コードを使い回す。
const libraryErr = (code?: string) => {
  switch (code) {
    case 'not-a-library':
      return t('libraryErrNotALibrary');
    case 'busy':
      return t('libraryErrBusy');
    case 'open-failed':
      return t('libraryErrOpenFailed');
    default:
      return saveFolderErr(code);
  }
};

// #37: バックアップの実行の失敗のうち、決まったエラーコードであるもの（任意の例外の
// .message ではない。あちらは default へ落ちて、そのまま表示される）。
const backupErr = (code?: string | null) => {
  switch (code) {
    case 'dest-missing':
      return t('backupErrDestMissing');
    case 'src-missing':
      return t('backupErrSrcMissing');
    // #233/#176: 行き先を別のライブラリが押さえているので、行き先の何にも触れないうちに
    // 実行を拒んだ。
    case 'library-mismatch':
      return t('backupErrLibraryMismatch');
    default:
      return code || '';
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

// データ: 保存先フォルダ（移行の進み具合を実時間で出す）、書き出しと取り込み、自動
// バックアップ。viewer.js の setupSaveFolder と書き出し・取り込みのハンドラと setupBackup
// を移したもの＝モーダル側の UI だけ。常に見えているレールは mirror/MirrorStatus.tsx。
export function Data() {
  // --- 保存先フォルダ ---
  const [saveFolder, setSaveFolder] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; log: string[] } | null>(null); // 移動の最中と、その後

  // --- ライブラリの切り替え（#176） ---
  const [switchingLib, setSwitchingLib] = useState(false);
  const [recentLibraries, setRecentLibraries] = useState<RecentLibraryEntry[]>([]);
  const refreshRecentLibraries = () => {
    Promise.resolve(getRecentLibraries())
      .then((list) => setRecentLibraries(list || []))
      .catch(() => {});
  };

  // --- バックアップ ---
  const [backup, setBackup] = useState<BackupConfig | null>(null);
  // --- 復元ポイント（#233 の DB の世代） ---
  const [generations, setGenerations] = useState<DbGeneration[]>([]);
  const [rollingBack, setRollingBack] = useState(false);

  // --- 整合性（#301） ---
  const [integrity, setIntegrity] = useState<IntegrityStatus | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [watchFolders, setWatchFolders] = useState<WatchImportFolder[]>([]);
  const [watchImported, setWatchImported] = useState(0);

  // 載せる時に、設定の保存先フォルダとバックアップの設定を両方読む（モーダルは開くたびに
  // 載せ直るので、これが以前の「開いたら読み込み直す」と同じになる）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshRecentLibraries is a fresh closure every render — this effect intentionally runs once, on mount only
  useEffect(() => {
    Promise.resolve(hologram().getConfig ? hologram().getConfig() : null)
      .then((cfg) => setSaveFolder((cfg && cfg.saveFolder) || ''))
      .catch(() => {});
    Promise.resolve(getBackup())
      .then((b) => setBackup(b || null))
      .catch(() => {});
    Promise.resolve(getIntegrityStatus())
      .then((s) => setIntegrity(s || null))
      .catch(() => {});
    Promise.resolve(getWatchImport())
      .then((v) => {
        setWatchFolders(v?.folders || []);
        setWatchImported(v?.status?.imported || 0);
      })
      .catch(() => {});
    Promise.resolve(listDbGenerations())
      .then((g) => setGenerations(g || []))
      .catch(() => {});
    refreshRecentLibraries();
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
          if (p.done === 0) log.push(t('logCopyStart', [p.total]));
          pct = p.percent as number; // 'copy' のイベントには必ず入っている
        } else if (p.phase === 'switch') {
          pct = 100;
          log.push(t('logSwitch'));
        } else if (p.phase === 'cleanup') {
          log.push(t('logCleanup'));
        } else if (p.phase === 'done') {
          pct = 100;
          log.push(t('logMoveDone', [p.moved]));
          if ((p.leftover as number) > 0) log.push(t('logLeftover', [p.leftover]));
        } else if (p.phase === 'straggler') {
          log.push(t('logStraggler', [p.moved]));
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
      notify(t('saveFolderMoved', [res.moved]));
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
      // クラウド同期に見える行き先は、拒否ではなく警告（#95）＝尋ねて、それでも利用者が
      // 望むなら移す。
      if (res.confirm === 'cloud-sync') {
        // 1回だけ束縛する。下のコールバックは res.dest に対する型の絞り込みより長生き
        // する。main は confirm と一緒に必ず dest を送る＝これを省略可能にしているのは、
        // 平たい結果の形（ipc-payloads.ts）の方。
        const dest = res.dest as string;
        setProgress(null);
        confirmOpen({
          message: t('saveFolderCloudWarn', [res.provider]),
          description: t('saveFolderCloudWarnDesc'),
          okLabel: t('saveFolderCloudWarnOk'),
          cancelLabel: t('confirmCancel'),
          onOk: async () => {
            setMigrating(true);
            try {
              applyMoveResult(await moveSaveFolder(dest));
            } catch {
              notify(t('saveFolderErrGeneric'));
            } finally {
              setMigrating(false);
            }
          },
        });
        return;
      }
      applyMoveResult(res);
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setMigrating(false);
    }
  };

  // --- ライブラリの切り替え（#176）＝切り替え / 新規作成 / 最近使ったライブラリ。成功
  // すれば main が自分ですべてのウィンドウを起動し直す（それが switchLibrary の眼目。
  // 整理の層のストアが部分的にしか同期し直せていない状態は、まさに全体の読み込み直しが
  // 避ける不具合の類）ので、ここで ok の時に他へ手を入れるものは無い。
  const doSwitch = async (dest: string) => {
    setSwitchingLib(true);
    try {
      const res = await switchLibraryIpc(dest);
      if (res && res.ok) {
        notify(t('librarySwitched'));
      } else {
        notify(libraryErr(res && res.error));
      }
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setSwitchingLib(false);
      refreshRecentLibraries();
    }
  };

  const pickAndSwitch = async () => {
    setSwitchingLib(true);
    try {
      const res = await pickLibraryFolder();
      if (!res || res.canceled) return;
      if (!res.ok || !res.dest) {
        notify(libraryErr(res && res.error));
        return;
      }
      const dest = res.dest;
      if (res.classification === 'empty') {
        confirmOpen({
          message: t('libraryEmptyConfirm'),
          description: t('libraryEmptyConfirmDesc'),
          okLabel: t('libraryEmptyConfirmOk'),
          cancelLabel: t('confirmCancel'),
          onOk: () => void doSwitch(dest),
        });
        return;
      }
      if (res.classification === 'evidence-no-db') {
        confirmOpen({
          message: t('libraryRecoverConfirm'),
          description: t('libraryRecoverConfirmDesc'),
          okLabel: t('libraryRecoverConfirmOk'),
          cancelLabel: t('confirmCancel'),
          onOk: () => void doSwitch(dest),
        });
        return;
      }
      await doSwitch(dest); // 'has-db' ＝確認は要らない
    } finally {
      setSwitchingLib(false);
    }
  };

  // 「最近使ったライブラリ」の行は既に問題ないと分かっている（前に開いている）＝選択も
  // 分類も確認も要らない。
  const switchToRecent = (path: string) => void doSwitch(path);
  const forgetRecent = async (path: string) => {
    try {
      await removeRecentLibraryIpc(path);
    } catch {
      /* 無視する */
    } finally {
      refreshRecentLibraries();
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
      const res = await exportComplete(mode, mode === 'full' && exportIncludeTrash);
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
      if (res.skipped > 0) notify(t('importSkipped', [res.imported, res.skipped]));
      else notify(t('imported', [res.imported]));
    } catch {
      notify(t('importFailed'));
    }
  };

  const saveWatchFolders = async (folders: WatchImportFolder[], markExisting?: string[]) => {
    try {
      const next = await setWatchImport(folders, markExisting);
      setWatchFolders(next?.folders || folders);
      setWatchImported(next?.status?.imported || 0);
    } catch {
      notify(t('watchImportFailed'));
    }
  };
  const addWatchFolder = async () => {
    try {
      const picked = await pickWatchImportFolder();
      if (!picked || picked.canceled) return;
      if (!picked.ok || !picked.path) {
        notify(t('watchImportOverlap'));
        return;
      }
      const folder = picked.path;
      confirmOpen({
        message: t('watchImportExisting'),
        description: t('watchImportExistingDesc'),
        okLabel: t('watchImportExistingYes'),
        cancelLabel: t('watchImportExistingNo'),
        onOk: () => void saveWatchFolders([...watchFolders, { path: folder, enabled: true }]),
        onCancel: () => void saveWatchFolders([...watchFolders, { path: folder, enabled: true }], [folder]),
      });
    } catch {
      notify(t('watchImportFailed'));
    }
  };

  // --- バックアップのイベント: 実行が終わったら状態の行を更新する ---
  // （onBackupStart はレールの「同期中」のグリフを動かすだけで、あれは viewer.js に残る。）
  useEffect(() => {
    wireIpcOnce();
    const onDone = (r: BackupRunResult) => {
      if (!r) return;
      setBackup((b) => (b ? Object.assign({}, b, { lastResult: r }) : b));
      // 実行は世代を1つ足して、それを行き先へ運びうる。だから一覧も、行ごとの「行き先
      // にもある」の印も、今や古くなっている。
      Promise.resolve(listDbGenerations())
        .then((g) => setGenerations(g || []))
        .catch(() => {});
    };
    backupSubs.add(onDone);
    return () => {
      backupSubs.delete(onDone);
    };
  }, []);

  // --- 整合性のイベント: 起動時の検査、またはバックアップの実行に相乗りした検査が
  // 終わったら更新する（#301） ---
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
        notify(t('integrityRecovered', [res.recovered]));
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

  const saveBackup = async (patch: Partial<BackupConfig>) => {
    try {
      const res = await setBackupConfig(patch);
      if (res && res.ok === false && res.error === 'overlap') notify(t('backupOverlap'));
      if (res && res.backup) setBackup(res.backup);
    } catch {
      /* 無視する */
    }
  };
  const chooseBackupDir = async () => {
    try {
      const res = await pickBackupDir();
      if (res && res.error === 'overlap') {
        notify(t('backupOverlap'));
        return;
      }
      if (res && res.backup) setBackup(res.backup);
    } catch {
      /* 無視する */
    }
  };

  // ある世代へ巻き戻す（#233）。先に確認を取るのは、整理の層をまるごと差し替えるからと、
  // main が答えた直後にすべてのウィンドウを起動し直すから＝下のトーストが、利用者の受け
  // 取る唯一の報せになる。
  const rollBackTo = (g: DbGeneration) => {
    confirmOpen({
      message: t('backupRestoreConfirm', [fmtTime(g.at)]),
      description: t('backupRestoreConfirmDesc'),
      okLabel: t('backupRestoreOk'),
      cancelLabel: t('confirmCancel'),
      onOk: async () => {
        setRollingBack(true);
        try {
          const res = await rollbackDbGeneration(g.name);
          if (res && res.ok) notify(t('backupRestoreDone', [fmtTime(g.at), res.reregistered ?? 0]));
          else notify(res && res.error === 'busy' ? t('backupRestoreBusy') : t('backupRestoreFailed'));
        } catch {
          notify(t('backupRestoreFailed'));
        } finally {
          setRollingBack(false);
        }
      },
    });
  };

  // 状態の行。viewer.js の renderStatus を簡単にしたもの（アイコンはレールが持ち続ける）。
  const renderBackupStatus = () => {
    if (!backup || !backup.dir) return null;
    const r = backup.lastResult;
    if (!r) return null;
    if (r.ok === false && r.error) {
      return <div className="text-destructive mt-2 text-[0.8rem]">{`⚠ ${backupErr(r.error)}`}</div>;
    }
    if (r.pruneSkipped) {
      const msg = r.pruneSkipped === 'shrink' ? t('backupPruneShrink') : t('backupPruneEmpty');
      return <div className="text-destructive mt-2 text-[0.8rem]">{`⚠ ${msg}`}</div>;
    }
    let s = `${t('backupLastLabel')} ${fmtTime(r.at)}`;
    if (r.written) s += `（+${r.written}${t('backupItemsUnit')}）`;
    else if (r.fileCount) s += `（${r.fileCount}${t('backupItemsUnit')}）`;
    return <div className="text-muted-foreground mt-2 text-[0.8rem]">{s}</div>;
  };

  return (
    <div className="space-y-6">
      {/* #176: ライブラリを切り替える＝下の「保存先フォルダ」とは別。あちらは別の
          ライブラリを開くのではなく、今のライブラリを移動させる。 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('libraryCardTitle')} />
          </CardTitle>
          <CardDescription>
            <Highlight text={t('libraryCardHint')} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <PathChip>{saveFolder}</PathChip>
          </div>
          <div className="text-muted-foreground text-[0.8rem]">
            {t('libraryBackupPrefix')}
            {(backup && backup.dir) || t('libraryBackupNone')}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="outline" onClick={() => void pickAndSwitch()} disabled={switchingLib}>
              {switchingLib ? t('libraryChanging') : t('librarySwitch')}
            </Button>
            <Button variant="outline" onClick={() => void pickAndSwitch()} disabled={switchingLib}>
              {t('libraryCreateNew')}
            </Button>
          </div>
          {recentLibraries.length > 1 && (
            <div>
              <div className="text-sm font-medium">
                <Highlight text={t('libraryRecentTitle')} />
              </div>
              <div className="mt-2 space-y-1.5">
                {recentLibraries
                  .filter((r) => r.path !== saveFolder)
                  .map((r) => (
                    <div key={r.path} className="flex flex-wrap items-center gap-2.5">
                      <PathChip>{r.path}</PathChip>
                      {r.exists ? (
                        <Button variant="ghost" size="sm" onClick={() => switchToRecent(r.path)} disabled={switchingLib}>
                          {t('librarySwitchTo')}
                        </Button>
                      ) : (
                        <>
                          <span className="text-destructive text-xs">{t('libraryRecentDead')}</span>
                          <Button variant="ghost" size="sm" onClick={() => void forgetRecent(r.path)}>
                            {t('libraryRecentForget')}
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('watchImportTitle')} />
          </CardTitle>
          <CardDescription>
            <Highlight text={t('watchImportHint')} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {watchFolders.map((folder) => (
            <div key={folder.path} className="flex flex-wrap items-center gap-2.5">
              <Checkbox checked={folder.enabled} onCheckedChange={(v) => void saveWatchFolders(watchFolders.map((item) => (item.path === folder.path ? { ...item, enabled: v === true } : item)))} />
              <PathChip>{folder.path}</PathChip>
              <Button variant="ghost" size="sm" onClick={() => void saveWatchFolders(watchFolders.filter((item) => item.path !== folder.path))}>
                {t('watchImportRemove')}
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2.5">
            <Button variant="outline" onClick={addWatchFolder}>
              {t('watchImportAdd')}
            </Button>
            {watchImported > 0 && <span className="text-muted-foreground text-xs">{t('watchImportLast', [watchImported])}</span>}
          </div>
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

      {/* バックアップ: 自動の行き先と、その隣に置く手動のバックアップのファイル
          （#57＝「バックアップ」の2つの半分は同じ画面に属する。一方は行き先へ絶えず
          送り続けるもので、もう一方は手で作るファイル1つ）。 */}
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
          <div className="flex flex-wrap items-center gap-2.5">
            <PathChip>{(backup && backup.dir) || t('backupDirNone')}</PathChip>
            <Button variant="outline" onClick={chooseBackupDir}>
              {t('backupChoose')}
            </Button>
            <Button variant="ghost" onClick={() => saveBackup({ dir: null })}>
              {t('backupClear')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Checkbox id="backup-interval" checked={!!(backup && backup.interval)} onCheckedChange={(v) => saveBackup({ interval: v === true })} />
            <Label htmlFor="backup-interval" className="font-normal">
              {t('backupInterval')}
            </Label>
            <Input
              type="number"
              min={1}
              max={999}
              value={(backup && backup.intervalValue) || 1}
              onChange={(e) => {
                const v = Math.max(1, Math.min(999, Number.parseInt(e.target.value, 10) || 1));
                saveBackup({ intervalValue: v });
              }}
              className="h-8 w-16 text-xs"
            />
            <Select items={{ day: t('unitDay'), week: t('unitWeek'), month: t('unitMonth') }} value={(backup && backup.intervalUnit) || 'day'} onValueChange={(v) => v !== null && saveBackup({ intervalUnit: v })}>
              <SelectTrigger size="sm" className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">{t('unitDay')}</SelectItem>
                <SelectItem value="week">{t('unitWeek')}</SelectItem>
                <SelectItem value="month">{t('unitMonth')}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm">{t('backupIntervalUnit')}</span>
          </div>
          {renderBackupStatus()}

          <Separator />

          {/* 復元ポイント: エンジンがローカルに残す DB の世代（#233）。メディアは1度
              書いたら書き換えず、巻き戻すこともないので、これは整理の層だけを指す＝
              「復元」という語に、投稿まで消えるかのように読ませるのではなく、文言で
              そう言っている。 */}
          <div>
            <div className="text-sm font-medium">
              <Highlight text={t('backupRestoreSubTitle')} />
            </div>
            {generations.length === 0 ? (
              <div className="text-muted-foreground mt-2.5 text-[0.8rem]">{t('backupRestoreNone')}</div>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                {generations.map((g) => (
                  <div key={g.name} className="flex flex-wrap items-center gap-2.5">
                    <span className="min-w-40 text-sm tabular-nums">{fmtTime(g.at)}</span>
                    {/* ボタンが列として縦に揃うよう幅を固定する。場所を示す2つのラベル
                        は長さが違い、端が不揃いだと行ごとに無関係な操作部品が並んで
                        いるように読めるから。 */}
                    <span className="text-muted-foreground min-w-36 text-xs">{g.atDestination ? t('backupRestoreBoth') : t('backupRestoreHere')}</span>
                    <Button variant="outline" size="sm" onClick={() => rollBackTo(g)} disabled={rollingBack}>
                      {t('backupRestoreBtn')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Hint text={t('hintBackupRestore')} />
          </div>

          <Separator />

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
                <span>{`⚠ ${t('integrityOrphanLine', [integrity.orphanCount])}`}</span>
                <Button variant="outline" size="sm" onClick={recoverOrphans} disabled={recovering}>
                  {t('integrityRecoverBtn')}
                </Button>
              </div>
            )}
            {(integrity.missingCount ?? 0) > 0 && <div className="text-destructive text-[0.8rem]">{`⚠ ${t('integrityMissingLine', [integrity.missingCount])}`}</div>}
            {integrity.lastCheckAt && <div className="text-muted-foreground text-[0.8rem]">{t('integrityLastChecked', [fmtTime(integrity.lastCheckAt)])}</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

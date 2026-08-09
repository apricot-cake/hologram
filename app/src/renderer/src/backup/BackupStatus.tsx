import { useEffect, useReducer, useRef } from 'react';
import { t } from '../_shared/i18n.ts';
import { fmtBackupTime, fmtTime } from '../services/format.ts';
import { getBackup, onBackupStart, onBackupDone, getIntegrityStatus, onIntegrityCheckDone } from '../services/backup.ts';
import { isOpen as settingsIsOpen, subscribe as settingsSubscribe } from '../services/settings.ts';

// バックアップの状態のレール＝自動バックアップの状態を見せる、常に見えているサイドバーの
// 足元の行。このコンポーネントが状態機械（バックアップの設定＋最後の結果＋同期中の旗）を
// 所有し、backup.ts（getBackup と onBackupStart/Done）から直接読んで、自前の t() と
// format.ts の fmtBackupTime/fmtTime でモデル（kind/text/title/time）を導く＝表示側からの
// 押し込みは無い（以前の共有の押し込みのブリッジと setupMirrorStatusRail は消えた）。
//
// 今は自分の根を描く（P3 #6）。状態の色合いは以前、useLayoutEffect がサイドバーの受け皿の
// <span> へ書き込む修飾のクラス（.is-syncing / .is-error / .is-done）だった＝別の
// コンポーネントの要素へ境界をまたいで DOM を書く行い（#153 の分類4）で、色合いが旧来の
// シートにあったというだけの理由で存在していた。色合いは今やこの要素自身の className の
// プロパティなので、サイドバーはコンポーネントを置くだけになる。

// 状態の字形（表示側の旧 MS_ICON_* をそのまま持ってきたもの）。回る矢印は同期中、チェックは
// 完了、三角は失敗と、掃除を差し止めた状態。
const IconSync = () => (
  <svg className="shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconDone = () => (
  <svg className="shrink-0" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconWarn = () => (
  <svg className="shrink-0" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

// 状態ごとのレールの色合い。色が付くのは2つの状態だけ＝実行中と、何かがおかしいとき。
// 終わったバックアップはサイドバーのありふれた常設部品なので、控えめなままにする。
const TONE: Record<string, string> = {
  syncing: 'text-[var(--accent-text)]',
  error: 'text-[var(--danger)]',
  done: '',
};

type BackupModel = { kind: 'syncing' | 'error' | 'done'; text: string; title?: string; time?: string } | null;

// 差し止めた掃除（空だった場合と、急に縮んだ場合）を人に向けて説明する。件数を後ろに足す。
function pruneSkipTip(r: any): string {
  if (r.pruneSkipped === 'shrink') {
    const span = r.baselineCount && r.fileCount != null ? `（${r.baselineCount}→${r.fileCount}${t('backupItemsUnit')}）` : '';
    return t('backupPruneShrink') + span;
  }
  return t('backupPruneEmpty');
}

// 素のバックアップの設定と同期中の旗から、レールのモデルを導く（表示側の旧
// updateMirrorStatus をそのまま持ってきたもの）。バックアップのフォルダが無ければ null
// （段階的な開示＝レールは空のままにする）。今日・昨日という相対時刻の語はここでは i18n が
// 持ち、ラベルとして fmtBackupTime へ渡す。
function deriveModel(cfg: any, syncing: boolean): BackupModel {
  if (!cfg || !cfg.dir) return null;
  if (syncing) return { kind: 'syncing', text: t('backupStateRunning'), title: t('backupRunning') };
  const r = cfg.lastResult;
  if (!r) return null;
  if (r.ok === false && r.error) return { kind: 'error', text: t('backupStateFailed'), title: r.error };
  if (r.pruneSkipped) return { kind: 'error', text: t('backupStateGuarded'), title: pruneSkipTip(r) };
  const ts = fmtBackupTime(r.at, { today: t('timeToday'), yesterday: t('timeYesterday') });
  let tip = `${t('backupLastLabel')} ${fmtTime(r.at)}`;
  if (r.written) tip += `（+${r.written}${t('backupItemsUnit')}）`;
  else if (r.fileCount) tip += `（${r.fileCount}${t('backupItemsUnit')}）`;
  return { kind: 'done', text: t('backupStateDone'), time: ts, title: tip };
}

// DB とメディアの整合性のモデル（#301）＝バックアップの設定から独立している（起動時の
// 検査はバックアップの `dir` が設定されていなくても走る）ので、deriveModel とは別に導き、
// 報せることがある限りそちらより優先する（既に pruneSkipped の警告が素の 'done' の状態に
// 対して持っているのと同じ優先順）。null は「何もおかしくない」（またはまだ一度も検査して
// いない）。
function deriveIntegrityModel(integrity: any): BackupModel {
  if (!integrity) return null;
  if (integrity.dbOk === false) return { kind: 'error', text: t('backupStateDbCorrupt'), title: t('integrityDbBad') };
  if (integrity.orphanCount > 0) return { kind: 'error', text: t('backupStateOrphanFound'), title: t('backupStateOrphanTip', [integrity.orphanCount]) };
  return null;
}

export function BackupStatus() {
  // cfgRef と syncingRef は、表示側の旧クロージャの変数（cfg / mirrorSyncing）を 1:1 で
  // 写したもの＝設定のオブジェクトはその場で書き換えられる（cfg.lastResult = r）ので、
  // ストアのキーではなく ref が忠実な置き場になる。tick() は、旧 updateMirrorStatus() の
  // 押し込みが起こしていた描画のやり直しを、代わりに起こす。
  const cfgRef = useRef<any>(null);
  const syncingRef = useRef(false);
  const integrityRef = useRef<any>(null);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        cfgRef.current = await getBackup();
      } catch {
        cfgRef.current = null;
      }
      try {
        integrityRef.current = await getIntegrityStatus();
      } catch {
        integrityRef.current = null;
      }
      if (alive) tick();
    };
    load();
    onIntegrityCheckDone((status: any) => {
      integrityRef.current = status;
      if (alive) tick();
    });
    // 実行が始まった: 回るしるしを出す。先に cfg を引いておくことで、セッションの途中で
    // 設定したバックアップでもレールが点く（起動時には cfg が null だったかもしれない）。
    // onBackupStart/Done はアプリの一生に1回だけ登録する（他の App の階層の IPC の effect
    // と同じく、購読を外さない）＝単一ページのこのアプリで、このコンポーネントが実際に
    // 外れることはない。
    onBackupStart(async () => {
      syncingRef.current = true;
      if (!cfgRef.current || !cfgRef.current.dir) {
        try {
          cfgRef.current = await getBackup();
        } catch {
          /* 無視する */
        }
      }
      if (alive) tick();
    });
    // 実行が終わった: 新しい結果を持ち越す（実行が始まった時点で空だったなら cfg も引く）
    // ことで、手で更新しなくてもレールが正しくなる。
    onBackupDone(async (r: any) => {
      syncingRef.current = false;
      if (!cfgRef.current) {
        try {
          cfgRef.current = await getBackup();
        } catch {
          /* 無視する */
        }
      }
      if (cfgRef.current && r) cfgRef.current.lastResult = r;
      if (alive) tick();
    });
    // 設定のダイアログが閉じたら更新する＝Data.tsx のコンポーネントがバックアップの
    // フォルダを変えたかもしれないから。ここではコンポーネントの境界を越えてサイドバーの
    // DOM へ手を伸ばす（#153 の分類4）のではなく、services/settings.ts 自身の開閉のストア
    // （settings/index.tsx が Dialog をつないでいるのと同じもの）を読む＝設定の歯車の
    // id や要素は、このモジュールへ一切入ってこない。
    let settingsWasOpen = settingsIsOpen();
    const unsubSettings = settingsSubscribe(() => {
      const nowOpen = settingsIsOpen();
      if (settingsWasOpen && !nowOpen) load();
      settingsWasOpen = nowOpen;
    });
    return () => {
      alive = false;
      unsubSettings();
    };
  }, []);

  // 孤立や DB の整合性の警告は、ふだんのバックアップの状態に勝つ（バックアップの `dir` が
  // 設定されていなくても出る＝起動時の検査はバックアップの設定と関係なく走る）。
  const m = deriveIntegrityModel(integrityRef.current) || deriveModel(cfgRef.current, syncingRef.current);
  if (!m) return null;
  // 完全な状態（と、実行済みなら「完了」が持つ2行目）はツールチップに入れる。サイドバーが
  // 今持つ形はレールだけだから（#981）。
  const full = [m.text, m.time, m.title].filter(Boolean).join(' — ');
  return (
    // #678 はこれをレールでは隠し、展開した列で見せていた。レールの守備範囲は決まった
    // 行き先であり、状態の表示は行き先ではなく漂う状態だから。#981 が列を取り除いたので、
    // その規則のままだとこれは永久に見えなくなり、DB の整合性・孤立の警告の唯一の画面まで
    // 道連れになっていた。代わりにレールへ、アイコンとして出す。これは #678 の、ラベルの
    // 無いレールのアイコンの禁止を蒸し返すものではない。あの禁止が言っているのは行き先の
    // ことで、行き先は字形から名前を言い当てられないし、押されることを前提にしている。
    // こちらは行く先を持たない状態の灯りで、その言葉はホバー1つ先にある。デスクトップの
    // アプリは、漂う同期の状態をまさにここへ置く＝常に見えている小さな標識と、ホバーで
    // 出る詳細（VS Code や Obsidian の状態のバー、OneDrive や Dropbox のトレイのアイコン）。
    // role="img" にしているのは、素の <span> が role=generic で、支援技術に渡す名前を
    // 一切支えないから＝下の aria-label が捨てられていた。ここでは字形こそが中身なので
    // （バックアップが何をしているかを言っている）、これは代替テキストを持つ画像そのもの
    // であり、その代替テキストはホバーで title が見せるのと同じ文字列。
    <span data-slot="backup-status" role="img" title={full} aria-label={full} className={`mx-auto inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] ${TONE[m.kind]}`}>
      {m.kind === 'done' ? <IconDone /> : m.kind === 'syncing' ? <IconSync /> : <IconWarn />}
    </span>
  );
}

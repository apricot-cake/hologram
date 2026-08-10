// ZIP からライブラリをインポートする――両方のアーカイブ形式（完全な
// エクスポート #485 と、旧形式の metadata.json + images/ の #322）に共通の
// フロー全体。
//
// main はどちらの場合もピッカーを動かしアーカイブを読む。レンダラーが
// 得るのは結果だけで、旧形式のときだけアーカイブのパスも受け取る。これは
// #34 の重複の答えが揃ったら main にインポートの仕上げを頼めるように。
// 生のバイト列も展開後のレコードも、ここを横切ることは一切無い。
//
// これを呼ぶ入り口は2つ: 設定パネルのインポートボタン
// （settings/sections/Data.tsx）と、初回起動時の空状態の CTA
// （empty/EmptyState.tsx）。以前はそれぞれが自分専用のコピーを持って
// いた――Data.tsx はインラインで、EmptyState.tsx は orchestrator の
// `export let` を通して――それが2つのずれを生んでいた（一方は報告前に
// ライブラリの再読み込みを待っていたが、もう一方は待っていなかった）。
// clipboard-intake.ts / drop-intake.ts と同じ分割: ボタンはコンポーネントが
// 持ち、このモジュールはそれが行う IPC 呼び出しの隣でフローを持つ。
import { importComplete, importLegacyZip } from './posts.ts';
import { open as confirmOpen } from './confirm.ts';
import { loadPosts } from './post-grid-builder.ts';
import { notify } from './ui.ts';
import { t } from '../_shared/i18n.ts';

async function reportDone(imported: number, skipped: number): Promise<void> {
  if (loadPosts) await loadPosts();
  if (skipped > 0) notify(t('importSkipped', [imported, skipped]));
  else notify(t('imported', [imported]));
}

async function runLegacy(zipPath: string): Promise<void> {
  // #34: インポートする投稿がすでにライブラリにあるとき、コピー／置換／
  // スキップを一度だけ尋ねる（項目ごとに尋ねると数百のプロンプトになって
  // しまうので、まとめている）。重複が無ければ main は即座にインポートし、
  // これは一切現れない。
  const first = await importLegacyZip(zipPath);
  if (!first || first.error) {
    notify(t('importFailed'));
    return;
  }
  if (!first.needsChoice) {
    await reportDone(first.imported, first.skipped);
    return;
  }
  const finish = async (mode: string) => {
    const r = await importLegacyZip(zipPath, mode);
    await reportDone(r.imported, r.skipped);
  };
  confirmOpen({
    message: t('importDuplicate', [first.duplicates]),
    description: t('importDuplicateDesc'),
    okLabel: t('importDuplicateReplace'),
    altLabel: t('importDuplicateCopy'),
    cancelLabel: t('importDuplicateSkip'),
    onOk: () => void finish('replace'),
    onAlt: () => void finish('copy'),
    // Esc もここに着地し、スキップが最も変化の少ない答え――ライブラリは
    // 今持っているものをそのまま保つ。
    onCancel: () => void finish('skip'),
  });
}

export async function runZipImport(): Promise<void> {
  try {
    const res = await importComplete();
    if (res && res.canceled) return;
    notify(t('importing'));
    if (res && res.legacy && res.path) {
      // 一度だけ束縛する: runLegacy の中のコールバックは res.path の絞り込みより長生きする。
      await runLegacy(res.path);
      return;
    }
    if (!res || !res.ok) {
      if (loadPosts) await loadPosts();
      notify(t('importFailed'));
      return;
    }
    // ok で答えた完全なインポートは常に両方のカウンタを運ぶ。フォールバック
    // は、平坦な結果の形（ipc-payloads.ts）が強いているだけのもの。
    await reportDone(res.imported ?? 0, res.skipped ?? 0);
  } catch {
    notify(t('importFailed'));
  }
}

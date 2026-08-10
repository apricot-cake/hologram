'use strict';

// #1009: このアプリが依存するディレクトリ（configDir、実効的な保存フォルダ）が、
// このプロセスが解決したはずの場所へ着地するのではなく、OS レベルのストレージ
// 仮想化によって黙ってリダイレクトされていないかを検出する。
//
// これが存在する理由: #1003 は（2026-08-06 に）今のこの環境では MSIX の
// ストレージ仮想化が「起きていない」ことを確認した——だがそれが真だったのは、
// ホストプロセス（Claude Code）がたまたまそのパッケージの外へ移動していた
// からであって、仕組み自体が無くなったからではない。paths.mts のヘッダーは、
// なぜ Windows の configDir が今も原則として %APPDATA% を避けるのかを説明
// している: 2026-06-23 のインシデント（約9082件の保存済みアイテムが、誰も
// 見ていないパッケージ単位の LocalCache へ分岐していた）は、「保存したはずなのに
// ライブラリに無い」としてしか表に出なかった——クラッシュではなく静かな
// 失敗モード。#232 は configDir を %APPDATA% へ戻したがっていて、それは
// 仮想化の守備範囲へ再び入ることを意味する。この番人は #232 がブロックされて
// いるまさにその対象。
//
// 検出手法は #1003 自身の計測手法を、製品コードへ昇格させたもの: 使い捨ての
// プローブファイルを書き、fs.realpathSync.native（内部は Windows の
// GetFinalPathNameByHandle で、リダイレクト後の実際の対象を報告する）経由で
// OS にその「実パス」を尋ねる。同じプロセスを通してプローブを読み返しても
// 何も証明しない——プロセス自身の見え方こそが、仮想化がすり替えるものその
// もので、常に自分自身とは一致してしまう。同じ理由でさらに2つの代替案が
// 却下された（#1009 の「却下案」）:
//   - GetCurrentPackageFullName（ネイティブアドオンが必要）: パッケージの
//     素性と「このディレクトリがリダイレクトされているか」は別の問い——
//     パッケージ化されたアプリでも、仮想化されていないディレクトリを持ち
//     うる。
//   - %APPDATA% の文字列を調べる: 仮想化によって変わらない値であり、それは
//     まさにこの番人が捕まえようとしている「静かな失敗」という性質そのもの。

import fs from 'node:fs';
import path from 'node:path';

export type RedirectCheck = { status: 'ok' } | { status: 'redirected'; realPath: string } | { status: 'check-failed'; error: string };

/**
 * realpath の「文字列」だけに対する純粋な分類器——#1009 の受け入れテストが
 * 動かす唯一の入力（「realpath の戻り値を差し替えたユニットテストで...検出が
 * 発火する」）: ユニットテストは fs.realpathSync.native が返すはずの値を偽装し、
 * これが発火することを検証する。ファイルシステムも Electron も一切関わらない。
 *
 * `\Packages\<pkg>\LocalCache\` は MSIX のパッケージ単位の仮想ストア配置——
 * 2026-06-23 の分岐が実際に取った、具体的な形そのもの（paths.mts のヘッダー
 * 参照）——なので、両方のセグメントが存在しなければならない。単に「Packages」や
 * 「LocalCache」という語を含むだけのパス（文字どおりそう名付けられたフォルダ、
 * バックアップドライブ下のコピー）はこの失敗モードではなく、誤検出してはならない。
 */
export function classifyRealPath(realPath: string): 'ok' | 'redirected' {
  return /\\Packages\\[^\\]+\\LocalCache\\/i.test(realPath) ? 'redirected' : 'ok';
}

export interface RedirectCheckDeps {
  mkdirSync?: (dir: string) => void;
  writeFileSync?: (file: string, data: string) => void;
  unlinkSync?: (file: string) => void;
  realpathNative?: (file: string) => string;
}

export interface RedirectCheckOptions {
  /**
   * プローブの前に `dir` を mkdir する（再帰的に）。**既定では無効で、その既定値には
   * 意味がある**——下の警告参照。有効にしてよいのは、このアプリが所有し作成して
   * よいディレクトリ、つまり configDir だけ。
   */
  ensureDir?: boolean;
  /** 注入するファイルシステム呼び出し——テスト専用。 */
  deps?: RedirectCheckDeps;
}

/**
 * `dir` へ使い捨てのプローブを書き、その実パスを解決し、削除して、結果を
 * 分類する。
 *
 * ⚠️ **利用者の保存フォルダに対しては `ensureDir` を絶対に渡さないこと。**
 * 保存フォルダが無いことは不便ではなく「信号」: #37 の検出は「フォルダが
 * 消えた」を、ドライブが抜かれた、あるいは同期フォルダが消えたと読み、その
 * 強さで clear-all・移動・バックアップを拒む。ここでそれを作成すると、その
 * 信号を消してしまう——2026-08-07 に計測済み。この番人の最初のバージョンは
 * 両方のディレクトリに mkdir をかけ、test-app-library-missing.cts の5つの
 * チェックすべてを「緑だが間違い」（`existsSync(missingFolder)=true`）に
 * してしまった。configDir は違う: このアプリがそれを所有し、新規インストールは
 * まだそれを作っておらず、初回起動で動けない番人は番人ではない。
 *
 * 途中の失敗——mkdir、書き込み、あるいは realpath 自体が例外を投げる
 * （ディレクトリが無い、権限が無い、閉じたサンドボックス）——はすべて
 * 'redirected' ではなく 'check-failed' に解決される。#1009 の3番目の受け入れ
 * 基準: 実行できなかったチェックを、実行して問題を見つけたチェックと同じ扱いに
 * してはいけない。だから本当に消えている保存フォルダは、ここでは
 * 'check-failed' に落ち着き、報告は #37 自身の検出に任せる。掃除（unlink）は
 * ベストエフォートで、完了したチェックを失敗に変えることは無い——プローブ
 * ファイルの残骸は無害。
 */
export function checkForRedirect(dir: string, options: RedirectCheckOptions = {}): RedirectCheck {
  const deps = options.deps ?? {};
  const mkdirSync = deps.mkdirSync ?? ((d: string) => fs.mkdirSync(d, { recursive: true }));
  const writeFileSync = deps.writeFileSync ?? ((f: string, data: string) => fs.writeFileSync(f, data));
  const unlinkSync = deps.unlinkSync ?? ((f: string) => fs.unlinkSync(f));
  const realpathNative = deps.realpathNative ?? ((f: string) => fs.realpathSync.native(f));

  const probePath = path.join(dir, `.hologram-realpath-probe-${process.pid}-${Date.now()}`);
  try {
    if (options.ensureDir) mkdirSync(dir);
    writeFileSync(probePath, '');
  } catch (err) {
    return { status: 'check-failed', error: (err as Error).message };
  }
  try {
    const real = realpathNative(probePath);
    return classifyRealPath(real) === 'redirected' ? { status: 'redirected', realPath: real } : { status: 'ok' };
  } catch (err) {
    return { status: 'check-failed', error: (err as Error).message };
  } finally {
    try {
      unlinkSync(probePath);
    } catch {
      /* 掃除はベストエフォート——プローブファイルの残骸は何も変えない */
    }
  }
}

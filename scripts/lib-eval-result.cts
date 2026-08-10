'use strict';
// app-harness の「EVAL_RESULT」通信形式の共有デコーダ: test-app-* のハーネス
// は HOLOGRAM_SMOKE_EVAL に JS の式の文字列を設定して実際の Electron プロ
// セスを spawn し、アプリはその結果を JSON.stringify して
// `EVAL_RESULT "<escaped>"` としてログに出す（二重エンコードすることで、
// ペイロード内の改行/引用符がログの1行を生き延びる）。これはそれを読み
// 戻す。プロセスが一致する行を一度も出力しなかった場合、あるいはペイロード
// が有効な JSON でなかった場合（ハーネスが例外を投げたか固まった）は null
// を返す — 呼び出し側は null の結果のフィールドにアクセスして落ちるのでは
// なく、それを失敗した実行として報告する。
function readEvalResult(out: string): Record<string, any> | null {
  const m = /EVAL_RESULT "(.+?)"\s*$/m.exec(out);
  let r: Record<string, any> | null = null;
  try {
    r = JSON.parse(JSON.parse('"' + (m ? m[1] : '') + '"'));
  } catch {
    /* 下の null 報告へフォールスルー */
  }
  return r;
}

module.exports = { readEvalResult };

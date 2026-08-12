// 停止の取り決め（app/src/main/restart-signal.ts）の単体テスト。restart-app.ps1 は
// もう、機械の electron.exe の一覧から実機を選び出さない。--hologram-quit を積んだ
// 使い捨てのコピーを起動し、それが単一インスタンスの錠を取り損ねて、錠を持っている側
// ＝この設定ディレクトリの唯一のインスタンスへ自分の argv を渡す。純ロジックなので
// Electron は要らない。端から端までの挙動（動いているアプリが本当に終了するか）は、
// docs/ビルド.md に従って restart-app.ps1 を実行して確かめる。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { EXIT_NO_INSTANCE, EXIT_SIGNALLED, QUIT_FLAG, hasQuitSignal } from '../app/src/main/restart-signal';

describe('終了の合図の検出', () => {
  test('実機の起動 argv には合図が無い', () => {
    expect(hasQuitSignal(['C:\\electron.exe', 'C:\\repo\\app', '--remote-debugging-port=9222'])).toBe(false);
  });

  test('合図つきの起動を検出する', () => {
    expect(hasQuitSignal(['C:\\electron.exe', 'C:\\repo\\app', QUIT_FLAG])).toBe(true);
  });

  test('空の argv は合図なし', () => {
    expect(hasQuitSignal([])).toBe(false);
  });

  // startsWith ではなく完全一致で見る。これは動いているアプリが自分を落とすかどうかを
  // 決めるので、頭が同じだけの長いフラグで発火してはいけない。
  test('似た名前のフラグは合図ではない', () => {
    expect(hasQuitSignal(['--hologram-quit-later'])).toBe(false);
    expect(hasQuitSignal(['--hologram-quiet'])).toBe(false);
  });
});

describe('restart-app.ps1 が読む終了コード', () => {
  // restart-app.ps1 はこの数値をベタ書きしている。プロセスの境界の向こう側にある
  // PowerShell スクリプトなので import できない。ここで値を固定しておくことが、
  // 「誰かがコードを振り直した」を赤いテストに変える。そうしないと、古いアプリが
  // 立ったまま新しいアプリを黙って起動する再起動になる。
  test('値が固定されている', () => {
    expect(EXIT_NO_INSTANCE).toBe(0);
    expect(EXIT_SIGNALLED).toBe(3);
  });

  test('2つの結果は区別できる', () => {
    expect(EXIT_NO_INSTANCE).not.toBe(EXIT_SIGNALLED);
  });
});

// 契約のもう半分。test-app-restart-signal.cts は、本物の Electron に対してアプリ側が
// 自分の役目を果たすことを示す。ただしあちらは restart-app.ps1 を読まないので、
// スクリプトが分岐に使う数値と食い違っても、どのテストも緑のまま、再起動が古い
// インスタンスの上に新しいインスタンスを静かに立ててしまう。ここのアサーションを
// 静的にしてあるのは意図してのこと＝スクリプトは Windows 専用の PowerShell で、
// ci.yml は Linux。
describe('scripts/restart-app.ps1 との取り決め', () => {
  const file = path.join(__dirname, 'restart-app.ps1');
  const bytes = fs.readFileSync(file);
  const source = bytes.toString('utf8');

  // 2026-08-07 に実測: このファイルを BOM 無しで保存すると、中の日本語文字列が
  // powershell.exe では全部解釈に失敗した（Windows PowerShell 5.1 は BOM が無ければ
  // .ps1 を ANSI として読む）。そして docs/ビルド.md とスキル run-hologram が起動に
  // 使えと言っているのがその 5.1 だ。失敗は全面的で、スクリプトがまったく動かない。
  // しかもエディタやエージェントがファイルを書き直すと、BOM は黙って落ちる。
  test('UTF-8 BOM 付きで保存されている', () => {
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  test('終了の合図として QUIT_FLAG を渡している', () => {
    expect(source).toContain(QUIT_FLAG);
  });

  test('「誰も居ない」の終了コードで停止ループを抜けている', () => {
    expect(source).toMatch(new RegExp(`ExitCode -eq ${EXIT_NO_INSTANCE}\\b`));
  });

  test('「居た」以外の終了コードを異常として扱っている', () => {
    expect(source).toMatch(new RegExp(`ExitCode -ne ${EXIT_SIGNALLED}\\b`));
  });

  // docs/ビルド.md の「CDP で繋ぐ先の選び方」の表が、実機の :9222 を固定と定めている。
  // scripts/cdp-verify.cts の既定値もそれ。このポートを開けるのはこのスクリプトだけ。
  test('実機の HMR 起動へ CDP ポート 9222 を渡す', () => {
    expect(source).toMatch(/\$port\s*=\s*9222/);
    expect(source).toContain('$env:REMOTE_DEBUGGING_PORT = "$port"');
  });
});

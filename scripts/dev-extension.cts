'use strict';

// `npm run dev:ext` —「専用の」Chrome プロファイル向けの WXT 開発サーバー
// （#732）。
//
// 開発ビルドは日常使いのブラウザには一切近づかない。作業ツリーの外にある
// 固定フォルダ1つ（~/.hologram-dev/chrome-mv3-dev）へ書かれるので、開発
// プロファイルは一度手で読み込めば、セッションがどの worktree にいようと
// 動き続ける。常駐するものは何も無い: ログオンタスクも無ければサービスも
// 無い — サーバーは自分が動いているコンソールと同じだけ生き、それ以上は
// 1秒も長生きしない。
//
// マシン上で「最初の1回」だけ、開発プロファイルの中で:
//   1. chrome://extensions → デベロッパーモード ON
//   2. 「パッケージ化されていない拡張機能を読み込む」→ 下に出力されるフォルダ
//   3. node scripts/register-dev-native-host.cts （保存先を隔離する）
//
// 拡張機能の id はリリースビルドと同じ（署名鍵が固定されているため）なので、
// 両方を「同じ」プロファイルに読み込まないこと — そのために別プロファイルが
// ある。

const { execFileSync, spawn } = require('node:child_process');
const { homedir } = require('node:os');
const path = require('node:path');
const { DEV_SERVER_PORT, devServerAlive } = require('./lib-dev-server.cts');

const ROOT = path.join(__dirname, '..');
const output = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || path.join(homedir(), '.hologram-dev', 'chrome-mv3-dev');

// ターミナルなしで起動された場合（エージェントのセッション、タスクランナー）、
// サーバーはその出力が誰も見ない場所へ流れたまま動いてしまう: ログはセッションが
// 選んだ使い捨てファイルに落ち、外からはサーバーが上がっていることを示すもの
// すら無い。誰にも見えないサーバーは、二重に起動されるか、何日も動かしっぱなし
// にされるサーバーになる。そこで本物のコンソールウィンドウを開き、サーバーを
// そこへ渡す。ターミナルから起動された場合（人がこれをタイプした場合）は何も
// デタッチしない: サーバーはその人の目の前で動き、それが Ctrl+C と WXT の
// キーバインドを効かせる。
//
// このウィンドウ自身がステータス表示: サーバーが上がっている間だけ、Node の
// アイコンの下にタスクバーへ乗り続けるので、「dev サーバーは動いているか」は
// プロセスを探すのではなく、見るだけで答えが出る。だからこのウィンドウは
// cmd のラッパーではなく node のものであり、サーバーが終わった後も開いたまま
// にはしない。
const detach = process.platform === 'win32' && !process.stdout.isTTY && !process.env.CI && !process.env.HOLOGRAM_DEV_EXT_WINDOW;

async function main() {
  // すでに上がっている? それなら誰が呼んだにせよ、この呼び出しはそれで終わり。
  // dev サーバーは1つですべての worktree に応える（出力フォルダもポートも
  // どちらも固定）ので、2回目の起動は呼び出し元が望んだものであることは
  // 決してない — ポートで死ぬか、もっと悪ければ、呼び出し元が何かを起動した
  // と思い込んだまま死ぬウィンドウを得るかのどちらか。
  //
  // 誰かが覚えておかなければならない手順ではなく、ここで確認する: タスクバー
  // は人間に対して「動いているか」に答えるが、エージェントにはタスクバーが
  // 見えないし、チェックリストに書かれた規則はそれが読まれている間しか効か
  // ない。これは open-dev-profile.cts がブラウザウィンドウに対して使うのと
  // 同じ形（#857）。
  if (await devServerAlive()) {
    console.log(`[hologram] dev サーバーはすでに localhost:${DEV_SERVER_PORT} で上がっている — そのままにする。`);
    console.log('[hologram] サーバーは1つですべての worktree に応える。止めるにはそのコンソールウィンドウを閉じること。');
    return;
  }

  console.log(`[hologram] 開発ビルドのフォルダ: ${output}`);
  console.log('[hologram] 開発用 Chrome プロファイルで「その」フォルダをパッケージ化されていない拡張機能として読み込むこと（一度だけ）。');

  if (detach) {
    // `start` が新しいコンソールを作る。その直後の引用符付き引数はウィンドウの
    // 「タイトル」（cmd 自身の癖 — 引用符無しの最初の引数はコマンドとして
    // 読まれてしまう）。配列ではなくシェルを通した1本のコマンド文字列にして
    // ある: Node は子プロセス向けに配列引数をエスケープするので、タイトルを
    // 囲む引用符がエスケープされたまま出てしまい、ウィンドウのタイトルが
    // \Hologram dev:ext\ になってしまう（2026-08-04 に実測）。
    //
    // `cmd /k npm run dev:ext` ではなく直接 `node` を使う。その違いがタスク
    // バーの表示を決める:
    //   - ウィンドウの所有者はこのスクリプト自身の node プロセスなので、
    //     タスクバーのボタンは cmd ではなく Node のアイコンを持つ — この
    //     マシン上の他のコンソールウィンドウと一目で見分けられる。
    //   - サーバーより長生きするものが無い。`cmd /k` のラッパーだと、
    //     サーバーが死んだ後もプロンプトに座り続け、タスクバーには消えた
    //     サーバーについて「実行中」と言うウィンドウが残ってしまう。それでも
    //     失敗はちゃんと読める: 下の実行はウィンドウが閉じる前に、0 以外の
    //     終了コードで一時停止する。
    // （タイトルはどちらにせよ wxt が起動するまでしか保たない — cmd と npm
    // は今実行中のものにコンソールタイトルを書き換える。ウィンドウを見分ける
    // には npm の `hologram-extension@<version>` ヘッダー、.hologram-dev の
    // 出力パス、あるいはポート番号を使う: docs/ビルド.md。）
    const child = spawn('start "Hologram dev:ext" node scripts/dev-extension.cts', {
      cwd: ROOT,
      shell: true,
      detached: true,
      stdio: 'ignore',
      // 再入時に「これはステータスウィンドウを持つ側」だと印を付ける。これが
      // 下の一時停止を有効にする。デタッチのループも不可能にするが、それは
      // 今持っているコンソール自体がすでに防いでいる。
      env: Object.assign({}, process.env, { HOLOGRAM_DEV_EXT_WINDOW: '1' }),
    });
    child.unref();
    console.log('[hologram] コンソールウィンドウを開いた — サーバーは「そこ」で動く。タスクバーでは Node の下に出る。');
    console.log('[hologram] このウィンドウはサーバーが動いている間だけ開いている: 閉じれば止まり、閉じたということは止まったということ。');
  } else {
    try {
      // Windows: シェル無しで spawn した npm.cmd は EINVAL になる（skill windows-scripting）。
      execFileSync('npm --prefix extension run dev', {
        cwd: ROOT,
        shell: true,
        stdio: 'inherit',
        env: Object.assign({}, process.env, { HOLOGRAM_EXTENSION_DEV_OUTPUT: output }),
      });
    } catch (error) {
      // ステータスウィンドウの中では、0以外の終了コードはそのままだと理由を
      // 道連れにしてしまう: ポートの衝突、ビルドエラー、インストール漏れは
      // どれも表示された後、ウィンドウが閉じると同時に消える。読まれるまで
      // ウィンドウを保持する — ただし失敗した時「だけ」。そうすれば意図して
      // 止めたサーバーは、それでもタスクバーから自分自身をきちんと消せる。
      //
      // Ctrl+C は失敗ではない: Windows はそれを独自の終了ステータス
      // （STATUS_CONTROL_C_EXIT）として報告し、手でサーバーを止めた場合は、
      // ウィンドウを閉じた時と同じようにウィンドウが閉じるべき。
      const CONTROL_C_EXIT = 3221225786; // 0xC000013A
      if (process.env.HOLOGRAM_DEV_EXT_WINDOW && error.status !== CONTROL_C_EXIT && error.signal !== 'SIGINT') {
        console.error('\n[hologram] dev サーバーが終了した。上の理由が読めるようウィンドウは開いたままにする。');
        try {
          execFileSync('cmd', ['/c', 'pause'], { stdio: 'inherit' });
        } catch {
          // pause にはコンソールが要る。無ければどのみち保持するものが無い。
        }
      }
      process.exitCode = typeof error.status === 'number' ? error.status : 1;
    }
  }
}

main();

'use strict';
const fs = require('node:fs');
const { developmentOptions, startDevelopmentBrowser, waitForInterrupt } = require('./lib-dev-browser.cts');
const { developmentChromeStatus } = require('./lib-chrome-command-line.cts');

async function main(dependencies: any = {}): Promise<void> {
  const options = (dependencies.options || developmentOptions)();
  if (process.argv.includes('--print')) {
    const status = (dependencies.status || developmentChromeStatus)(options.profile);
    const cdp =
      status.transport === 'stopped'
        ? '停止中（次回起動の設定: 管理された pipe、TCP 公開なし）'
        : status.transport === 'tcp'
          ? `警告: TCP 公開用の起動引数を検出（port=${status.port ?? '未指定'}, address=${status.address ?? '未指定'}）。待受状態は未確認`
          : status.transport === 'pipe'
            ? 'pipe 起動（TCP 公開指定なし。所有者への接続は未確認）'
            : '外部起動・未管理（CDP の起動引数なし）';
    console.log(
      `chrome: ${options.executablePath}\nプロファイル: ${options.profile}\nChrome プロファイル: ${status.pid === null ? '次回起動の設定: Default' : status.profileDirectory}\n起動中: ${status.pid === null ? 'いいえ' : `はい（pid ${status.pid}）`}\nCDP（実際の起動引数による判定）: ${cdp}\n共有リリースビルド: ${options.output}`,
    );
    return;
  }
  const session = await (dependencies.start || startDevelopmentBrowser)(options);
  try {
    if (fs.existsSync(`${options.output}/manifest.json`)) {
      const configured = await session.configure(options.output);
      console.log(`[hologram] 共有リリースビルドを読み込み直しました: ${configured.path}`);
      if (process.argv.includes('--marker')) await session.marker();
    } else throw new Error(`共有リリースビルドがありません。先に npm run ext:deploy を実行してください: ${options.output}`);
    console.log('[hologram] 開発用 Chrome: 既存 Default、管理された pipe、Native Host: com.hologram.host.dev');
    if (process.argv.includes('--keep-open')) {
      console.log('[hologram] 開発用 Chrome を保持しています。Ctrl+C で通常終了します');
      await waitForInterrupt();
    }
  } finally {
    await session.release();
  }
}
module.exports = { main };
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

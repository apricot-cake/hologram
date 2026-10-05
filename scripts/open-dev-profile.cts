'use strict';
const fs = require('node:fs');
const { developmentOptions, startDevelopmentBrowser, waitForInterrupt } = require('./lib-dev-browser.cts');
const { runningChromePid } = require('./lib-chrome-command-line.cts');

async function main(dependencies: any = {}): Promise<void> {
  const options = (dependencies.options || developmentOptions)();
  if (process.argv.includes('--print')) {
    const pid = (dependencies.runningPid || runningChromePid)(options.profile);
    console.log(`chrome: ${options.executablePath}\nプロファイル: ${options.profile}\nChrome プロファイル: Default\n起動中: ${pid === null ? 'いいえ' : `はい（pid ${pid}）`}\nCDP: 管理された pipe（TCP 公開なし）\n共有リリースビルド: ${options.output}`);
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

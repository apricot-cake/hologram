const path = require('node:path');
const { parsePostUrl } = require('../extension/utils/extractor/index.ts');
const { developmentOptions, startDevelopmentBrowser } = require('./lib-dev-browser.cts');

function parseCollectionArgs(args: string[]) {
  const urls: string[] = [];
  let maxPosts = 20;
  let seconds = 120;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[++i];
    if (flag === '--url') {
      if (!value || value.length > 2048) throw new Error('対応サイトの投稿URLが必要です');
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !['x', 'bluesky', 'pixiv'].includes(parsePostUrl(value)?.platform)) throw new Error('X・Bluesky・Pixiv の HTTPS 投稿URLを指定してください');
      urls.push(value);
    } else if (flag === '--max-posts') {
      maxPosts = Number(value);
    } else if (flag === '--seconds') {
      seconds = Number(value);
    } else throw new Error('指定できる引数は --url、--max-posts、--seconds です');
  }
  if (!Number.isInteger(maxPosts) || maxPosts < 1 || maxPosts > 20 || !Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new Error('投稿数は1〜20、秒数は1〜300です');
  const unique = [...new Set(urls)];
  if (!unique.length || unique.length > maxPosts) throw new Error('指定投稿数が上限内になるよう --url を指定してください');
  return { urls: unique, seconds };
}

async function main(args: string[]) {
  const options = parseCollectionArgs(args);
  const browserOptions = developmentOptions();
  const browser = await startDevelopmentBrowser(browserOptions);
  try {
    await browser.configure(browserOptions.output);
    const summary = await browser.run(path.join(__dirname, 'api-response-probe.cts'), [JSON.stringify(options)], (options.seconds + 30) * 1000);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser.release();
  }
}

module.exports = { parseCollectionArgs, main };
if (require.main === module)
  main(process.argv.slice(2)).catch(() => {
    console.error('API応答の収集に失敗しました。引数・開発用Chromeの管理状態・収集先を確認してください。');
    process.exitCode = 1;
  });

'use strict';
const { developmentOptions, startDevelopmentBrowser } = require('./lib-dev-browser.cts');
async function main(): Promise<void> {
  const modulePath = process.argv[2];
  if (!modulePath) throw new Error('run({ context, browser, args }) を export する診断モジュールを指定してください');
  const options = developmentOptions();
  const session = await startDevelopmentBrowser(options);
  try {
    await session.configure(options.output);
    const result = await session.run(modulePath, process.argv.slice(3));
    if (result !== undefined) console.log(JSON.stringify(result, null, 2));
  } finally {
    await session.release();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

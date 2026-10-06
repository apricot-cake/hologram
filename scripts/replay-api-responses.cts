const { fetchPostMetadata } = require('../extension/utils/extractor/index.ts');
const { readSession, replayCapture } = require('./lib-api-response-capture.cts');

async function main(args: string[]) {
  if (args.length !== 2 || args[0] !== '--session') throw new Error('--session UUID を指定してください');
  const result = await replayCapture(readSession(args[1]), fetchPostMetadata);
  console.log(JSON.stringify(result, null, 2));
  if (result.unmatchedRequests || result.limited) process.exitCode = 2;
}
module.exports = { main };
if (require.main === module)
  main(process.argv.slice(2)).catch(() => {
    console.error('応答の再検証に失敗しました。セッションIDと応答ファイルを確認してください。');
    process.exitCode = 1;
  });

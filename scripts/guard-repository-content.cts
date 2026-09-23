'use strict';

// 実ライブラリや UI 検証の成果物は、公開リポジトリに入れてはいけない。
// ローカルの pre-commit と CI の両方から呼び、追加された危険なパスとメディアを
// 拒否する。製品アイコンとコミット済みの visual baseline だけは明示的に許可する。

const cp = require('node:child_process');

const MEDIA = /\.(?:png|jpe?g|gif|webp|avif|heic|mp4|m4v|webm|mov|mkv|avi|mp3|wav|flac|ogg|opus|zip|7z|rar|tar|gz|sqlite|db)$/i;
const FORBIDDEN_PATH = /(?:^|\/)(?:tmp|verification|captures?|screenshots?|recordings?|artifacts?|playwright-report|test-results|\.sandbox|\.local-app|\.probe66)(?:\/|$)|(?:^|\/)[^/]+\.library(?:\/|$)|(?:^|\/)(?:hologram\.db(?:-(?:wal|shm))?|capture\.log)$/i;
const ALLOWED_MEDIA = [/^app\/assets\/icon\.png$/, /^assets\/icon(?:-master)?\.png$/, /^extension\/public\/icons\/icon(?:16|32|48|128)\.png$/, /^e2e\/visual\/[^/]+\.spec\.ts-snapshots\/[^/]+\.png$/];

function normalize(file: string): string {
  return file.replaceAll('\\', '/');
}

function violationFor(file: string): string | null {
  const normalized = normalize(file);
  if (FORBIDDEN_PATH.test(normalized)) return '検証成果物またはライブラリのパスです';
  if (MEDIA.test(normalized) && !ALLOWED_MEDIA.some((pattern) => pattern.test(normalized))) return '許可されていないメディアまたはライブラリ形式です';
  return null;
}

function git(args: string[]): string {
  return cp.execFileSync('git', args, { encoding: 'utf8' });
}

function changedFiles(args: string[]): string[] {
  return git(args).split(/\r?\n/).filter(Boolean);
}

function main(argv: string[]) {
  let files: string[];
  if (argv[0] === '--staged') files = changedFiles(['diff', '--cached', '--name-only', '--diff-filter=A']);
  else if (argv[0] === '--range' && argv[1] && argv[2]) files = changedFiles(['diff', '--name-only', '--diff-filter=A', argv[1], argv[2]]);
  else if (argv[0] === '--all') files = changedFiles(['ls-files']);
  else throw new Error('使い方: guard-repository-content.cts --staged | --range <base> <head> | --all');

  const violations = files.flatMap((file) => {
    const reason = violationFor(file);
    return reason ? [`${normalize(file)}: ${reason}`] : [];
  });
  if (!violations.length) return;
  console.error('[hologram] 公開リポジトリへ追加できないファイルがあります:');
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error('実ライブラリと UI 検証の成果物は %LOCALAPPDATA%\\Hologram\\verification など、リポジトリ外へ置いてください。');
  process.exitCode = 1;
}

module.exports = { normalize, violationFor };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`[hologram] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

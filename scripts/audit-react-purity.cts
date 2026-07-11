'use strict';
// React実プロダクト化の完了判定（5チェック機械判定）。外部基準＝「実React製品が
// 実際どうなっているか」であって内部の宣言ではない（[[feedback-migration-full-consistency]]・
// メモリ corpus-react-purity-execution-map §0/§1/§2 が仕様の真実源）。
//
// ① window.corpus[A-Z] 系グローバル参照ゼロ（+ キャスト/ブラケット間接アクセスもゼロ）
// ② app/renderer/viewer.ts という名前が不在（＝app/renderer/orchestrator.tsへ改名済み）
// ③ git追跡の .js/.mjs/.cjs が許可リスト（最終7件）と完全一致
// ④ app/renderer/**/*.ts の命令的DOM操作に無注釈の使用がゼロ
// ⑤ Window拡張が corpus（preload橋）のみ
//
// 現時点（波の途中）では①〜⑤の多くがFAILするのが正常。全緑になった時点で
// run-tests.cts の TESTS 配列（'test-typecheck' の直後）へ登録する（本ファイル
// 自体は単体実行専用のまま据え置き＝コメントで明記）。
//
// Run: node scripts/audit-react-purity.cts

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');

function gitLsFiles(): string[] {
  const r = spawnSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('FAIL audit-react-purity: git ls-files failed');
    console.error(r.stderr);
    process.exit(1);
  }
  return r.stdout.split('\n').filter(Boolean);
}

const ALL_FILES = gitLsFiles();

// --- check① scope: app/renderer/*.ts (incl. types/*.d.ts) + app/islands/**/*.{ts,tsx} + app/renderer/index.html
// ビルド出力（app/renderer/islands/app.js・vendor-react.js・app/renderer/theme.js）は
// 拡張子が .js のため自然に対象外。
const CHECK1_SCOPE = ALL_FILES.filter(
  (f) =>
    (f.startsWith('app/renderer/') && f.endsWith('.ts')) ||
    (f.startsWith('app/islands/') && (f.endsWith('.ts') || f.endsWith('.tsx'))) ||
    f === 'app/renderer/index.html',
);

type Violation = { file: string; line: number; text: string };

function scanLines(files: string[], patterns: RegExp[]): Violation[] {
  const violations: Violation[] = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(repoRoot, f), 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const re of patterns) {
        // re は呼び出し側で毎行 new RegExp する（lastIndex 罠回避）
        if (new RegExp(re.source, re.flags).test(line)) {
          violations.push({ file: f, line: i + 1, text: line.trim() });
          break;
        }
      }
    }
  }
  return violations;
}

function check1(): Violation[] {
  const patterns = [
    /window\.corpus[A-Z][A-Za-z0-9_]*/,
    // キャスト直後のプロパティアクセス/代入（例: (window as ...).corpusTip = {...}）
    /\)\s*\.corpus[A-Z][A-Za-z0-9_]*/,
    // ブラケット記法での動的代入（例: (window as any)[name] = api）
    /window\[[^\]]*\]\s*=/,
  ];
  return scanLines(CHECK1_SCOPE, patterns);
}

// 2026-07-11 (Wave33/V18): viewer.ts を app/renderer/orchestrator.ts へ改名した
// （ユーザー決定＝boot orchestration層は独立モジュールとして意図的に残す。実React
// 製品のmain/bootstrapモジュールに相当し、V18の目標は「viewer.tsという名前が消える
// こと」であって「boot用モジュールが一切存在しないこと」ではない — 詳細は memory
// corpus-react-purity-execution-map の V18 節）。本チェックはもう「モノリスの消滅」
// を判定する役目ではなく、改名の巻き戻り（旧ファイル名の再発生）だけを検知する回帰
// ガードに縮小＝orchestrator.tsが実在しviewer.tsが存在しなければ常にPASSでよい。
function check2(): boolean {
  const viewerGone = !fs.existsSync(path.join(repoRoot, 'app', 'renderer', 'viewer.ts'));
  const orchestratorPresent = fs.existsSync(path.join(repoRoot, 'app', 'renderer', 'orchestrator.ts'));
  return viewerGone && orchestratorPresent;
}

// 最終許可Set＝7件（2026-07-09 ユーザー確定・実プロダクト一致に振り切る）。
// vendor-react.js と jszip.min.js は framework脱外部化（V18節7）で消滅する想定＝
// それまではこの2件が「余分」として本チェックにFAIL表示され続けるのが意図どおり
// （残作業の可視化）。
const CHECK3_ALLOW = new Set([
  'app/preload.js',
  'app/renderer/islands/app.js',
  'app/renderer/theme.js',
  'app/vite.config.mjs',
  'app/islands/build.mjs',
  'extension/build.mjs',
  '.claude/hooks/guard-commit-heredoc.js',
]);

function check3(): { extra: string[]; missing: string[] } {
  const tracked = new Set(ALL_FILES.filter((f) => f.endsWith('.js') || f.endsWith('.mjs') || f.endsWith('.cjs')));
  const extra = [...tracked].filter((f) => !CHECK3_ALLOW.has(f)).sort();
  const missing = [...CHECK3_ALLOW].filter((f) => !tracked.has(f)).sort();
  return { extra, missing };
}

// check④: app/renderer/**/*.ts のみ（islands は対象外＝ref/focus/scroll等の命令的
// DOM を禁じないという外部基準と整合）。メソッド呼び出し/代入形限定＝コメント内の
// 単純言及を誤検出しない。
const DOM_PATTERNS = [
  /\.createElement\s*\(/,
  /\.innerHTML\s*=/,
  /\.insertAdjacentHTML\s*\(/,
  /\.appendChild\s*\(/,
  /\.removeChild\s*\(/,
  /\.replaceChild\s*\(/,
  /\.insertBefore\s*\(/,
  /\.createTextNode\s*\(/,
];
const ANNOTATION = '// purity: imperative-dom-ok';

function check4(): Violation[] {
  const scope = ALL_FILES.filter((f) => f.startsWith('app/renderer/') && f.endsWith('.ts'));
  const violations: Violation[] = [];
  for (const f of scope) {
    const content = fs.readFileSync(path.join(repoRoot, f), 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) continue; // コメント行のみの言及は対象外
      const hit = DOM_PATTERNS.some((re) => new RegExp(re.source).test(line));
      if (!hit) continue;
      const sameLineAnnotated = line.includes(ANNOTATION);
      const prevLineAnnotated = i > 0 && lines[i - 1].trim().startsWith(ANNOTATION);
      if (sameLineAnnotated || prevLineAnnotated) continue;
      violations.push({ file: f, line: i + 1, text: trimmed });
    }
  }
  return violations;
}

// check⑤: 両 .d.ts の interface Window { ... } を波括弧マッチで切り出し、
// プロパティ名集合が許可Set（corpus のみ）と一致するか確認。
const CHECK5_FILES = ['app/islands/types/globals.d.ts', 'app/renderer/types/renderer-globals.d.ts'];
const CHECK5_ALLOW = new Set(['corpus']);

function extractWindowBlock(content: string): string | null {
  const idx = content.indexOf('interface Window {');
  if (idx === -1) return null;
  const braceStart = content.indexOf('{', idx);
  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.slice(braceStart + 1, i);
    }
  }
  return null;
}

function check5(): { file: string; extra: string[] }[] {
  const results: { file: string; extra: string[] }[] = [];
  for (const f of CHECK5_FILES) {
    const full = path.join(repoRoot, f);
    if (!fs.existsSync(full)) {
      results.push({ file: f, extra: ['<file not found>'] });
      continue;
    }
    const content = fs.readFileSync(full, 'utf8');
    const block = extractWindowBlock(content);
    if (block === null) {
      results.push({ file: f, extra: ['<interface Window not found>'] });
      continue;
    }
    const names = new Set<string>();
    const propRe = /^\s*(\w+)\??:/gm;
    let m: RegExpExecArray | null;
    while ((m = propRe.exec(block))) names.add(m[1]);
    const extra = [...names].filter((n) => !CHECK5_ALLOW.has(n)).sort();
    results.push({ file: f, extra });
  }
  return results;
}

function report(name: string, violations: string[]): boolean {
  if (violations.length === 0) {
    console.log(`PASS ${name}`);
    return true;
  }
  console.error(`FAIL ${name}: ${violations.length}件`);
  for (const v of violations) console.error(`  - ${v}`);
  return false;
}

function main() {
  let allPass = true;

  allPass = report(
    'check①: window.corpus[A-Z] グローバル参照ゼロ',
    check1().map((v) => `${v.file}:${v.line}: ${v.text}`),
  ) && allPass;

  const renameIntact = check2();
  allPass =
    report('check②: viewer.ts→orchestrator.ts の改名が維持されている', renameIntact ? [] : ['app/renderer/viewer.ts が復活しているか、orchestrator.ts が見当たらない']) &&
    allPass;

  const { extra: c3extra, missing: c3missing } = check3();
  allPass =
    report(
      'check③: 手書き.js/.mjs/.cjs が許可リストと一致',
      [...c3extra.map((f) => `余分: ${f}`), ...c3missing.map((f) => `不足: ${f}`)],
    ) && allPass;

  allPass = report(
    'check④: 無注釈の命令的DOM操作ゼロ（app/renderer/**/*.ts）',
    check4().map((v) => `${v.file}:${v.line}: ${v.text}`),
  ) && allPass;

  const c5results = check5();
  const c5violations = c5results.flatMap((r) => r.extra.map((n) => `${r.file}: ${n}`));
  allPass = report('check⑤: Window拡張が corpus のみ', c5violations) && allPass;

  if (allPass) {
    console.log('PASS audit-react-purity: all 5 checks clean');
  } else {
    console.error('FAIL audit-react-purity: checks red (see above)');
    process.exit(1);
  }
}

main();

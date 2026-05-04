// pixiv の annotation Title と Eagle ファイル名が食い違ってるアイテムを検出。
// 実行: node scripts/find-pixiv-mismatches.mjs <library-path>
//
// バグの仕様:
//   Phase 1 で content.js の findAncestorContainerLink が document order の最初のリンクを
//   返してたため、ユーザーページや検索結果からドラッグした際に「ページ最上部の別作品」の
//   url/annotation が付いていた。Eagle for Chrome が付けるファイル名だけが正しい作品。

import fs from 'node:fs';
import path from 'node:path';
import { parseAnnotation } from '../shared/annotation-parser.js';

const libraryPath = process.argv[2] || 'C:\\Users\\apricot\\個人\\絵\\資料.library';
const imagesDir = path.join(libraryPath, 'images');

if (!fs.existsSync(imagesDir)) {
  console.error(`Library not found: ${imagesDir}`);
  process.exit(1);
}

const dirs = fs.readdirSync(imagesDir, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name.endsWith('.info'));

const mismatches = [];
const total = { pixiv: 0, scanned: 0 };

for (const d of dirs) {
  total.scanned++;
  const metaPath = path.join(imagesDir, d.name, 'metadata.json');
  if (!fs.existsSync(metaPath)) continue;
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    continue;
  }
  if (!meta.url || !/pixiv\.net\/artworks\//.test(meta.url)) continue;
  total.pixiv++;

  const parsed = parseAnnotation(meta.annotation);
  if (!parsed || parsed.platform !== 'pixiv') continue;

  // 新形式は Title、旧形式は Text に作品タイトルが入る
  const annotationTitle = parsed.title || parsed.text;
  const fileName = meta.name || '';

  if (!annotationTitle) continue;

  // ファイル名に annotation Title が含まれてれば一致とみなす。
  // pixiv の Eagle for Chrome ファイル名は "<タグ?> <illustTitle> - <author>のイラスト" 形式。
  if (!fileName.includes(annotationTitle)) {
    // 補助的に作者名 (Display Name) も見ておく。両方とも違えば mismatch 確度高い。
    const authorMatch = parsed.displayName && fileName.includes(parsed.displayName);
    mismatches.push({
      id: meta.id,
      url: meta.url,
      fileName,
      annotationTitle,
      annotationDisplayName: parsed.displayName,
      authorAlsoMismatch: !authorMatch
    });
  }
}

console.log(`Scanned: ${total.scanned} items`);
console.log(`pixiv items: ${total.pixiv}`);
console.log(`Mismatches: ${mismatches.length}`);
console.log();

for (const m of mismatches) {
  console.log(`--- ${m.id} ---`);
  console.log(`  filename:   ${m.fileName}`);
  console.log(`  url:        ${m.url}`);
  console.log(`  annot.Title: ${m.annotationTitle}`);
  console.log(`  annot.Author: ${m.annotationDisplayName}${m.authorAlsoMismatch ? ' (作者名もファイル名に無い)' : ''}`);
  console.log();
}

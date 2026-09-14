import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 配布する公式バイナリを固定し、ダウンロード内容を検証する。
const version = '1.53.2';
const digest = 'edb04f8288565e413a318069600954e38574714e5a2559777f8f4e8cc16d1bf3';
const dir = fileURLToPath(new URL('../app/vendor/meilisearch/', import.meta.url));
const target = path.join(dir, 'meilisearch.exe');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let bytes = await fs.readFile(target).catch(() => null);
if (!bytes || hash(bytes) !== digest) {
  const response = await fetch(`https://github.com/meilisearch/meilisearch/releases/download/v${version}/meilisearch-windows-amd64.exe`);
  if (!response.ok) throw new Error(`Meilisearch download: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== digest) throw new Error('Meilisearch checksum mismatch');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${target}.tmp`, bytes);
  await fs.rename(`${target}.tmp`, target);
}
console.log(`Meilisearch ${version}: verified`);

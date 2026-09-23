import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 配布する公式バイナリを固定し、ダウンロード内容を検証する。
const version = '1.53.2';
const assets = {
  'win32-x64': {
    filename: 'meilisearch-windows-amd64.exe',
    digest: 'edb04f8288565e413a318069600954e38574714e5a2559777f8f4e8cc16d1bf3',
  },
  'linux-x64': {
    filename: 'meilisearch-linux-amd64',
    digest: '6c00019a887813ccbce54eec52718c9343bf4234383871146c67c76b1d2646cd',
  },
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) throw new Error(`Meilisearch is unsupported on ${process.platform}-${process.arch}`);
const dir = fileURLToPath(new URL('../app/vendor/meilisearch/', import.meta.url));
const target = path.join(dir, process.platform === 'win32' ? 'meilisearch.exe' : 'meilisearch');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let bytes = await fs.readFile(target).catch(() => null);
if (!bytes || hash(bytes) !== asset.digest) {
  const response = await fetch(`https://github.com/meilisearch/meilisearch/releases/download/v${version}/${asset.filename}`);
  if (!response.ok) throw new Error(`Meilisearch download: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== asset.digest) throw new Error('Meilisearch checksum mismatch');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(`${target}.tmp`, bytes);
  await fs.rename(`${target}.tmp`, target);
}
if (process.platform !== 'win32') await fs.chmod(target, 0o755);
console.log(`Meilisearch ${version}: verified`);

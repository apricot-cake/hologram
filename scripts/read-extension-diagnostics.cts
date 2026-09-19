'use strict';

// Chrome の extension storage は起動中のブラウザが所有する LevelDB なので、
// 直接開かない。短命のコピーを読み、native host に届かなかった diaglog_ の
// 退避ログだけを出力する。日常用Chromeには CDP 接続しない。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClassicLevel } = require('classic-level');

const EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const DIAG_PREFIX = 'diaglog_';

function profileDirectory(kind: string): string {
  if (kind === 'development') {
    const root = process.env.HOLOGRAM_EXTENSION_DEV_PROFILE || path.join(os.homedir(), '.hologram-ext-profile');
    return path.join(root, 'Default');
  }
  if (kind === 'daily') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default');
  }
  throw new Error('使い方: npm run diag:extension -- [daily|development]');
}

function storageDirectory(kind: string): string {
  return path.join(profileDirectory(kind), 'Local Extension Settings', EXTENSION_ID);
}

function decodeValue(value: Buffer): unknown {
  const text = value.toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    // Chrome の値エンコードは版によって先頭に制御バイトを持つことがある。
    const jsonStart = text.indexOf('{');
    if (jsonStart >= 0) {
      try {
        return JSON.parse(text.slice(jsonStart));
      } catch {
        /* 下で生の値として返す */
      }
    }
    return { unreadable: true, bytes: value.length };
  }
}

async function readDiagnostics(kind: string): Promise<unknown[]> {
  const source = storageDirectory(kind);
  if (!fs.existsSync(source)) return [];

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-extension-storage-'));
  const copy = path.join(temp, 'storage');
  try {
    fs.cpSync(source, copy, { recursive: true, filter: (file) => path.basename(file) !== 'LOCK' });
    const db = new ClassicLevel(copy, { keyEncoding: 'buffer', valueEncoding: 'buffer' });
    const entries: unknown[] = [];
    try {
      for await (const [key, value] of db.iterator()) {
        const name = Buffer.from(key).toString('utf8');
        if (name.includes(DIAG_PREFIX)) entries.push({ key: name, value: decodeValue(Buffer.from(value)) });
      }
    } finally {
      await db.close();
    }
    return entries.sort((a: any, b: any) => a.key.localeCompare(b.key));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function main() {
  const kind = process.argv[2] || 'daily';
  const entries = await readDiagnostics(kind);
  console.log(JSON.stringify({ profile: kind, storage: storageDirectory(kind), entries }, null, 2));
}

module.exports = { decodeValue, profileDirectory, readDiagnostics, storageDirectory };
if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

// Builds the extension: tsc compiles the .ts sources to dist/*.js (see
// tsconfig.build.json), then this script copies the static assets Chrome also
// needs alongside them. `dist/` — not this source directory — is what gets
// loaded as the unpacked extension (see tsconfig.json's header comment for why
// this layer needs a real build step unlike main/native-host).
//
//   node build.mjs           (or: npm run build, from extension/)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const tsc = path.join(here, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tsc, '-p', path.join(here, 'tsconfig.build.json')], { stdio: 'inherit', cwd: here });

// Static assets referenced by manifest.json / diag.html that tsc doesn't touch.
const STATIC_FILES = ['manifest.json', 'diag.html'];
const STATIC_DIRS = ['_locales', 'icons'];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

for (const f of STATIC_FILES) fs.copyFileSync(path.join(here, f), path.join(dist, f));
for (const d of STATIC_DIRS) copyDir(path.join(here, d), path.join(dist, d));

console.log(`Built extension/dist (${STATIC_FILES.length} static files + ${STATIC_DIRS.join(', ')})`);

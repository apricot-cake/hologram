'use strict';

const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.join(__dirname, '..', 'extension');
const packageFile = path.join(extensionRoot, 'node_modules', '@crxjs', 'vite-plugin', 'package.json');
const bundleFile = path.join(extensionRoot, 'node_modules', '@crxjs', 'vite-plugin', 'dist', 'index.mjs');
const expectedVersion = '2.7.1';
const upstream = 'setTimeout(() => location.reload(), 500);';
// This text lives inside CRXJS's generated-client string literal, so its quote
// characters must stay escaped in the plugin bundle.
const patched = String.raw`console.log(\"[crx] host page reload suppressed by Hologram (upstream option pending)\");`;
const malformedPatch = 'console.log("[crx] host page reload suppressed by Hologram (upstream option pending)");';
const orphanUpstream = 'if (error instanceof Error && error.message.includes(\\"Extension context invalidated.\\")) {\\n          location.reload();\\n        } else';
const orphanPatched = 'if (error instanceof Error && error.message.includes(\\"Extension context invalidated.\\")) {\\n          console.log(\\"[crx] invalidated host page left intact by Hologram\\");\\n        } else';

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function verify(): void {
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (pkg.version !== expectedVersion) {
    throw new Error(`CRXJS patch is pinned to ${expectedVersion}, found ${String(pkg.version)}`);
  }

  const source = fs.readFileSync(bundleFile, 'utf8');
  const patchCount = occurrences(source, patched);
  if (patchCount !== 1) throw new Error(`CRXJS runtime page-reload patch count must be 1, found ${patchCount}`);
  if (occurrences(source, upstream) !== 0) throw new Error('CRXJS still contains the unconditional content-page location.reload()');
  if (occurrences(source, orphanUpstream) !== 0 || occurrences(source, orphanPatched) !== 1) throw new Error('CRXJS invalidated content client can still reload a host page');
  if (!source.includes('chrome.runtime.reload();')) throw new Error('CRXJS runtime reload was removed together with the page reload');
  if (!source.includes('forward(JSON.stringify(payload.data));')) throw new Error('CRXJS content-script HMR forwarding is missing');
}

function apply(): void {
  const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (pkg.version !== expectedVersion) {
    throw new Error(`Refusing to patch @crxjs/vite-plugin ${String(pkg.version)}; expected ${expectedVersion}`);
  }

  const source = fs.readFileSync(bundleFile, 'utf8');
  let next = source;
  if (occurrences(next, malformedPatch) === 1) next = next.replace(malformedPatch, patched);
  if (occurrences(next, upstream) === 1) next = next.replace(upstream, patched);
  if (occurrences(next, orphanUpstream) === 1) next = next.replace(orphanUpstream, orphanPatched);
  if (next !== source) {
    fs.writeFileSync(bundleFile, next, 'utf8');
    verify();
    return;
  }
  verify();
}

module.exports = { apply, verify, expectedVersion, packageFile, bundleFile };

if (require.main === module) {
  apply();
  console.log(`[hologram] patched @crxjs/vite-plugin ${expectedVersion}: runtime reload no longer reloads host pages`);
}

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
// `__LIVE_RELOAD__` appears twice in the worker client, but CRXJS substitutes it
// with a string pattern, so only the first one is rewritten. The survivor sits in
// the socket close handler, which means every dev server restart ends in a
// ReferenceError instead of the runtime reload that reconnects HMR.
const liveReloadUpstream = '.replace("__LIVE_RELOAD__", JSON.stringify(liveReload))';
const liveReloadPatched = '.replaceAll("__LIVE_RELOAD__", JSON.stringify(liveReload))';

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// Every client CRXJS serves is a string literal declared at the top level of the
// bundle, so the placeholders still waiting for substitution are readable here.
function clientSources(source: string): { name: string; body: string }[] {
  const clients: { name: string; body: string }[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^var ([A-Za-z0-9_$]+) = (".*");?$/);
    if (!match) continue;
    try {
      clients.push({ name: match[1], body: JSON.parse(match[2]) });
    } catch {
      /* not a plain string literal, so it carries no client placeholders */
    }
  }
  return clients;
}

// Guards the defect class instead of the one placeholder that hit us: a
// placeholder occurring more than once cannot be substituted by a single
// `replace`, or the leftovers reach the browser as undefined identifiers.
function verifySubstitutions(source: string): void {
  for (const client of clientSources(source)) {
    const counts = new Map<string, number>();
    for (const hit of client.body.matchAll(/__[A-Z0-9_]+__/g)) counts.set(hit[0], (counts.get(hit[0]) ?? 0) + 1);
    for (const [placeholder, count] of counts) {
      if (count < 2) continue;
      const quoted = `['"\`]${placeholder}['"\`]`;
      if (!new RegExp(`\\.replace\\(\\s*${quoted}`).test(source)) continue;
      if (new RegExp(`\\.replaceAll\\(\\s*${quoted}`).test(source)) continue;
      throw new Error(`CRXJS substitutes ${placeholder} with a single replace, but ${client.name} contains it ${count} times`);
    }
  }
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
  if (occurrences(source, liveReloadUpstream) !== 0 || occurrences(source, liveReloadPatched) !== 1) throw new Error('CRXJS still substitutes the live-reload flag only once, so a restarted server cannot reconnect');
  if (!source.includes('chrome.runtime.reload();')) throw new Error('CRXJS runtime reload was removed together with the page reload');
  if (!source.includes('forward(JSON.stringify(payload.data));')) throw new Error('CRXJS content-script HMR forwarding is missing');
  verifySubstitutions(source);
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
  if (occurrences(next, liveReloadUpstream) === 1) next = next.replace(liveReloadUpstream, liveReloadPatched);
  if (next !== source) {
    fs.writeFileSync(bundleFile, next, 'utf8');
    verify();
    return;
  }
  verify();
}

module.exports = { apply, verify, verifySubstitutions, expectedVersion, packageFile, bundleFile };

if (require.main === module) {
  apply();
  console.log(`[hologram] patched @crxjs/vite-plugin ${expectedVersion}: runtime reload no longer reloads host pages, and survives a server restart`);
}

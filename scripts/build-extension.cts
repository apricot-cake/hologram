'use strict';

// `npm run build:ext` — build the RELEASE extension for Chrome and Firefox and
// verify both outputs before anything is allowed to use them.
//
// This never writes to the folder the daily Chrome has loaded. Releases land in
// extension/.output/<browser>-mv3-release; putting a verified one into
// extension/.output/chrome-mv3 is a separate, deliberate step
// (scripts/deploy-extension.cts). The development build is a third output
// entirely, outside the tree, read only by the dedicated development profile
// (#732 — extension/wxt.config.ts).
//
// THE FAILURE THIS SCRIPT EXISTS TO PREVENT is the one measured on #650: if the
// extension reloads while the folder it was loaded from is INCOMPLETE — a
// half-written manifest, or a manifest naming a file that is not there yet —
// Chrome disables it with DISABLE_RELOAD and it does not come back when the
// files do. Recovering needs a click in chrome://extensions, which is the thing
// the self-reload exists to remove. So the output is checked against its own
// manifest first: it parses, every file it names exists and is non-empty, the
// entrypoints the code injects BY NAME are there, the signing key still produces
// the one extension id, and no development marker survived into it.

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXTENSION = path.join(ROOT, 'extension');
const EXPECTED_ID = 'keggmjkemfcekcffohnpaojacdakpejh';

// Text that must NOT survive into a release. The first three are the development
// server's fingerprints. The fourth is the DEVELOPMENT native messaging host
// name (#732): a release that asked for it would write into the development
// sandbox instead of the real library — and the extension E2E harness, which
// isolates itself by rewriting the release host name in the built bundle, would
// silently rewrite the wrong one.
const FORBIDDEN_TEXT = ['127.0.0.1:51731', 'localhost:51731', '/@vite/client', 'com.hologram.host.dev', 'sourceMappingURL='];

// Entrypoints named by STRING in code rather than by the manifest, so nothing
// else would notice them disappearing: background.ts injects capture.js on every
// activation (`files: ['capture.js']`), and the diagnostics page is what a
// failure sends the user to.
const NAMED_BY_CODE = ['capture.js', 'diag.html'];

// The worker is the one bundle that has to hold the build token as a VALUE: it
// compares it with what the host reports on every reply (#650).
const CARRIES_TOKEN = 'background.js';

function mintBuildId(): string {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function extensionId(key: string): string {
  return [...crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)].map((byte) => `${'abcdefghijklmnop'[byte >> 4]}${'abcdefghijklmnop'[byte & 15]}`).join('');
}

function releaseDir(browser: string): string {
  return path.join(EXTENSION, '.output', `${browser}-mv3-release`);
}

function listedFiles(manifest): Set<string> {
  const files = new Set<string>();
  const add = (value) => typeof value === 'string' && value && files.add(value);
  add(manifest.background?.service_worker);
  for (const value of manifest.background?.scripts || []) add(value);
  add(manifest.options_ui?.page);
  // #124: the toolbar popup. Named by the manifest like the options page, and
  // missing from this tally until the popup existed — a manifest that names a
  // file the output does not have is exactly the DISABLE_RELOAD state this
  // script exists to catch (see the header), so the check has to grow with the
  // manifest.
  add(manifest.action?.default_popup);
  for (const script of manifest.content_scripts || []) {
    for (const value of script.js || []) add(value);
    for (const value of script.css || []) add(value);
  }
  for (const value of Object.values(manifest.icons || {})) add(value as string);
  for (const value of Object.values(manifest.action?.default_icon || {})) add(value as string);
  for (const group of manifest.web_accessible_resources || []) for (const value of group.resources || []) add(value);
  if (manifest.default_locale) files.add(path.join('_locales', manifest.default_locale, 'messages.json'));
  for (const value of NAMED_BY_CODE) files.add(value);
  return files;
}

function verifyOutput(browser: string, buildId?: string): string {
  const out = releaseDir(browser);
  const manifestFile = path.join(out, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest.manifest_version !== 3) throw new Error(`${browser}: manifest is not MV3`);
  if (extensionId(manifest.key || '') !== EXPECTED_ID) throw new Error(`${browser}: signing key no longer produces ${EXPECTED_ID}`);
  if (!manifest.permissions?.includes('nativeMessaging')) throw new Error(`${browser}: nativeMessaging permission is missing`);

  const files = listedFiles(manifest);
  for (const relative of files) {
    const file = path.join(out, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).size) throw new Error(`${browser}: manifest resource is missing or empty: ${relative}`);
  }

  const all = fs.readdirSync(out, { recursive: true, withFileTypes: true });
  for (const entry of all) {
    if (!entry.isFile()) continue;
    const relative = path.join(entry.parentPath.slice(out.length + 1), entry.name);
    if (relative.endsWith('.map')) throw new Error(`${browser}: source map shipped: ${relative}`);
    if (!/\.(?:html|js|json|css)$/.test(relative)) continue;
    const body = fs.readFileSync(path.join(out, relative), 'utf8');
    const forbidden = FORBIDDEN_TEXT.find((value) => body.includes(value));
    if (forbidden) throw new Error(`${browser}: release contains dev marker ${forbidden} in ${relative}`);
  }

  // The token has to have reached the worker, or a deployed build would ask for
  // a reload it can never satisfy: it would come back still not carrying the
  // token the host reports. (One reload is all it would cost — see
  // DevReloadState.attempted — but "one wasted reload per build" is exactly the
  // noise this feature must not make.)
  if (buildId && !fs.readFileSync(path.join(out, CARRIES_TOKEN), 'utf8').includes(buildId)) {
    throw new Error(`${browser}: ${CARRIES_TOKEN} does not carry this build's token (${buildId}) — the define in extension/wxt.config.ts did not reach it`);
  }

  console.log(`[hologram] verified ${browser} release: ${out}`);
  return out;
}

function run(script: string, buildId: string) {
  // Windows: npm.cmd spawned without a shell is EINVAL (skill windows-scripting).
  execFileSync(`npm --prefix extension run ${script}`, {
    cwd: ROOT,
    shell: true,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { HOLOGRAM_EXT_BUILD_ID: buildId }),
  });
}

// Minted here, not inside the extension build: the value has to be decided ONCE,
// by the side that also verifies the output and (on promotion) publishes it.
const buildId = mintBuildId();
run('build:chrome', buildId);
run('build:firefox', buildId);
verifyOutput('chrome', buildId);
verifyOutput('firefox', buildId);

module.exports = { verifyOutput, releaseDir, buildId };

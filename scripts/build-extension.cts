'use strict';

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXTENSION = path.join(ROOT, 'extension');
const EXPECTED_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const FORBIDDEN_TEXT = ['127.0.0.1:51731', 'localhost:51731', '/@vite/client', 'sourceMappingURL='];

function extensionId(key) {
  return [...crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)].map((byte) => `${'abcdefghijklmnop'[byte >> 4]}${'abcdefghijklmnop'[byte & 15]}`).join('');
}

function listedFiles(manifest): Set<string> {
  const files = new Set<string>();
  const add = (value) => typeof value === 'string' && value && files.add(value);
  add(manifest.background?.service_worker);
  for (const value of manifest.background?.scripts || []) add(value);
  add(manifest.options_ui?.page);
  for (const script of manifest.content_scripts || []) {
    for (const value of script.js || []) add(value);
    for (const value of script.css || []) add(value);
  }
  for (const value of Object.values(manifest.icons || {})) add(value as string);
  for (const value of Object.values(manifest.action?.default_icon || {})) add(value as string);
  for (const group of manifest.web_accessible_resources || []) for (const value of group.resources || []) add(value);
  if (manifest.default_locale) files.add(path.join('_locales', manifest.default_locale, 'messages.json'));
  files.add('diag.html');
  return files;
}

function verifyOutput(browser) {
  const out = path.join(EXTENSION, '.output', `${browser}-mv3-release`);
  const manifestFile = path.join(out, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8').replace(/^\uFEFF/, ''));
  if (manifest.manifest_version !== 3) throw new Error(`${browser}: manifest is not MV3`);
  if (extensionId(manifest.key || '') !== EXPECTED_ID) throw new Error(`${browser}: signing key no longer produces ${EXPECTED_ID}`);
  if (!manifest.permissions?.includes('nativeMessaging')) throw new Error(`${browser}: nativeMessaging permission is missing`);

  const files = listedFiles(manifest);
  const capture = [...files].find((value) => /(?:^|\/)capture\.js$/.test(value));
  if (!capture) throw new Error(`${browser}: generated capture IIFE is not listed`);
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

  console.log(`[hologram] verified ${browser} release: ${out}`);
  return out;
}

function run(script) {
  execFileSync(`npm --prefix extension run ${script}`, { cwd: ROOT, shell: true, stdio: 'inherit' });
}

run('build:chrome');
run('build:firefox');
verifyOutput('chrome');
verifyOutput('firefox');

module.exports = { verifyOutput };

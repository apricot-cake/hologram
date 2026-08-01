'use strict';

// Shared Playwright launcher for every extension browser test. Playwright's
// extension support requires its bundled Chromium and a persistent context;
// keeping that setup here prevents the live-site canary, offline fixture, and
// overlay regressions from drifting into different browser stacks.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SOURCE_EXTENSION = path.join(ROOT, 'extension', '.output', 'chrome-mv3-release');
const PRODUCTION_NATIVE_HOST = 'com.hologram.host';

interface StageExtensionOptions {
  allUrls?: boolean;
  nativeHostName?: string;
  tempPrefix?: string;
}

function copyDirectory(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function replaceNativeHostName(directory: string, nativeHostName: string): void {
  let replacements = 0;
  const visit = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (!entry.name.endsWith('.js')) continue;
      const source = fs.readFileSync(target, 'utf8');
      if (!source.includes(PRODUCTION_NATIVE_HOST)) continue;
      const next = source.replaceAll(PRODUCTION_NATIVE_HOST, nativeHostName);
      replacements += (source.match(new RegExp(PRODUCTION_NATIVE_HOST.replaceAll('.', '\\.'), 'g')) || []).length;
      fs.writeFileSync(target, next, 'utf8');
    }
  };
  visit(directory);
  if (!replacements) throw new Error(`built extension does not contain native host ${PRODUCTION_NATIVE_HOST}`);
}

function stageExtension(options: StageExtensionOptions = {}): string {
  if (!fs.existsSync(path.join(SOURCE_EXTENSION, 'manifest.json'))) {
    throw new Error(`extension build missing at ${SOURCE_EXTENSION} — run \`npm run build:ext\` first`);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), options.tempPrefix || 'hologram-extension-e2e-'));
  copyDirectory(SOURCE_EXTENSION, directory);

  if (options.allUrls) {
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    manifest.host_permissions = Array.from(new Set([...(manifest.host_permissions || []), '<all_urls>']));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  }
  if (options.nativeHostName && options.nativeHostName !== PRODUCTION_NATIVE_HOST) {
    replaceNativeHostName(directory, options.nativeHostName);
  }
  return directory;
}

interface LaunchExtensionOptions {
  extensionDir: string;
  userDataDir?: string | null;
  headless?: boolean;
  viewport?: { width: number; height: number } | null;
  locale?: string;
  args?: string[];
  // Which binary to drive. Tests keep the default bundled Chromium so a run is
  // reproducible. Pass 'chrome' when the point is a profile a HUMAN signed into
  // (a signed-in real Chrome profile): a profile directory
  // belongs to one Chromium build, so borrowing it from the other one risks
  // both the session and the profile itself.
  channel?: string;
}

interface ExtensionBrowser {
  context: any;
  serviceWorker: any;
  extensionId: string;
  profileDir: string;
  close(): Promise<void>;
}

async function launchExtensionBrowser(options: LaunchExtensionOptions): Promise<ExtensionBrowser> {
  const ownsProfile = !options.userDataDir;
  const profileDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-extension-e2e-profile-'));
  let context: any;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: options.channel || 'chromium',
      headless: options.headless ?? true,
      viewport: options.viewport === undefined ? { width: 1280, height: 960 } : options.viewport,
      locale: options.locale,
      args: [`--disable-extensions-except=${options.extensionDir}`, `--load-extension=${options.extensionDir}`, '--no-first-run', '--no-default-browser-check', ...(options.args || [])],
    });
    let serviceWorker = context.serviceWorkers().find((worker: any) => worker.url().startsWith('chrome-extension://'));
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', {
        predicate: (worker: any) => worker.url().startsWith('chrome-extension://'),
        timeout: 20_000,
      });
    }
    const extensionId = new URL(serviceWorker.url()).host;
    return {
      context,
      serviceWorker,
      extensionId,
      profileDir,
      async close() {
        await context.close();
        if (ownsProfile) fs.rmSync(profileDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (context) await context.close().catch(() => {});
    if (ownsProfile) fs.rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  PRODUCTION_NATIVE_HOST,
  SOURCE_EXTENSION,
  launchExtensionBrowser,
  stageExtension,
};

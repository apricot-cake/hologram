'use strict';

// Shared Playwright launcher for every extension browser test. Playwright's
// extension support requires its bundled Chromium and a persistent context;
// keeping that setup here prevents the live-site canary, offline fixture, and
// overlay regressions from drifting into different browser stacks.
//
// #657: Chrome 137+ dropped the `--load-extension` command-line switch. In the
// bundled Chromium it still appears to work on first load (the extension gets
// `location=COMMAND_LINE`), but the moment `chrome.runtime.reload()` runs,
// Chrome disables it with `DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION` instead of
// actually reloading it — a disabled extension and an orphaned tab look
// identical to a page, so tests built on `chrome.runtime.reload()` (the orphan
// repro) stayed green while measuring the wrong failure. The replacement
// (confirmed against this repo's #650 investigation and re-verified while
// building this fix) is the combination below: CDP's `Extensions.loadUnpacked`
// gives the extension `location=UNPACKED` (the same state "Load unpacked" in
// chrome://extensions produces), which is the one location `runtime.reload()`
// actually reloads instead of disabling.

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

// chrome://extensions is a Polymer/Lit page: every meaningful control lives
// behind nested shadow roots, so it has to be reached with a script, not a
// visible-DOM selector. Writing "devMode" into Preferences directly is not
// enough — Chrome only honors the real UI toggle (confirmed while building
// this fix: loading unpacked with the toggle left off still ends with the
// extension disabled the instant `runtime.reload()` runs).
const DEV_MODE_TOGGLE_JS = `
  document.querySelector('extensions-manager')?.shadowRoot
    ?.querySelector('extensions-toolbar')?.shadowRoot
    ?.querySelector('#devMode') ?? null
`;

async function ensureDeveloperModeOn(context: any): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto('chrome://extensions');
    await page.waitForFunction(`!!(${DEV_MODE_TOGGLE_JS})`, { timeout: 10_000 });
    const alreadyOn = await page.evaluate(`(${DEV_MODE_TOGGLE_JS}).checked`);
    if (!alreadyOn) {
      await page.evaluate(`(${DEV_MODE_TOGGLE_JS}).click()`);
      await page.waitForFunction(`(${DEV_MODE_TOGGLE_JS}).checked === true`, { timeout: 5_000 });
    }
  } finally {
    await page.close();
  }
}

// The browser-level CDP session this needs (`Extensions` is a browser domain,
// not a page domain) can be detached right after the call returns — the
// extension stays loaded and, later, `chrome.runtime.reload()` still keeps it
// enabled (confirmed while building this fix). No session needs to be kept
// alive for the life of the browser.
async function loadUnpacked(context: any, extensionDir: string): Promise<string> {
  const cdp = await context.browser().newBrowserCDPSession();
  try {
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionDir });
    return id;
  } finally {
    await cdp.detach().catch(() => {});
  }
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
      // `--enable-unsafe-extension-debugging` is what makes the `Extensions`
      // CDP domain available at all. Playwright's own default args include
      // `--disable-extensions`, which would make an unpacked load a no-op, so
      // it has to be dropped via ignoreDefaultArgs rather than overridden.
      args: ['--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', ...(options.args || [])],
      ignoreDefaultArgs: ['--disable-extensions'],
    });
    await ensureDeveloperModeOn(context);
    const extensionId = await loadUnpacked(context, options.extensionDir);
    let serviceWorker = context.serviceWorkers().find((worker: any) => worker.url().startsWith(`chrome-extension://${extensionId}/`));
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker', {
        predicate: (worker: any) => worker.url().startsWith(`chrome-extension://${extensionId}/`),
        timeout: 20_000,
      });
    }
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

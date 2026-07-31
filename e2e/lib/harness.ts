// The shared launch harness for the Electron E2E suite.
//
// It is the generalization of scripts/test-app-folder-dnd.cts, the first case
// that drove a real Electron window with real pointer input (#41): a sandboxed
// config dir, a seeded library, `_electron.launch()`, and a window that can be
// clicked. Everything that case had to arrange by hand lives here now, so a spec
// is only its own flow.
//
// WHY A VISIBLE WINDOW AT ALL. The scripts/test-app-*.cts layer boots the app
// hidden (HOLOGRAM_SMOKE) and dispatches synthetic DOM events. That reaches state
// and IPC, but never the real click path — pointer-events, z-index, overlap,
// layout — and never the pixels. This suite exists for exactly that gap, so its
// window has to be on screen and compositing.
//
// WHY IT STILL DOES NOT TAKE THE SCREEN. HOLOGRAM_START_INACTIVE makes main show
// the window without activating it and push it to the bottom of the z-order
// (index.ts's sendWindowToBack), the same treatment scripts/sandbox-app.cts gets.
// Playwright's input goes over CDP, which does not need the window focused, so a
// run never pulls the foreground away from whoever is at the keyboard.
//
// WHY THE CHROMIUM SWITCHES. A window at the bottom of the z-order is an occluded
// window, and Chromium's default answer to that is to background the renderer and
// throttle its timers — which stalls rendering and can leave a surface capture
// waiting forever. Playwright passes these same three switches to every browser
// it launches; an Electron app is launched by us, so we pass them ourselves.
// --force-device-scale-factor=1 pins DPI, without which a baseline taken on one
// display scale never matches another.

import { _electron, test as base } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIXTURE_POSTS, type FixturePost, seedFixtureLibrary } from './library.ts';

const repoRoot = path.join(__dirname, '..', '..');
const appDir = path.join(repoRoot, 'app');
const { electronPath, buildArtifactError } = require(path.join(repoRoot, 'scripts', 'lib-electron-path.cts'));

/** The window's content box for every case. Fixed, because the baselines are pixels. */
export const CONTENT_SIZE = { width: 1280, height: 800 };

export interface LaunchOptions {
  /** Posts to seed. Pass [] for the first-run empty state. Defaults to FIXTURE_POSTS. */
  posts?: FixturePost[];
  /** Resolved theme. Written into config.json, so main hands it to the first paint. */
  theme?: 'light' | 'dark';
  /** Extra seeding (folders, tag types, …) after the posts are in, before launch. */
  seed?: (ctx: { configDir: string; saveFolder: string }) => void;
}

export interface Hologram {
  app: ElectronApplication;
  page: Page;
  configDir: string;
  saveFolder: string;
  /** Open the app's database and run `fn` against it — for asserting persistence. */
  readDb<T>(fn: (sqlite: any) => T): T;
  /** A post's user tags, as stored. Kept here so specs don't carry schema knowledge. */
  tagsOf(captureId: string): string[];
}

async function launch(options: LaunchOptions): Promise<{ hologram: Hologram; close: () => Promise<void> }> {
  // #463's guard, surfaced as a test failure rather than as an OS error dialog
  // per case (electronPath() itself would exit the whole worker).
  const notBuilt = buildArtifactError();
  if (notBuilt) throw new Error(notBuilt);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-e2e-'));
  const configDir = path.join(tmp, 'Hologram');
  const saveFolder = path.join(tmp, 'library');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  // theme is a top-level config key (main reads readConfig().theme and passes it
  // to the page as ?theme=), so pinning it here decides the first paint — the
  // window never resolves 'auto' against the machine's OS setting.
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'e2etestextensionidabcdefghijklm', theme: options.theme ?? 'light' }, null, 2));

  seedFixtureLibrary(configDir, saveFolder, options.posts ?? FIXTURE_POSTS);
  options.seed?.({ configDir, saveFolder });

  const app = await _electron.launch({
    executablePath: electronPath(),
    args: ['.', '--force-device-scale-factor=1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    cwd: appDir,
    env: {
      ...process.env,
      // %APPDATA% too, so any fallback read/write stays inside the sandbox.
      APPDATA: tmp,
      HOLOGRAM_CONFIG_DIR: configDir,
      // Skips native-host registration: no HKCU writes, no copy into the shared
      // ~/.hologram. A run cannot touch the real library or the real Chrome's
      // view of it.
      HOLOGRAM_SANDBOX: '1',
      HOLOGRAM_START_INACTIVE: '1',
      // The specs look up controls by their Japanese labels; without this the
      // language is the machine's, and an en-US CI runner reads as missing
      // controls rather than as a different language (docs/testing.md).
      HOLOGRAM_LANG: 'ja',
      // Dates are stored as UTC instants and rendered in local time, so the
      // machine's timezone decides what the inspector says a post was posted on.
      // Pinned for the same reason the language is: a runner in another zone
      // would render a different (still correct) date, and the specs read those
      // labels.
      TZ: 'Asia/Tokyo',
    },
  });

  const page = await app.firstWindow();
  // Sizing the CONTENT box, not the window: the frame's dimensions are the OS's
  // business and differ between machines, while the content box is what the
  // screenshots are of.
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), CONTENT_SIZE);
  // "The first render finished" — either cards have mounted into the grid slot, or
  // the library is empty and the placeholder took the space instead.
  await page.waitForFunction(() => !!document.querySelector('[data-slot="post-card"], [data-slot="empty-state"]'));

  const hologram: Hologram = {
    app,
    page,
    configDir,
    saveFolder,
    readDb(fn) {
      const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
      const handle = openDatabase(path.join(configDir, 'hologram.db'));
      try {
        return fn(handle.sqlite);
      } finally {
        handle.sqlite.close();
      }
    },
    tagsOf(captureId) {
      return hologram.readDb((sqlite) =>
        sqlite
          .prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY t.name')
          .all(captureId)
          .map((row: { name: string }) => row.name),
      );
    },
  };

  return {
    hologram,
    close: async () => {
      await app.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/**
 * `launchHologram(opts)` boots one sandboxed app per call and tears it down when
 * the case ends. A fixture function rather than a fixture value, because cases
 * differ in what they need seeded — and a few boot the app twice to assert that
 * something survived a restart.
 */
export const test = base.extend<{ launchHologram: (options?: LaunchOptions) => Promise<Hologram> }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies out of this destructuring pattern; empty means "depends on nothing", and it is the form the framework documents
  launchHologram: async ({}, use) => {
    const running: Array<() => Promise<void>> = [];
    await use(async (options = {}) => {
      const { hologram, close } = await launch(options);
      running.push(close);
      return hologram;
    });
    for (const close of running) await close();
  },
});

export { expect } from '@playwright/test';

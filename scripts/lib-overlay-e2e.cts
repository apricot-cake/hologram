'use strict';

// Shared harness for the browser-level overlay tests (e2e-overlay-*.cts).
// jsdom can exercise DOM decisions, but flicker, stacking order and composited
// scrolling are properties of a real browser, so these tests load the built
// extension into a disposable Chrome profile and serve platform-shaped fixture
// pages (scripts/fixtures/overlay/) at the real origins the content script
// matches on.
//
// The piece that makes FLICKER testable is the recorder: a MutationObserver
// installed before the content script runs, writing a timestamped timeline of
// everything the overlay does to the page — control insertions/removals and
// style writes to page-owned elements. Flicker is a pattern in this timeline
// (the same host gaining and losing its control repeatedly), which a single
// before/after assertion can never see.
//
// Scheduled to move to Playwright together with the other puppeteer assets
// when #131 lands. Page-side code (fixtures, recorder source) is
// framework-neutral on purpose so only the launcher needs porting.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const SOURCE_EXTENSION = path.join(ROOT, 'extension', '.output', 'chrome-mv3');
const FIXTURES = path.join(__dirname, 'fixtures', 'overlay');

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Chrome refuses to load an unpacked extension from some temp-cleaner-managed
// paths, and a test must never mutate the real build output; stage a copy.
function stageExtension(): string {
  if (!fs.existsSync(path.join(SOURCE_EXTENSION, 'manifest.json'))) throw new Error(`extension build missing at ${SOURCE_EXTENSION} — run \`npm run build:ext\` first`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-overlay-e2e-ext-'));
  const copy = (from: string, to: string) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const source = path.join(from, entry.name);
      const target = path.join(to, entry.name);
      if (entry.isDirectory()) copy(source, target);
      else fs.copyFileSync(source, target);
    }
  };
  copy(SOURCE_EXTENSION, dir);
  return dir;
}

interface OverlayBrowser {
  browser: any;
  close(): Promise<void>;
}

async function launchOverlayBrowser(): Promise<OverlayBrowser> {
  const extensionDir = stageExtension();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-overlay-e2e-profile-'));
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: profileDir,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`, '--window-size=1280,960', '--no-first-run', '--no-default-browser-check'],
    defaultViewport: { width: 1280, height: 960 },
  });
  return {
    browser,
    async close() {
      await browser.close();
      fs.rmSync(extensionDir, { recursive: true, force: true });
      fs.rmSync(profileDir, { recursive: true, force: true });
    },
  };
}

// One timeline entry. `host` identifies the page element the overlay acted on
// (its control parent for add/remove, the mutated element for style), stable
// across entries so a flap — the SAME host cycling add/remove — is countable.
interface OverlayEvent {
  t: number;
  type: 'add' | 'remove' | 'style' | 'mark';
  host?: string;
  label?: string;
}

// Runs in the page before any extension code (evaluateOnNewDocument). Kept as
// a source string: it must survive the trip into the page verbatim, with no
// tooling between this file and what executes there.
const RECORDER_SOURCE = `(() => {
  const log = [];
  let hostSeq = 0;
  const hostIds = new WeakMap();
  const describe = (el) => {
    if (!hostIds.has(el)) hostIds.set(el, ++hostSeq);
    return el.tagName.toLowerCase() + '#' + hostIds.get(el);
  };
  window.__overlayRecorder = {
    mark(label) { log.push({ t: performance.now(), type: 'mark', label }); },
    take() { return log.splice(0, log.length); },
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) if (n instanceof Element && n.hasAttribute('data-hologram-overlay')) log.push({ t: performance.now(), type: 'add', host: describe(r.target) });
        for (const n of r.removedNodes) if (n instanceof Element && n.hasAttribute('data-hologram-overlay')) log.push({ t: performance.now(), type: 'remove', host: describe(r.target) });
      } else if (r.type === 'attributes' && r.target instanceof Element && !r.target.hasAttribute('data-hologram-overlay')) {
        // The overlay's only style writes to PAGE elements are the host
        // position it borrows while a control is mounted; the fixtures
        // themselves never touch style attributes, so every entry here is the
        // overlay repainting someone else's DOM.
        log.push({ t: performance.now(), type: 'style', host: describe(r.target) });
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  // ^ the Document node, NOT documentElement: this source runs at new-document
  // time, before <html> exists, and observe(null) would silently kill the
  // whole recorder (openFixture's self-check exists to catch exactly that).
})();`;

// Serves `html` at exactly `url` (everything else aborted — fixtures are
// self-contained, images are CSS-sized so a broken src has no layout effect)
// and waits out the content script's document_idle startup and first scan.
async function openFixture(overlay: OverlayBrowser, url: string, html: string): Promise<any> {
  const page = await overlay.browser.newPage();
  await page.evaluateOnNewDocument(RECORDER_SOURCE);
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.url() === url) request.respond({ status: 200, contentType: 'text/html', body: html });
    else request.abort();
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Self-check: a recorder that failed to install would make every timeline
  // assertion pass vacuously, so prove it sees a synthetic mount/unmount
  // before any test runs.
  const alive = await page.evaluate(async () => {
    const el = document.createElement('div');
    el.setAttribute('data-hologram-overlay', '');
    document.body.appendChild(el);
    el.remove();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const log = (window as any).__overlayRecorder.take();
    return log.some((e: any) => e.type === 'add') && log.some((e: any) => e.type === 'remove');
  });
  if (!alive) throw new Error('overlay recorder self-check failed: synthetic mutations were not observed');
  await wait(700); // content script's document_idle startup and first scan
  await page.evaluate(() => (window as any).__overlayRecorder.take()); // drop startup noise
  return page;
}

function fixtureHtml(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, `${name}.html`), 'utf8');
}

async function takeLog(page: any): Promise<OverlayEvent[]> {
  return page.evaluate(() => (window as any).__overlayRecorder.take());
}

// Wheel-scrolls with the pointer held where it is. `jitterPx` adds the few
// pixels of drift a real hand produces between wheel notches — the difference
// matters because pointermove is the overlay's only hover input.
async function wheelScroll(page: any, options: { from: { x: number; y: number }; steps: number; deltaY?: number; stepMs?: number; jitterPx?: number }): Promise<void> {
  const { from, steps, deltaY = 120, stepMs = 40, jitterPx = 0 } = options;
  let x = from.x;
  for (let i = 0; i < steps; i++) {
    if (jitterPx) {
      x += i % 2 ? jitterPx : -jitterPx;
      await page.mouse.move(x, from.y);
    }
    await page.mouse.wheel({ deltaY });
    await wait(stepMs);
  }
}

interface HostStats {
  adds: number;
  removes: number;
  styles: number;
}

interface LogSummary {
  adds: number;
  removes: number;
  styles: number;
  byHost: Map<string, HostStats>;
  // Hosts whose control was mounted more than once in the window: the
  // signature of flicker, as opposed to distinct pictures passing under a
  // moving pointer (each of those mounts once).
  flapping: string[];
}

function summarize(events: OverlayEvent[]): LogSummary {
  const byHost = new Map<string, HostStats>();
  let adds = 0;
  let removes = 0;
  let styles = 0;
  for (const event of events) {
    if (event.type === 'mark' || !event.host) continue;
    let stats = byHost.get(event.host);
    if (!stats) {
      stats = { adds: 0, removes: 0, styles: 0 };
      byHost.set(event.host, stats);
    }
    if (event.type === 'add') {
      adds += 1;
      stats.adds += 1;
    } else if (event.type === 'remove') {
      removes += 1;
      stats.removes += 1;
    } else {
      styles += 1;
      stats.styles += 1;
    }
  }
  const flapping = [...byHost].filter(([, stats]) => stats.adds >= 2).map(([host]) => host);
  return { adds, removes, styles, byHost, flapping };
}

function formatTimeline(events: OverlayEvent[]): string {
  return events.map((event) => `${event.t.toFixed(1).padStart(9)}ms  ${event.type}${event.host ? ` ${event.host}` : ''}${event.label ? ` ${event.label}` : ''}`).join('\n');
}

module.exports = { launchOverlayBrowser, openFixture, fixtureHtml, takeLog, wheelScroll, summarize, formatTimeline, wait };

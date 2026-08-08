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
const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./lib-extension-e2e.cts');
const { sleep } = require('./lib-wait.cts');

const FIXTURES = path.join(__dirname, 'fixtures', 'overlay');

interface OverlayBrowser {
  browser: any;
  close(): Promise<void>;
}

async function launchOverlayBrowser(options: { locale?: string } = {}): Promise<OverlayBrowser> {
  // A host name that is deliberately never registered, and unique per run. Without
  // it the staged extension keeps talking to `com.hologram.host`, which on a
  // development machine IS installed — the installer registers it for Chromium as
  // well as Chrome (native-host/install.mts) — so pressing save reached the real
  // host while the same run on a clean machine could not, and the two disagreed
  // about which failure the overlay should report. Failing at "host not found" is
  // the same on every machine, and the user's installed host is left alone.
  const extensionDir = stageExtension({
    tempPrefix: 'hologram-overlay-e2e-ext-',
    nativeHostName: `com.hologram.host.overlay_e2e_${process.pid}`,
  });
  const session = await launchExtensionBrowser({
    extensionDir,
    headless: true,
    viewport: { width: 1280, height: 960 },
    locale: options.locale,
    args: ['--window-size=1280,960'],
  });
  return {
    browser: session.context,
    async close() {
      await session.close();
      fs.rmSync(extensionDir, { recursive: true, force: true });
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

// Runs in the page before any extension code (addInitScript). Kept as
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
  await page.addInitScript({ content: RECORDER_SOURCE });
  await page.route('**/*', async (route: any) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url() === url) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    } else {
      await route.abort();
    }
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
    // The two entries are the post-condition. Polled by frame rather than waited
    // out: MutationObserver delivers on a microtask checkpoint, and take()
    // splices, so the entries are accumulated instead of re-read.
    let sawAdd = false;
    let sawRemove = false;
    for (let i = 0; i < 60 && !(sawAdd && sawRemove); i++) {
      for (const entry of (window as any).__overlayRecorder.take()) {
        if (entry.type === 'add') sawAdd = true;
        if (entry.type === 'remove') sawRemove = true;
      }
      if (!(sawAdd && sawRemove)) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return sawAdd && sawRemove;
  });
  if (!alive) throw new Error('overlay recorder self-check failed: synthetic mutations were not observed');
  // Fixed on purpose: the content script's document_idle startup and first scan
  // put NOTHING in the page — the overlay only draws once a pointer moves — so
  // there is no post-condition to wait on. Waiting for a control instead would
  // mean hovering first, which is the thing every caller is here to measure.
  // biome-ignore lint/plugin: the content script's startup draws nothing to wait on
  await sleep(700);
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
    await page.mouse.wheel(0, deltaY);
    // The gap between notches IS the input being simulated: a hand's wheel comes
    // in paced notches, and the overlay's settle timer reacts to that pacing.
    await sleep(stepMs);
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

// `wait` used to be exported from here and was the only shared wait in the Node
// half of these tests; it lives in lib-wait.cts now (#986), so callers that need
// a delay require `sleep` from there directly.
module.exports = { launchOverlayBrowser, openFixture, fixtureHtml, takeLog, wheelScroll, summarize, formatTimeline };

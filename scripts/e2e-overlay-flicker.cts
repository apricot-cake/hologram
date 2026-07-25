'use strict';

// Temporal regression test for the timeline hover control (#347). Flicker is
// repeated mount/unmount OVER TIME — invisible to the before/after checks in
// e2e-overlay-visual.cts — so this drives scroll sessions over platform-shaped
// feeds (x / bluesky / pixiv fixtures) and asserts the overlay's DOM timeline
// stays quiet:
//
//   hover        — the save button appears on hover, including through the
//                  sibling overlay that covers the picture on Bluesky/pixiv
//                  (the #338 regression shape).
//   still-scroll — wheel scrolling with a STATIONARY pointer mounts nothing:
//                  pointermove is the only hover input, so pictures passing
//                  under a resting pointer must not grow controls.
//   drift-scroll — wheel scrolling with the few px of pointer drift a real
//                  hand produces may retarget to new pictures (each mounts
//                  once), but no picture may flap (mount twice), and the
//                  overlay may not churn style writes on page elements —
//                  the "image blinking" symptom.
//   leave        — pointer moved to blank page: every control is gone.
//
//   node scripts/e2e-overlay-flicker.cts [x|bluesky|pixiv ...] [--verbose]
//
// Build the extension first (`npm run test:overlay-flicker` does both). On a
// failure the phase's event timeline is printed; that timeline, not the
// pass/fail bit, is the debugging artifact for the fix loop.

const { launchOverlayBrowser, openFixture, fixtureHtml, takeLog, wheelScroll, summarize, formatTimeline, wait } = require('./lib-overlay-e2e.cts');

// Mirrors overlay.ts's SCROLL_HOVER_SETTLE_MS; waits must outlast it.
const SETTLE_MS = 100;

const PLATFORMS: Record<string, { url: string; image: string }> = {
  x: { url: 'https://x.com/home', image: '[data-testid="tweetPhoto"]' },
  bluesky: { url: 'https://bsky.app/', image: '.thumbwrap img' },
  pixiv: { url: 'https://www.pixiv.net/', image: '.card img' },
};

interface CheckResult {
  platform: string;
  check: string;
  ok: boolean;
  detail: string;
  timeline: string;
}

const results: CheckResult[] = [];
const verbose = process.argv.includes('--verbose');
const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const platforms = requested.length ? requested : Object.keys(PLATFORMS);
for (const name of platforms) if (!PLATFORMS[name]) throw new Error(`unknown platform ${name} (expected: ${Object.keys(PLATFORMS).join(', ')})`);

function report(platform: string, check: string, ok: boolean, detail: string, timeline = '') {
  results.push({ platform, check, ok, detail, timeline });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${platform}:${check} — ${detail}`);
  if (timeline && (verbose || !ok)) console.log(timeline.replace(/^/gm, '    '));
}

async function overlayCount(page: any): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('[data-hologram-overlay]').length);
}

// Center of the Nth fixture image — the hover target. Re-read after every
// layout change; boxes move when the page scrolls.
async function imageCenter(page: any, selector: string, index: number): Promise<{ x: number; y: number }> {
  const handles = await page.$$(selector);
  if (handles.length <= index) throw new Error(`fixture has no ${selector} #${index}`);
  const box = await handles[index].boundingBox();
  if (!box) throw new Error(`${selector} #${index} has no layout box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function runPlatform(overlay: any, name: string): Promise<void> {
  const spec = PLATFORMS[name];
  const page = await openFixture(overlay, spec.url, fixtureHtml(name));
  try {
    // --- hover: the save button appears (through the sibling overlay on
    // bluesky/pixiv — the pointer physically lands on that sibling there).
    const target = await imageCenter(page, spec.image, 1);
    await page.mouse.move(target.x, target.y);
    let hoverOk = true;
    let hoverDetail = 'save button appeared on hover';
    try {
      await page.waitForSelector('button[data-hologram-overlay]', { timeout: 3000 });
    } catch {
      hoverOk = false;
      hoverDetail = 'no save button within 3s of hovering the picture';
    }
    report(name, 'hover', hoverOk, hoverDetail, formatTimeline(await takeLog(page)));
    if (!hoverOk) return; // scroll phases would only repeat the same failure

    // --- still-scroll: stationary pointer, 12 wheel notches. pointermove is
    // the overlay's only hover input, so nothing may mount; the one hovered
    // control may be cleared (settle or occlusion), nothing more.
    await takeLog(page);
    await wheelScroll(page, { from: target, steps: 12, deltaY: 120, stepMs: 50 });
    await wait(SETTLE_MS + 250);
    const stillEvents = await takeLog(page);
    const still = summarize(stillEvents);
    const leftovers = await overlayCount(page);
    const stillOk = still.adds === 0 && still.removes <= 1 && leftovers === 0;
    report(name, 'still-scroll', stillOk, `adds=${still.adds} removes=${still.removes} styleWrites=${still.styles} leftovers=${leftovers} (want adds=0 removes<=1 leftovers=0)`, formatTimeline(stillEvents));

    // --- drift-scroll: same scroll with 2px pointer drift between notches.
    // Retargeting to new pictures is by design (one mount each); the SAME
    // picture mounting twice is flicker, and style churn on page elements
    // (the borrowed host position) is the image-blink symptom.
    await page.evaluate(() => window.scrollTo(0, 0));
    await wait(SETTLE_MS + 400);
    const retarget = await imageCenter(page, spec.image, 1);
    await page.mouse.move(retarget.x, retarget.y);
    await page.waitForSelector('button[data-hologram-overlay]', { timeout: 3000 });
    await takeLog(page);
    await wheelScroll(page, { from: retarget, steps: 12, deltaY: 120, stepMs: 50, jitterPx: 2 });
    await wait(SETTLE_MS + 250);
    const driftEvents = await takeLog(page);
    const drift = summarize(driftEvents);
    const churny = [...drift.byHost].filter(([, s]) => s.styles > 2).map(([host]) => host);
    const driftOk = drift.flapping.length === 0 && churny.length === 0;
    report(name, 'drift-scroll', driftOk, `adds=${drift.adds} flapping=[${drift.flapping.join(', ')}] styleChurn=[${churny.join(', ')}] (want no flapping, <=2 style writes per host)`, formatTimeline(driftEvents));

    // --- leave: pointer on blank page margin clears everything.
    await page.mouse.move(30, 400);
    await wait(SETTLE_MS + 250);
    const left = await overlayCount(page);
    report(name, 'leave', left === 0, `controls after leaving the feed: ${left} (want 0)`);
  } finally {
    await page.close();
  }
}

(async () => {
  const overlay = await launchOverlayBrowser();
  try {
    for (const name of platforms) await runPlatform(overlay, name);
  } finally {
    await overlay.close();
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`FAIL e2e-overlay-flicker: ${failed.length}/${results.length} checks failed (${failed.map((r) => `${r.platform}:${r.check}`).join(', ')})`);
    process.exit(1);
  }
  console.log(`PASS e2e-overlay-flicker: ${results.length} checks over ${platforms.join(', ')}`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

'use strict';

// Temporal regression test for the timeline hover control (#347). Flicker is
// repeated mount/unmount OVER TIME — invisible to the before/after checks in
// e2e-overlay-visual.cts — so this drives scroll sessions over platform-shaped
// feeds (x / bluesky / pixiv fixtures) and asserts the overlay's DOM timeline
// stays quiet:
//
//   hover        — the save button appears on hover, including through the
//                  sibling overlay that covers the picture on Bluesky/pixiv
//                  (the #338 regression shape); the hovered picture's own
//                  rect must not collapse while the control is mounted (the
//                  "image blinks" half of #347 — confirmed live on bsky.app:
//                  overlay.ts borrowed position:relative on the <img>'s bare,
//                  unsized parent, which silently became its containing
//                  block and collapsed it to 0 height).
//   jiggle-scroll — the wheel rocked back and forth over one picture (reading
//                  a long post) never takes the button away: the picture stays
//                  under the pointer the whole time, and hover is decided by
//                  that geometry, not by the fact that a scroll happened.
//   re-render    — the feed swapping the hovered picture's element for a fresh
//                  one (a virtualized timeline re-rendering as you scroll) hands
//                  the button to the new element, it does not drop it.
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

// The save FACE, asked for by name rather than by element type. Since #310 the
// element in the page's subtree is the shadow host (<hologram-corner-control>);
// the <button> is inside its shadow root, so `button[data-hologram-overlay]` —
// what this used to wait for — can no longer match anything. `data-hologram-face`
// is on the host for exactly this reason: the face's own wording follows the
// browser locale and is not something a test can wait on.
const SAVE_FACE = '[data-hologram-overlay][data-hologram-face="save"]';

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
  const box = await imageRect(page, selector, index);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function imageRect(page: any, selector: string, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const handles = await page.$$(selector);
  if (handles.length <= index) throw new Error(`fixture has no ${selector} #${index}`);
  const box = await handles[index].boundingBox();
  if (!box) throw new Error(`${selector} #${index} has no layout box`);
  return box;
}

async function runPlatform(overlay: any, name: string): Promise<void> {
  const spec = PLATFORMS[name];
  const page = await openFixture(overlay, spec.url, fixtureHtml(name));
  try {
    // --- hover: the save button appears (through the sibling overlay on
    // bluesky/pixiv — the pointer physically lands on that sibling there).
    const restRect = await imageRect(page, spec.image, 1);
    const target = await imageCenter(page, spec.image, 1);
    await page.mouse.move(target.x, target.y);
    let hoverOk = true;
    let hoverDetail = 'save button appeared on hover';
    try {
      await page.waitForSelector(SAVE_FACE, { timeout: 3000 });
    } catch {
      hoverOk = false;
      hoverDetail = 'no save button within 3s of hovering the picture';
    }
    report(name, 'hover', hoverOk, hoverDetail, formatTimeline(await takeLog(page)));
    if (!hoverOk) return; // scroll phases would only repeat the same failure

    // --- no-collapse: the picture's own box must be unchanged while the
    // control is mounted. overlay.ts borrows position:relative on the box's
    // host to place the control; if that host turns out to already be the
    // box's containing block source point (an absolutely-positioned <img>
    // whose real containing block sits further up, past a bare, unsized
    // parent), the borrow silently redefines it and the picture collapses.
    const hoveredRect = await imageRect(page, spec.image, 1);
    const collapsed = hoveredRect.width < restRect.width * 0.9 || hoveredRect.height < restRect.height * 0.9;
    report(name, 'no-collapse', !collapsed, `picture rect at rest ${restRect.width}x${restRect.height}, while hovered ${hoveredRect.width}x${hoveredRect.height} (want unchanged)`);

    // --- jiggle-scroll: stationary pointer, wheel rocked down/up in small
    // notches so the picture ends where it started and never leaves the
    // pointer. Nothing may unmount — the removal that used to happen here was
    // the settle timer clearing the hover on the mere fact of a scroll (#347).
    await takeLog(page);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, i % 2 ? -40 : 40);
      await wait(60);
    }
    await wait(SETTLE_MS + 250);
    const jiggleEvents = await takeLog(page);
    const jiggle = summarize(jiggleEvents);
    const jiggleRect = await imageRect(page, spec.image, 1);
    const onPicture = target.x >= jiggleRect.x && target.x <= jiggleRect.x + jiggleRect.width && target.y >= jiggleRect.y && target.y <= jiggleRect.y + jiggleRect.height;
    const kept = await overlayCount(page);
    // onPicture is a precondition, not a result: a fixture whose picture drifts
    // out from under the pointer would make the rest of the check vacuous.
    report(name, 'jiggle-scroll', onPicture && jiggle.removes === 0 && kept === 1, `pointerOnPicture=${onPicture} adds=${jiggle.adds} removes=${jiggle.removes} controls=${kept} (want pointerOnPicture=true removes=0 controls=1)`, formatTimeline(jiggleEvents));

    // --- re-render: the feed swaps the hovered picture's element for an
    // identical fresh one (what a virtualized timeline does while you scroll)
    // without the pointer moving. The picture never left the pointer, so the
    // button must end up on the new element instead of waiting for a mouse
    // jiggle.
    await takeLog(page);
    await page.evaluate((selector: string) => {
      const box = document.querySelectorAll(selector)[1];
      if (!box) return;
      const fresh = box.cloneNode(true) as Element;
      // The page's own re-render produces its own markup; it does not carry
      // the overlay's control over, and a clone that did would leave a second
      // control behind and make this check measure the fixture, not the code.
      for (const stale of fresh.querySelectorAll('[data-hologram-overlay]')) stale.remove();
      box.replaceWith(fresh);
    }, spec.image);
    await wait(SETTLE_MS + 400);
    const rerenderEvents = await takeLog(page);
    const rerender = summarize(rerenderEvents);
    const rehomed = await overlayCount(page);
    report(name, 're-render', rehomed === 1 && rerender.flapping.length === 0, `controls=${rehomed} adds=${rerender.adds} flapping=[${rerender.flapping.join(', ')}] (want controls=1, no flapping)`, formatTimeline(rerenderEvents));
    // Re-establish the hover on the new element for the phases below (the
    // pointer has not moved, so Playwright's own state is already there).
    await page.mouse.move(target.x + 2, target.y);
    await page.mouse.move(target.x, target.y);
    await wait(200);

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
    await page.waitForSelector(SAVE_FACE, { timeout: 3000 });
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

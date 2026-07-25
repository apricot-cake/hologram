'use strict';

// Offline pure-unit test for extension/utils/overlay.ts — the timeline overlay: the
// "saved" mark (#54, shown per the three-value setting of #309) and the hover
// save button (#94). Runs the BUILT content scripts inside jsdom with the same
// globals a real injection gives them (glass-ui.js, site-detect.js and
// media-identity.js evaluated first, in manifest order, into the same window)
// and a stubbed chrome API.
//
// What this covers is the script's own wiring: which posts get asked about, that
// they are asked in ONE batch, that the answer plus the settings decide what the
// corner shows, that the save button appears only where a save would be honest,
// that pressing it sends the SAME message a drag-drop sends, and that the layer
// never touches the post's own subtree. What it CANNOT cover is whether the
// per-platform selectors still match the real X / Bluesky / pixiv DOM — the
// fixtures are our own markup, so they only ever prove our code reads what we
// wrote (same limit as test-content-fixtures.cts; the live canary is
// scripts/e2e-capture-test.cts).
//
//   node scripts/test-overlay-unit.cts

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DIST = path.join(__dirname, '..', 'extension', '.output', 'chrome-mv3');

let pass = 0;
let fail = 0;
const check = (label, cond) => {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL   ${label}`);
  }
};

// X posts in the shapes overlay.js's x branch targets. data-rect-top declares a
// media box's geometry (jsdom lays nothing out); data-rect-size narrows it.
const X_HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="100"><img src="https://pbs.twimg.com/media/AAA.jpg"></div>
    </article>
    <article data-testid="tweet" id="p2">
      <a href="/bob/status/222"><time datetime="2026-07-01T00:00:00Z">2h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="400"><img src="https://pbs.twimg.com/media/BBB.jpg"></div>
    </article>
    <!-- p3's photo has no size yet (no data-rect-top): a lazy image below the
         fold, which is how a real timeline answers a post before its picture
         has laid out. -->
    <article data-testid="tweet" id="p3">
      <a href="/carol/status/333"><time datetime="2026-07-01T00:00:00Z">3h</time></a>
      <div data-testid="tweetPhoto"><img id="lazy" src="https://pbs.twimg.com/media/CCC.jpg"></div>
    </article>
    <!-- Two pictures in one post: the save button acts on ONE image, so each
         box is its own anchor. -->
    <article data-testid="tweet" id="p4">
      <a href="/dave/status/444"><time datetime="2026-07-01T00:00:00Z">4h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="1200" id="p4a"><img src="https://pbs.twimg.com/media/DDD.jpg"></div>
      <div data-testid="tweetPhoto" data-rect-top="1600" id="p4b"><img src="https://pbs.twimg.com/media/EEE.jpg"></div>
    </article>
    <!-- Not a post picture (profile_images = an avatar) and a box too small to
         be the point of the post: both must refuse to offer a save. -->
    <article data-testid="tweet" id="p5">
      <a href="/erin/status/555"><time datetime="2026-07-01T00:00:00Z">5h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="2000" id="p5a"><img src="https://pbs.twimg.com/profile_images/FFF.jpg"></div>
    </article>
    <article data-testid="tweet" id="p6">
      <a href="/frank/status/666"><time datetime="2026-07-01T00:00:00Z">6h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="2400" data-rect-size="60" id="p6a"><img src="https://pbs.twimg.com/media/GGG.jpg"></div>
    </article>
    <!-- Media-tab tile (/<user>/media grid): no article/testid wrapper at
         all — a bare <li> several ancestors above its own /status/ anchor,
         which itself wraps the <img> directly (#349). -->
    <li id="p7">
      <div><div><div>
        <a href="/gina/status/777/photo/1"><img data-rect-top="2800" src="https://pbs.twimg.com/media/HHH.jpg"></a>
      </div></div></div>
    </li>
    <!-- A video tile of the SAME post (777): its thumbnail lives on a
         different CDN path, so the current post-image judgment must keep it
         silent even once the post reads as saved via its photo tile above. -->
    <li id="p8">
      <div><div><div>
        <a href="/gina/status/777/video/2"><img data-rect-top="3200" src="https://pbs.twimg.com/amplify_video_thumb/III.jpg"></a>
      </div></div></div>
    </li>
  </div>
</body></html>`;

// runScripts:'outside-only' gives the window a real script context for
// window.eval below (the page's own <script>s stay inert — the fixture has none).
const dom = new JSDOM(X_HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
const { window } = dom;

// --- browser bits jsdom doesn't implement, stubbed to the minimum overlay.js uses.
// jsdom lays nothing out (every rect is zero, which overlay.js correctly reads as
// "too small to mark"), so the fixture declares its own geometry: an element with
// data-rect-top is a square media box at that offset, everything else is zero.
const animatedElements = new Set<any>();
window.Element.prototype.animate = function () {
  animatedElements.add(this);
  return { cancel() {}, finish() {} };
};
window.Element.prototype.getBoundingClientRect = function () {
  const declared = this.getAttribute?.('data-rect-top');
  if (declared === null || declared === undefined) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  const top = Number(declared);
  const size = Number(this.getAttribute('data-rect-size') || 300);
  return { left: 50, top, right: 50 + size, bottom: top + size, width: size, height: size, x: 50, y: top };
};
const animationFrames = new Map<number, any>();
let nextAnimationFrame = 1;
window.requestAnimationFrame = (fn) => {
  const id = nextAnimationFrame++;
  animationFrames.set(id, fn);
  return id;
};
window.cancelAnimationFrame = (id) => animationFrames.delete(id);

// Worth knowing before adding a listener assertion here: jsdom does NOT put the
// Window in the propagation path of an event dispatched on an element, so a
// capture-phase listener registered on `window` never fires under this harness
// even though it does in a browser. Listen on `document` (as overlay.js's load
// and pointer handlers do) or the test silently proves nothing.

// IntersectionObserver: the test drives visibility by hand.
let ioCallback: any = null;
const observed = new Set<any>();
window.IntersectionObserver = class {
  constructor(cb) {
    ioCallback = cb;
  }
  observe(el) {
    observed.add(el);
  }
  unobserve(el) {
    observed.delete(el);
  }
  disconnect() {
    observed.clear();
  }
} as any;
const intersect = (ids, isIntersecting) => ioCallback(ids.map((id) => ({ target: window.document.getElementById(id), isIntersecting })));

// chrome API stub. `sent` records every message so the test can assert both that
// checkSaved batched instead of asking once per post, and that the save button
// reuses the drag path's imageDragged message rather than inventing one.
const sent: any[] = [];
let savedAnswer: Record<string, string | null> = {};
let saveReply: any = { ok: true, metaOk: true };
const storage: Record<string, unknown> = {};
const storageListeners: any[] = [];
const runtimeListeners: any[] = [];
window.chrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined,
    sendMessage: (msg, cb) => {
      sent.push(msg);
      if (msg.type === 'imageDragged') {
        cb?.(saveReply);
        return;
      }
      const results = {};
      for (const u of msg.urls || []) results[u] = Object.hasOwn(savedAnswer, u) ? savedAnswer[u] : null;
      cb?.({ ok: true, results });
    },
    onMessage: { addListener: (fn) => runtimeListeners.push(fn) },
  },
  storage: {
    local: {
      // Real chrome.storage.local.get takes a key OR a list of keys; overlay.js
      // reads both of its settings in one call.
      get: (keys, cb) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) out[k] = storage[k];
        cb(out);
      },
      set: (obj) => Object.assign(storage, obj),
    },
    onChanged: { addListener: (fn) => storageListeners.push(fn) },
  },
} as any;
const setSetting = (key, value) => {
  storage[key] = value;
  for (const fn of storageListeners) fn({ [key]: { newValue: value } }, 'local');
};

// The resident content-script bundle is the exact WXT output Chrome loads.
const residentReady = Promise.resolve(window.eval(fs.readFileSync(path.join(DIST, 'content-scripts', 'resident.js'), 'utf8')));

const controls = (): any[] => Array.from(window.document.querySelectorAll('[data-hologram-overlay]'));
// The resident bundle carries its own localized strings. jsdom defaults to an
// English locale, so these are the browser-visible labels rather than source keys.
const marks = () => controls().filter((el) => el.title === 'Saved in Hologram');
const saveButtons = () => controls().filter((el) => el.title === 'Save image');
const settle = () => new Promise((r) => setTimeout(r, 400)); // past the 300ms query debounce
// overlay.js decides what the pointer is over by COORDINATES (a real
// pointermove always carries clientX/clientY), not by which element the event
// fired on — so a mark/button shows even when the site stacks its own control
// over the picture. The harness mirrors that: aim at the media box's center.
const boxOf = (id) => {
  const el = window.document.getElementById(id);
  if (el.matches('[data-testid="tweetPhoto"]')) return el;
  const testIdBox = el.querySelector('[data-testid="tweetPhoto"]');
  if (testIdBox) return testIdBox;
  return el.querySelector('img'); // media-tab li: the <img> itself is the box
};
const controlOf = (id) => controls().filter((el) => el.parentElement === boxOf(id));
const pointerMove = (target, x, y) => {
  const e: any = new window.Event('pointermove', { bubbles: true });
  e.clientX = x;
  e.clientY = y;
  target.dispatchEvent(e);
};
const hover = (id) => {
  const box = boxOf(id);
  const r = box.getBoundingClientRect();
  pointerMove(box, r.left + r.width / 2, r.top + r.height / 2);
};
const hoverAway = () => pointerMove(window.document.getElementById('feed'), 900, 50); // right of every box → over nothing
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

(async () => {
  await residentReady;
  check('every post is observed after the initial scan', observed.size === 8);

  // --- only the visible posts are asked about, and in one batch ---
  savedAnswer = { 'https://x.com/alice/status/111': '1780000000000-aa' };
  intersect(['p1', 'p2'], true);
  await settle();
  check('one batched query, not one per post', sent.length === 1);
  check('the batch carried both permalinks', sent[0].urls.length === 2 && sent[0].urls.includes('https://x.com/alice/status/111') && sent[0].urls.includes('https://x.com/bob/status/222'));
  check(
    'the extension sent permalinks, not normalized keys',
    sent[0].urls.every((u) => u.startsWith('https://x.com/')),
  );

  // --- the default is always: the saved answer is on screen unasked ---
  check('a saved post is marked with no pointer anywhere near it', marks().length === 1 && marks()[0].parentElement === boxOf('p1'));
  setSetting('savedBadgeMode', 'hover');
  check('switching to hover clears the resting mark', controls().length === 0);
  hover('p1');
  check('hovering the saved post shows its mark', marks().length === 1);
  check('the mark is positioned inside the saved post’s photo', marks()[0].parentElement === boxOf('p1') && marks()[0].style.left === '6px' && marks()[0].style.top === '6px');
  check('the media box becomes the control’s positioning parent', (boxOf('p1') as any).style.position === 'relative');
  check('the control is interactive', (marks()[0] as any).style.pointerEvents !== 'none');
  // The control is in the media box, so scrolling moves them in the same
  // composited operation: no new coordinate write is needed. And scrolling
  // WITHIN the picture — the wheel rocked back and forth while reading — is
  // not the picture leaving the pointer, so the control may not go away (#347).
  window.document.querySelector('#p1 [data-testid="tweetPhoto"]').setAttribute('data-rect-top', '40');
  window.dispatchEvent(new window.Event('scroll'));
  check('a visible control stays attached to its media while scrolling', marks()[0]?.parentElement === boxOf('p1') && marks()[0].style.top === '6px' && animationFrames.size === 0);
  await new Promise((r) => setTimeout(r, 120)); // past the scroll settle
  check('scrolling within the hovered picture keeps its control', marks()[0]?.parentElement === boxOf('p1'));

  // Scrolled far enough that p1 leaves the pointer and p2 arrives under it.
  // The control goes with p1; a stationary pointer must not select p2 merely
  // because p2 scrolled underneath it.
  window.document.querySelector('#p1 [data-testid="tweetPhoto"]').setAttribute('data-rect-top', '-300');
  window.document.querySelector('#p2 [data-testid="tweetPhoto"]').setAttribute('data-rect-top', '100');
  window.dispatchEvent(new window.Event('scroll'));
  // Pointer Events requires this boundary event when layout moves p2 under a
  // stationary pointer. It must not count as a deliberate hover movement.
  const layoutBoundary: any = new window.Event('pointerover', { bubbles: true });
  layoutBoundary.clientX = 200;
  layoutBoundary.clientY = 250;
  boxOf('p2').dispatchEvent(layoutBoundary);
  check('a stationary pointer does not select the next picture after scroll', controlOf('p2').length === 0);
  await new Promise((r) => setTimeout(r, 120));
  check('the control of a picture scrolled off the pointer clears', controls().length === 0);
  window.document.querySelector('#p1 [data-testid="tweetPhoto"]').setAttribute('data-rect-top', '100');
  window.document.querySelector('#p2 [data-testid="tweetPhoto"]').setAttribute('data-rect-top', '400');
  hoverAway();
  check('the mark goes away with the pointer', controls().length === 0);

  // --- the regression this file exists to guard: a pointer that physically
  //     lands on a FOREIGN element stacked over the picture (Bluesky's ALT/overlay
  //     div, pixiv's bookmark heart) still counts as hovering the picture, because
  //     detection is by coordinates, not by walking up from what was hit. Fire the
  //     event on #feed (neither the box nor a descendant) with coords inside p1's box.
  const p1box = boxOf('p1').getBoundingClientRect();
  pointerMove(window.document.getElementById('feed'), p1box.left + p1box.width / 2, p1box.top + p1box.height / 2);
  check('a pointer over a foreign overlay on the picture still hovers it', marks().length === 1);
  hoverAway();

  // --- "always" puts it on screen unconditionally; "off" means off ---
  setSetting('savedBadgeMode', 'always');
  check('the always setting marks the saved post with no pointer', marks().length === 1);
  setSetting('savedBadgeMode', 'off');
  check('the off setting shows nothing at all', controls().length === 0);
  hover('p1');
  check('the off setting is not overridden by hovering', marks().length === 0);
  hoverAway();
  setSetting('savedBadgeMode', 'hover');

  // --- an answered post is not asked about again when it scrolls back ---
  intersect(['p1', 'p2'], false);
  await settle();
  intersect(['p1'], true);
  await settle();
  check('no second query for an already-answered post', sent.length === 1);
  hover('p1');
  check('the mark comes back from the cached answer', marks().length === 1);
  hoverAway();

  // --- the save button: immediate on an unsaved post ---
  intersect(['p2'], true);
  await settle();
  hover('p2');
  check('pointing at an unsaved picture immediately offers to save it', saveButtons().length === 1);
  check(
    'the save action is a still monochrome glyph-only native button with an accessible name',
    saveButtons()[0].tagName === 'BUTTON' && saveButtons()[0].style.width === '28px' && saveButtons()[0].style.background === 'rgba(20, 22, 26, 0.76)' && saveButtons()[0].getAttribute('aria-label') === 'Save image' && saveButtons()[0].textContent === '' && !animatedElements.has(saveButtons()[0]),
  );
  saveButtons()[0].dispatchEvent(new window.Event('pointerenter'));
  check('hover distinguishes the monochrome save action without adding a state color', saveButtons()[0].style.background === 'rgba(255, 255, 255, 0.1)' && saveButtons()[0].style.transform === 'scale(1.04)');
  saveButtons()[0].dispatchEvent(new window.Event('pointerleave'));

  // --- pressing it sends the message drag-and-drop sends, not a new one ---
  click(saveButtons()[0]);
  const save = sent[sent.length - 1];
  check('the press reused the drag save path', save.type === 'imageDragged' && save.platform === 'x');
  check('it saved the post the picture belongs to', save.postUrl === 'https://x.com/bob/status/222');
  check('it offered the original-size URL as well as the thumbnail', save.imageUrls.includes('https://pbs.twimg.com/media/BBB.jpg') && save.imageUrls.some((u) => u.includes('name=orig')));
  check('the corner answers the press with the saved mark', marks().length === 1 && saveButtons().length === 0);
  hoverAway();
  hover('p2');
  check('the post now reads as saved, so it is no longer offered', saveButtons().length === 0 && marks().length === 1);
  hoverAway();

  // --- a failed save says so and returns to a button, so it can be retried ---
  saveReply = { ok: false, hostMissing: true };
  intersect(['p4'], true);
  await settle();
  hover('p4a');
  await settle();
  click(saveButtons()[0]);
  const failed = controlOf('p4a');
  check('a failed save is reported in place, saying why', failed.length === 1 && failed[0].title === "Can't reach Hologram's saver. Please restart Chrome.");
  const before = sent.length;
  click(failed[0]);
  check('pressing the failure retries instead of doing nothing', sent.length === before + 1 && sent[sent.length - 1].type === 'imageDragged');
  await new Promise((r) => setTimeout(r, 2700)); // past the failure's dwell
  check('the failure clears back to a button to retry', saveButtons().length === 1);
  saveReply = { ok: true, metaOk: true };
  hoverAway();

  // --- one button per picture, and one mark per post ---
  hover('p4b');
  await settle();
  check('the post’s second picture offers its own button', saveButtons().length === 1 && saveButtons()[0].parentElement === boxOf('p4b'));
  hoverAway();
  savedAnswer['https://x.com/dave/status/444'] = '1780000000004-dd';
  intersect(['p4'], false);
  await settle();
  intersect(['p4'], true);
  await settle();
  setSetting('savedBadgeMode', 'always');
  const p4Controls = [...controlOf('p4a'), ...controlOf('p4b')];
  check('a saved multi-image post is marked once, on its first picture', p4Controls.length === 1 && p4Controls[0].parentElement === boxOf('p4a'));
  // The corner that failed earlier now says "saved", not what went wrong then.
  check('the old failure text does not outlive the failure', p4Controls[0]?.title === 'Saved in Hologram');
  setSetting('savedBadgeMode', 'hover');

  // --- the gates: an honest save, or no button ---
  intersect(['p5', 'p6'], true);
  await settle();
  hover('p5');
  await settle();
  check('an avatar is never offered as the post’s picture', controls().length === 0);
  hoverAway();
  hover('p6');
  await settle();
  check('a picture too small to be the point of the post is not offered', controls().length === 0);
  hoverAway();

  // --- a save made elsewhere in this tab lights the mark without a scroll ---
  savedAnswer['https://x.com/carol/status/333'] = '1780000000002-cc';
  intersect(['p3'], true);
  await settle();
  for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/carol/status/333' });
  window.document.querySelector('#p3 [data-testid="tweetPhoto"]').setAttribute('data-rect-top', '800');
  hover('p3');
  check('a savedUpdate push marks the post immediately', marks().length === 1 && marks()[0].parentElement === boxOf('p3') && marks()[0].style.top === '6px');
  hoverAway();

  // --- turning the button off leaves the mark alone ---
  setSetting('hoverSaveButton', false);
  hover('p6');
  await settle();
  check('with the button off, an unsaved picture offers nothing', controls().length === 0);
  hoverAway();
  hover('p1');
  check('the mark still works with the button off', marks().length === 1);
  hoverAway();
  setSetting('hoverSaveButton', true);

  // --- media-tab grid tiles (#349): a bare <li>, no article/testid wrapper.
  //     For an <img> box the control mounts on its immediate parent (the
  //     <a> that wraps it here), same as every other <img>-boxed platform. ---
  intersect(['p7', 'p8'], true);
  await settle();
  hover('p7');
  await settle();
  check('an unsaved media-tab image tile offers to save it', saveButtons().length === 1 && saveButtons()[0].parentElement === boxOf('p7').parentElement);
  hoverAway();
  hover('p8');
  await settle();
  const p8Controls = controls().filter((el) => el.parentElement === boxOf('p8') || el.parentElement === boxOf('p8').parentElement);
  check('a video tile (different CDN path) gets no control at all', p8Controls.length === 0);
  hoverAway();
  hover('p7');
  await settle();
  click(saveButtons()[0]);
  const gridSave = sent[sent.length - 1];
  check('pressing a grid tile’s save reused the drag save path', gridSave.type === 'imageDragged' && gridSave.platform === 'x');
  check('the photo/N suffix was normalized off the permalink', gridSave.postUrl === 'https://x.com/gina/status/777');
  check('the grid tile now reads as saved', marks().length === 1 && marks()[0].parentElement === boxOf('p7').parentElement);
  hoverAway();
  // p8 is the SAME post's video tile (777) — now that the post is saved via
  // its photo tile, p8 must still stay silent rather than inherit the mark.
  hover('p8');
  const p8ControlsAfterSave = controls().filter((el) => el.parentElement === boxOf('p8') || el.parentElement === boxOf('p8').parentElement);
  check('a saved sibling image does not paint a mark onto the video tile', p8ControlsAfterSave.length === 0);
  hoverAway();

  console.log(fail === 0 ? `PASS test-overlay-unit: ${pass} checks` : `FAIL test-overlay-unit: ${fail} of ${pass + fail} checks failed`);
  process.exit(fail === 0 ? 0 : 1);
})();

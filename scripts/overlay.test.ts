// extension/utils/overlay.ts = the offline pure unit test for the timeline overlay (shows
// the "saved" mark from #54 broken out by the three-value setting from #309, and shows the
// hover save button from #94).
// Runs the built content script inside jsdom, under the same globals as an actual injection
// (glass-ui.js / site-detect.js / media-identity.js evaluated in the same window, in manifest
// order) and a stubbed chrome API.
//
// What this covers is the script's own wiring: which posts it queries, whether that's a single
// batch, whether the answer and setting decide the corner's display, whether the save button
// only appears where it can "honestly save", whether pressing it sends the same message as
// drag & drop, and whether it leaves the post's own subtree untouched.
// What it does NOT cover is whether the per-platform selectors actually match the real X /
// Bluesky / pixiv DOM (the fixtures are hand-written markup, so this can only prove that it can
// read what it wrote itself. Same limitation as content-fixtures.test.ts; the live canary is
// scripts/e2e-capture-test.cts).
//
// This suite drives a single page in sequence, so the declaration order of the tests matters.
//
// Prerequisite: needs the extension's build output (extension/.output/chrome-mv3/...).

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asUser } from './lib-user-event.ts';

// The shape of post the x branch in overlay.ts targets. data-rect-top declares the media
// box's geometry (jsdom lays nothing out), and data-rect-size narrows its size.
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
    <!-- p3's photo doesn't have a size yet (no data-rect-top) = a lazy-loaded image below the
         fold. The same situation as when the real timeline answers about a post before the
         image has been laid out. -->
    <article data-testid="tweet" id="p3">
      <a href="/carol/status/333"><time datetime="2026-07-01T00:00:00Z">3h</time></a>
      <div data-testid="tweetPhoto"><img id="lazy" src="https://pbs.twimg.com/media/CCC.jpg"></div>
    </article>
    <!-- 2 images on 1 post: the save button acts on a single image, so each box has its own anchor -->
    <article data-testid="tweet" id="p4">
      <a href="/dave/status/444"><time datetime="2026-07-01T00:00:00Z">4h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="1200" id="p4a"><img src="https://pbs.twimg.com/media/DDD.jpg"></div>
      <div data-testid="tweetPhoto" data-rect-top="1600" id="p4b"><img src="https://pbs.twimg.com/media/EEE.jpg"></div>
    </article>
    <!-- Something that isn't the post's image (profile_images = avatar), and a box too small
         to be called the post's subject. Neither should offer to save. -->
    <article data-testid="tweet" id="p5">
      <a href="/erin/status/555"><time datetime="2026-07-01T00:00:00Z">5h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="2000" id="p5a"><img src="https://pbs.twimg.com/profile_images/FFF.jpg"></div>
    </article>
    <article data-testid="tweet" id="p6">
      <a href="/frank/status/666"><time datetime="2026-07-01T00:00:00Z">6h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="2400" data-rect-size="60" id="p6a"><img src="https://pbs.twimg.com/media/GGG.jpg"></div>
    </article>
    <!-- A media-tab tile (the /<user>/media grid): no article, no testid, just a bare <li>
         a few levels above its own /status/ anchor. The anchor directly wraps the <img> (#349). -->
    <li id="p7">
      <div><div><div>
        <a href="/gina/status/777/photo/1"><img data-rect-top="2800" src="https://pbs.twimg.com/media/HHH.jpg"></a>
      </div></div></div>
    </li>
    <!-- The video tile of the same post (777): its thumbnail lives at a different CDN path,
         so even after the post gets marked saved via the photo tile above, this one must stay silent. -->
    <li id="p8">
      <div><div><div>
        <a href="/gina/status/777/video/2"><img data-rect-top="3200" src="https://pbs.twimg.com/amplify_video_thumb/III.jpg"></a>
      </div></div></div>
    </li>
    <!-- A video post whose playback has started (#450): X swaps the poster <img> out for a
         <video poster> and never swaps it back, so any hoverable video post is always in this shape. -->
    <article data-testid="tweet" id="p9">
      <a href="/heidi/status/999"><time datetime="2026-07-01T00:00:00Z">9h</time></a>
      <div data-testid="videoPlayer" data-rect-top="3600" id="p9a"><video poster="https://pbs.twimg.com/amplify_video_thumb/999/img/JJJ.jpg"></video></div>
    </article>
    <!-- Another 2-image post. Covers the case where the library can answer down to "which
         image it has" (#334) = p4 is on the "post is saved, image unknown" side, and since a post
         that already has an answer is never queried again (the design that makes scrolling back
         free), this can only be tested with a different post. -->
    <article data-testid="tweet" id="p10">
      <a href="/ivan/status/1010"><time datetime="2026-07-01T00:00:00Z">10h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="4000" id="p10a"><img src="https://pbs.twimg.com/media/KKK.jpg"></div>
      <div data-testid="tweetPhoto" data-rect-top="4400" id="p10b"><img src="https://pbs.twimg.com/media/LLL.jpg"></div>
    </article>
    <!-- A post that exists solely to test "the image saved but the post's info couldn't be
         fetched" (partial). It needs to stay unsaved until the end, so no other describe touches it. -->
    <article data-testid="tweet" id="p11">
      <a href="/judy/status/1111"><time datetime="2026-07-01T00:00:00Z">11h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="4800" id="p11a"><img src="https://pbs.twimg.com/media/MMM.jpg"></div>
    </article>
    <!-- #576: a post dedicated to testing the wiring gap where only hover-save was missing
         the host version-skew notice (#205). For the same reason as p11, marking it saved makes
         the save button disappear, so no other describe touches it until the end of this test. -->
    <article data-testid="tweet" id="p12">
      <a href="/kevin/status/1212"><time datetime="2026-07-01T00:00:00Z">12h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="5200" id="p12a"><img src="https://pbs.twimg.com/media/NNN.jpg"></div>
    </article>
    <!-- Also #576: the case where no false alarm fires when the version matches (hostSkew: null)
         is checked with an unsaved image other than p12, since p12 gets marked saved by the test above. -->
    <article data-testid="tweet" id="p13">
      <a href="/laura/status/1313"><time datetime="2026-07-01T00:00:00Z">13h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="5600" id="p13a"><img src="https://pbs.twimg.com/media/OOO.jpg"></div>
    </article>
    <!-- A text-only post (#575): the shape where mediaIn returns nothing. Both the post
         element itself and the avatar have their own geometry = the mark is anchored on the
         post element and placed at the avatar's bottom-left. -->
    <article data-testid="tweet" id="p14" data-rect-top="6000" data-rect-size="120">
      <div data-testid="Tweet-User-Avatar" data-rect-top="6012" data-rect-left="66" data-rect-size="40" id="p14avatar"></div>
      <a href="/kim/status/1414"><time datetime="2026-07-01T00:00:00Z">14h</time></a>
    </article>
    <!-- #594: a tab orphaned by an extension update. Teardown can't be undone (the overlay
         never draws again), so this post is only touched by the last describe in this file. -->
    <article data-testid="tweet" id="p15">
      <a href="/mia/status/1515"><time datetime="2026-07-01T00:00:00Z">15h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="6400" id="p15a"><img src="https://pbs.twimg.com/media/PPP.jpg"></div>
    </article>
    <!-- A small timeline picture behind the viewer. Its rectangle crosses the
         viewer picture at the hover point, but the open dialog covers it. -->
    <article data-testid="tweet" id="p17">
      <a href="/olivia/status/1717"><time datetime="2026-07-01T00:00:00Z">17h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="9100" data-rect-left="250" data-rect-size="100" id="p17a"><img src="https://pbs.twimg.com/media/RRR.jpg"></div>
    </article>
  </div>
    <!-- #659: the photo viewer (lightbox). An independent modal layer outside the article,
         where data-testid="swipe-to-dismiss" wraps the slide currently being shown (verified
         against the real DOM 2026-07-31).
         viewerDialog has no data-rect-top by default = zero rect = treated as "not open" and
         ignored. Each test explicitly activates and cleans up the open state via rectTop().
         top is 8900-9500 = values that don't overlap any other post's rect (the highest being
         p15's 6400-6700). Since this harness's coordinates are the data-rect-top declaration
         itself rather than real layout, an overlap would make anchorAtPoint()'s "same area,
         first one wins" rule pick the non-viewer element instead
         (this surfaced as a collision with p1's 100-400, and while debugging it looked like
         modalCovers() was wrongly returning true — it was actually just picking up p1). -->
    <!-- #704: swipe-to-dismiss is the swipe hit target and much larger than the image on real
         X. Keep the wrapper deliberately larger and offset from the image so the corner test
         proves that the control is placed at the image, not the wrapper; equal-size fixture
         geometry would let this overlap regression pass undetected. -->
    <div role="dialog" aria-modal="true" id="viewerDialog">
      <div data-testid="swipe-to-dismiss" data-rect-top="8900" data-rect-size="600" id="p16">
        <img data-rect-top="9000" data-rect-left="150" src="https://pbs.twimg.com/media/QQQ.jpg?format=jpg&amp;name=large">
      </div>
      <button aria-label="Close" data-rect-top="9010" data-rect-left="160" data-rect-size="36"></button>
    </div>
</body></html>`;

// runScripts:'outside-only' gives the window.eval below a real script context
// (the page's own <script> stays inert. Not present in the fixture anyway)
const dom = new JSDOM(X_HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
const { window } = dom;

const animatedElements = new Set<any>();
const animationFrames = new Map<number, any>();
const observed = new Set<any>();
const sent: any[] = [];
const storage: Record<string, unknown> = {};
const storageListeners: any[] = [];
const runtimeListeners: any[] = [];
let ioCallback: any = null;
// Same shape as the host's response (#334) = a captureId per post, plus that post's saved images.
// media empty = "saved, image unknown", and the overlay treats it as the post as a whole.
type SavedEntry = { id: string; media: Array<string | null> };
let savedAnswer: Record<string, SavedEntry | null> = {};
let saveReply: any = { ok: true, metaOk: true };

const intersect = (ids: string[], isIntersecting: boolean) => ioCallback(ids.map((id) => ({ target: window.document.getElementById(id), isIntersecting })));
const setSetting = (key: string, value: unknown) => {
  storage[key] = value;
  for (const fn of storageListeners) fn({ [key]: { newValue: value } }, 'local');
};

// The small controls stay in the post's subtree (#44 hasn't moved them to a fixed layer,
// because that would break scroll-following and the host's stacking order), so they can still
// be picked up straight from the plain document. What's picked up is the host element
// `<hologram-corner-control>`, and the circle itself lives inside its ShadowRoot
// (#310 = stays in the subtree while being isolated from host CSS).
const controls = (): any[] => Array.from(window.document.querySelectorAll('[data-hologram-overlay]'));
// From the host element to the circle. Every test that checks appearance, tab order, or the
// accessible name goes through this side.
const disc = (el: any): any => el?.shadowRoot?.firstElementChild ?? el;
const labelOf = (el: any): string | null => disc(el)?.getAttribute('aria-label');
// Meanwhile, the top banner that reports failures lives in the shared ShadowRoot (ui-root.ts).
const saveBanners = (): any[] => Array.from((window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot?.querySelectorAll('[data-hologram-save-banner]') || []);
// A face is identified by the host element's data-hologram-face (#310) = you can ask "which
// face is it" without depending on localized copy. The copy itself is checked by other tests.
const marks = () => controls().filter((el) => el.getAttribute('data-hologram-face') === 'mark');
const saveButtons = () => controls().filter((el) => el.getAttribute('data-hologram-face') === 'save');
const settle = () => new Promise((r) => setTimeout(r, 400)); // clears the 300ms query debounce

// overlay.ts decides what the pointer is over by "coordinates" (a real pointermove always
// carries clientX/clientY). It doesn't decide by which element the event happened on = the mark
// or button still shows even if the site's own controls are layered over the image. The harness
// matches this and aims for the center of the media box.
const MEDIA_BOX = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]';
const boxOf = (id: string) => {
  const el = window.document.getElementById(id);
  if (el.matches(MEDIA_BOX)) return el;
  return el.querySelector(MEDIA_BOX) || el.querySelector('img') || el; // in a media-tab li the <img> itself is the box; for a text-only post (#575) the post element itself is the box
};
const controlOf = (id: string) => controls().filter((el) => el.parentElement === boxOf(id));
const pointerMove = (target: any, x: number, y: number) => {
  const e: any = new window.Event('pointermove', { bubbles: true });
  e.clientX = x;
  e.clientY = y;
  target.dispatchEvent(e);
};
const hover = (id: string) => {
  const box = boxOf(id);
  const r = box.getBoundingClientRect();
  pointerMove(box, r.left + r.width / 2, r.top + r.height / 2);
};
const hoverAway = () => pointerMove(window.document.getElementById('feed'), 900, 50); // further right than any box = not over anything
// #323: the save button and retry only respond to a real user press. The version the page can
// dispatch goes through pageClick, and that's used only by the guard's own test. A press is
// dispatched at the circle (inside the ShadowRoot) = an event dispatched at the host element
// doesn't enter the shadow tree, so dispatching at the host side would make it impossible to
// tell whether "pressing does nothing" is thanks to the guard or just the wrong path.
const pageClick = (el: any) => disc(el).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const click = (el: any) => disc(el).dispatchEvent(asUser(new window.MouseEvent('click', { bubbles: true })));
const rectTop = (sel: string, top: string) => window.document.querySelector(sel)?.setAttribute('data-rect-top', top);

beforeAll(async () => {
  // Fills in only the minimum browser-side parts jsdom doesn't implement that overlay.ts uses.
  // There's no layout, so every rect is zero (overlay.ts correctly reads that as "too small to
  // show a mark"), so the fixture declares its own geometry = an element with data-rect-top
  // becomes a square at that position.
  window.Element.prototype.animate = function () {
    animatedElements.add(this);
    return { cancel() {}, finish() {} };
  };
  window.Element.prototype.getBoundingClientRect = function () {
    const declared = this.getAttribute?.('data-rect-top');
    if (declared === null || declared === undefined) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    const top = Number(declared);
    const size = Number(this.getAttribute('data-rect-size') || 300);
    // data-rect-left is only declared by elements that want to shift horizontally from the
    // default 50 = things like an avatar, where the indent from the post's left edge is an
    // input to positioning (#575).
    const left = Number(this.getAttribute('data-rect-left') || 50);
    return { left, top, right: left + size, bottom: top + size, width: size, height: size, x: left, y: top };
  };
  let nextAnimationFrame = 1;
  window.requestAnimationFrame = (fn) => {
    const id = nextAnimationFrame++;
    animationFrames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => animationFrames.delete(id);

  // Note: jsdom doesn't put Window in the propagation path of events fired on an element =
  // a capture-phase listener registered on `window` is never called by this harness (it would
  // be called in a real browser). Listen on `document`, same as overlay.ts's load / pointer handlers.

  // IntersectionObserver: visibility is driven by hand by the tests
  window.IntersectionObserver = class {
    constructor(cb: any) {
      ioCallback = cb;
    }
    observe(el: any) {
      observed.add(el);
    }
    unobserve(el: any) {
      observed.delete(el);
    }
    disconnect() {
      observed.clear();
    }
  } as any;

  // Stub of the chrome API. Records every message into `sent`, to check that checkSaved goes
  // out in a batch rather than per-post, and that the save button reuses the drag path's imageDragged.
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (msg: any, cb: any) => {
        sent.push(msg);
        if (msg.type === 'imageDragged') {
          cb?.(saveReply);
          return;
        }
        const results: Record<string, SavedEntry | null> = {};
        for (const u of msg.urls || []) results[u] = Object.hasOwn(savedAnswer, u) ? savedAnswer[u] : null;
        cb?.({ ok: true, results });
      },
      onMessage: {
        addListener: (fn: any) => runtimeListeners.push(fn),
        removeListener: (fn: any) => {
          const i = runtimeListeners.indexOf(fn);
          if (i >= 0) runtimeListeners.splice(i, 1);
        },
      },
    },
    storage: {
      local: {
        // The real chrome.storage.local.get takes either a single key or a list = overlay.ts
        // reads its two settings in one call
        get: (keys: any, cb: any) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) out[k] = storage[k];
          cb(out);
        },
        set: (obj: object) => Object.assign(storage, obj),
      },
      onChanged: { addListener: (fn: any) => storageListeners.push(fn) },
    },
  } as any;

  // The resident content script bundle is the exact same CRXJS release output that Chrome reads
  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-release', 'content-scripts', 'resident.js'), 'utf8'));
}, 30000);

test('初回走査で全ての投稿が観測される', () => {
  expect(observed.size).toBe(17); // p1-p17 (added p12/p13 in #576, p14 in #575, p15 in #594, p16 in #659, p17 in #704)
});

describe('問い合わせは見えている投稿だけ・1バッチで', () => {
  beforeAll(async () => {
    savedAnswer = { 'https://x.com/alice/status/111': { id: '1780000000000-aa', media: [] } };
    intersect(['p1', 'p2'], true);
    await settle();
  });

  test('投稿ごとではなく1回のバッチ', () => {
    expect(sent).toHaveLength(1);
  });

  test('バッチが両方のパーマリンクを運ぶ', () => {
    expect(sent[0].urls.sort()).toEqual(['https://x.com/alice/status/111', 'https://x.com/bob/status/222']);
  });

  test('送るのはパーマリンクであって正規化済みキーではない', () => {
    expect(sent[0].urls.every((u: string) => u.startsWith('https://x.com/'))).toBe(true);
  });
});

describe('savedBadgeMode の三値', () => {
  test('既定の always は、ポインタがどこにも無くても保存済みを印す', () => {
    expect(marks()).toHaveLength(1);
    expect(marks()[0].parentElement).toBe(boxOf('p1'));
  });

  test('hover へ切り替えると常時の印は消える', () => {
    setSetting('savedBadgeMode', 'hover');
    expect(controls()).toHaveLength(0);
  });

  test('保存済みの投稿にポインタを乗せると印が出る', () => {
    hover('p1');
    expect(marks()).toHaveLength(1);
  });

  test('印は写真の内側に置かれ、メディア枠が位置決めの親になる', () => {
    expect(marks()[0].parentElement).toBe(boxOf('p1'));
    expect(marks()[0].style.left).toBe('6px');
    expect(marks()[0].style.top).toBe('6px');
    expect((boxOf('p1') as any).style.position).toBe('relative');
  });

  test('コントロールは操作可能（pointer-events を殺していない）', () => {
    expect((marks()[0] as any).style.pointerEvents).not.toBe('none');
  });

  // The non-pressable side of the "is this a pressable face" branch (#536). A face that only
  // reports stays a plain div = doesn't enter tab order either. It does have an accessible name
  // (as a shape stating a fact).
  test('報告するだけの印はタブ順に入らない', () => {
    expect(disc(marks()[0]).tagName).toBe('DIV');
    expect(disc(marks()[0]).tabIndex).toBe(-1);
    expect(disc(marks()[0]).getAttribute('role')).toBe('img');
  });

  // #310: the explanation isn't shown via the browser tooltip (title) = it would be a
  // different mechanism from the other faces the extension draws, and it never reached keyboard
  // or touch to begin with. Only the accessible name is kept.
  test('印は title を持たず、読み上げ名だけを持つ', () => {
    expect(marks()[0].hasAttribute('title')).toBe(false);
    expect(disc(marks()[0]).hasAttribute('title')).toBe(false);
    expect(labelOf(marks()[0])).toBe('Saved in Hologram');
  });

  // #310: stays in the subtree while isolated from host CSS = the circle lives inside the host
  // element's ShadowRoot, and the page's own CSS selectors can't reach it. The numeric check of
  // that boundary itself lives in e2e-extension-hostile-css.
  test('円はホスト要素の ShadowRoot の中にある', () => {
    expect(marks()[0].tagName.toLowerCase()).toBe('hologram-corner-control');
    expect(marks()[0].shadowRoot).toBeTruthy();
    expect(disc(marks()[0]).parentNode).toBe(marks()[0].shadowRoot);
  });
});

// Since the control lives inside the media box, it moves together with it in the same compositing
// operation during scroll = there's no need to rewrite its coordinates. And "scrolling inside the
// image" (rocking the wheel back and forth while reading) doesn't mean the image left the
// pointer, so the control must not disappear (#347)
describe('スクロール中の追従（#347）', () => {
  test('見えているコントロールはスクロール中もメディアに付いたまま', () => {
    rectTop('#p1 [data-testid="tweetPhoto"]', '40');
    window.dispatchEvent(new window.Event('scroll'));

    expect(marks()[0]?.parentElement).toBe(boxOf('p1'));
    expect(marks()[0].style.top).toBe('6px');
    expect(animationFrames.size).toBe(0);
  });

  test('ホバー中の絵の中でスクロールしてもコントロールは残る', async () => {
    await new Promise((r) => setTimeout(r, 120)); // clears scroll settling
    expect(marks()[0]?.parentElement).toBe(boxOf('p1'));
  });

  // The state of having scrolled to the point where p1 has left the pointer and p2 has come
  // in below it. The control leaves together with p1, and a stationary pointer must not select
  // p2 just because "p2 happened to move underneath it".
  test('動いていないポインタは、スクロールで下に来た次の絵を選ばない', () => {
    rectTop('#p1 [data-testid="tweetPhoto"]', '-300');
    rectTop('#p2 [data-testid="tweetPhoto"]', '100');
    window.dispatchEvent(new window.Event('scroll'));

    // When layout moves and p2 ends up under the pointer, Pointer Events requires this
    // boundary event. It must not be counted as "an intentional hover move".
    const layoutBoundary: any = new window.Event('pointerover', { bubbles: true });
    layoutBoundary.clientX = 200;
    layoutBoundary.clientY = 250;
    boxOf('p2').dispatchEvent(layoutBoundary);

    expect(controlOf('p2')).toHaveLength(0);
  });

  test('ポインタから外れて行った絵のコントロールは消える', async () => {
    await new Promise((r) => setTimeout(r, 120));
    expect(controls()).toHaveLength(0);

    rectTop('#p1 [data-testid="tweetPhoto"]', '100');
    rectTop('#p2 [data-testid="tweetPhoto"]', '400');
    hoverAway();
  });
});

// The very reason this file exists: a pointer that physically lands on "some other element"
// layered over the image (Bluesky's ALT/overlay div, pixiv's bookmark heart) must still count
// as hovering the image = the judgment is by coordinates, not by walking up from the hit
// element's parent.
test('絵の上に重なった別要素の上でも、絵をホバーしていると数える', () => {
  const p1box = boxOf('p1').getBoundingClientRect();
  // fire it on #feed (neither the box nor its descendant), keeping only the coordinates inside p1's box
  pointerMove(window.document.getElementById('feed'), p1box.left + p1box.width / 2, p1box.top + p1box.height / 2);

  expect(marks()).toHaveLength(1);
  hoverAway();
});

describe('always / off', () => {
  test('always はポインタ無しで印す', () => {
    setSetting('savedBadgeMode', 'always');
    expect(marks()).toHaveLength(1);
  });

  test('off は何も出さず、ホバーでも覆らない', () => {
    setSetting('savedBadgeMode', 'off');
    expect(controls()).toHaveLength(0);

    hover('p1');
    expect(marks()).toHaveLength(0);

    hoverAway();
    setSetting('savedBadgeMode', 'hover');
  });
});

describe('答えのキャッシュ', () => {
  test('一度答えた投稿は、戻ってきても再問い合わせしない', async () => {
    intersect(['p1', 'p2'], false);
    await settle();
    intersect(['p1'], true);
    await settle();

    expect(sent).toHaveLength(1);
  });

  test('印はキャッシュした答えから戻る', () => {
    hover('p1');
    expect(marks()).toHaveLength(1);
    hoverAway();
  });
});

describe('保存ボタン', () => {
  beforeAll(async () => {
    intersect(['p2'], true);
    await settle();
    hover('p2');
  });

  test('未保存の絵を指すと即座に保存を申し出る', () => {
    expect(saveButtons()).toHaveLength(1);
  });

  test('静止した単色グリフだけの native button で、読み上げ名を持つ', () => {
    const b = disc(saveButtons()[0]);

    expect(b.tagName).toBe('BUTTON');
    // All 4 faces (mark, save, in-progress, retry) share the same dimensions = the corner
    // doesn't shrink the instant it's pressed.
    expect(b.style.width).toBe('24px');
    expect(b.style.background).toBe('var(--hologram-control-surface)');
    // #310: the shadow no longer shares with the card face, and has its own 24px-only token.
    expect(b.style.boxShadow).toBe('var(--hologram-control-shadow)');
    expect(b.getAttribute('aria-label')).toBe('Save image');
    // A pressable face must always be in tab order (#536) = since it's a glyph-only button,
    // missing either the name or focus makes it invisible to keyboard and screen readers alike.
    expect(b.tabIndex).toBe(0);
    expect(b.textContent).toBe('');
    expect(animatedElements.has(b)).toBe(false);
  });

  // #310: pressable faces don't have a title either = whether it's pressable is conveyed by the accessible name and cursor.
  test('保存ボタンも title を持たない', () => {
    expect(disc(saveButtons()[0]).hasAttribute('title')).toBe(false);
    expect(saveButtons()[0].hasAttribute('title')).toBe(false);
    expect(disc(saveButtons()[0]).style.cursor).toBe('pointer');
  });

  test('ホバーは状態色を足さずに見分けをつける', () => {
    const b = disc(saveButtons()[0]);
    b.dispatchEvent(new window.Event('pointerenter'));

    // Not a state color, only the face color + halo + scale-up. The key point is that it
    // stays semi-transparent even on hover = matched to the same opacity as the saved mark
    // (user's call, 2026-07-29), so snapping back to opaque on hover would defeat the point of
    // seeing through to the photo.
    expect(b.style.background).toBe('var(--hologram-control-surface-hover)');
    expect(b.style.transform).toBe('scale(1.04)');

    b.dispatchEvent(new window.Event('pointerleave'));
  });

  // #323: this corner is placed inside the page's own DOM (a child of the image = a caveat
  // noted in ui-root.ts), so a page-side script can find it and click it. Since pressing it
  // triggers a save with no confirmation whatsoever, nothing should happen unless it's a real user press.
  test('ページが投げた合成クリックでは保存しない（#323）', () => {
    const before = sent.length;
    pageClick(saveButtons()[0]);

    expect(sent.slice(before)).toHaveLength(0);
    expect(saveButtons()).toHaveLength(1); // still just offering to save = doesn't even enter in-progress
  });

  describe('押したとき', () => {
    let save: any;

    beforeAll(() => {
      click(saveButtons()[0]);
      save = sent.at(-1);
    });

    test('ドラッグ保存の経路を再利用する（新しいメッセージを作らない）', () => {
      expect(save).toMatchObject({ type: 'imageDragged', platform: 'x' });
    });

    test('絵が属する投稿を保存する', () => {
      expect(save.postUrl).toBe('https://x.com/bob/status/222');
    });

    test('サムネだけでなく原寸の URL も渡す', () => {
      expect(save.imageUrls).toContain('https://pbs.twimg.com/media/BBB.jpg');
      expect(save.imageUrls.some((u: string) => u.includes('name=orig'))).toBe(true);
    });

    test('角は押下に保存済みの印で答える', () => {
      expect(marks()).toHaveLength(1);
      expect(saveButtons()).toHaveLength(0);
    });

    test('成功したホバー保存は上部バナーを出さない', () => {
      expect(saveBanners()).toHaveLength(0);
    });

    test('保存済みになったので、もう申し出ない', () => {
      hoverAway();
      hover('p2');

      expect(saveButtons()).toHaveLength(0);
      expect(marks()).toHaveLength(1);
      hoverAway();
    });
  });
});

describe('保存に失敗したとき', () => {
  let failed: any[];

  beforeAll(async () => {
    saveReply = { ok: false, errorKind: 'host-unavailable', error: 'Error when communicating with the native messaging host.' };
    intersect(['p4'], true);
    await settle();
    hover('p4a');
    await settle();
    click(saveButtons()[0]);
    failed = controlOf('p4a');
  });

  // #310: the 24px circle only says "press to retry". The longer recovery guidance (pointing
  // to the diagnostics page) stays as-is on the banner, which has both room and role="alert".
  test('角は再試行できることを言い、復旧案内は載せない', () => {
    expect(failed).toHaveLength(1);
    expect(labelOf(failed[0])).toBe('Save failed. Press to retry');
    expect(labelOf(failed[0])).not.toContain('diagnostics');
    expect(failed[0].hasAttribute('title')).toBe(false);
    expect(disc(failed[0]).hasAttribute('title')).toBe(false);
  });

  test('上部バナーも読める文面で、生のエラーを漏らさない', () => {
    const banners: any[] = saveBanners();

    expect(banners).toHaveLength(1);
    expect(banners[0].getAttribute('role')).toBe('alert');
    expect(banners[0].textContent).toBe("Hologram's saver could not start. Open the diagnostics page from the extension settings.");
    expect(banners[0].textContent).not.toContain('Error when communicating');
  });

  // Retry is the only means of "recovering right there on the spot with a single press", so a
  // state reachable only by pointer is a missing recovery mechanism in itself (#536). Its name
  // is dedicated copy that includes the word "retry" (#310).
  test('再試行の面は保存ボタンと同じくキーボードで到達でき、読み上げ名を持つ', () => {
    expect(disc(failed[0]).tagName).toBe('BUTTON');
    expect(disc(failed[0]).tabIndex).toBe(0);
    expect(labelOf(failed[0])).toContain('retry');
  });

  test('失敗表示を押すと何も起きないのではなく再試行する', () => {
    const before = sent.length;
    click(failed[0]);

    expect(sent).toHaveLength(before + 1);
    expect(sent.at(-1).type).toBe('imageDragged');
  });

  test('しばらくするとボタンへ戻り、やり直せる', async () => {
    await new Promise((r) => setTimeout(r, 2700)); // clears the failure display's dwell time

    expect(saveButtons()).toHaveLength(1);
    saveReply = { ok: true, metaOk: true };
    hoverAway();
  });
});

describe('絵ごとに1ボタン・投稿ごとに1印', () => {
  test('同じ投稿の2枚目も自分のボタンを持つ', async () => {
    hover('p4b');
    await settle();

    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].parentElement).toBe(boxOf('p4b'));
    hoverAway();
  });

  // An answer where the image is unknown (text-only, intake failure, a record predating #334)
  // can only speak about the post = a single mark, no button.
  test('絵の分からない保存済み投稿は、1枚目にだけ印が付く', async () => {
    savedAnswer['https://x.com/dave/status/444'] = { id: '1780000000004-dd', media: [] };
    intersect(['p4'], false);
    await settle();
    intersect(['p4'], true);
    await settle();
    setSetting('savedBadgeMode', 'always');

    const p4Controls = [...controlOf('p4a'), ...controlOf('p4b')];
    expect(p4Controls).toHaveLength(1);
    expect(p4Controls[0].parentElement).toBe(boxOf('p4a'));
  });

  // Failure copy doesn't outlive the failure. Since #310, the corner has never carried copy
  // forward in the first place (the reason is that the banner states it fully at the moment of
  // failure), so the mark always carries only its own name.
  test('印は前の失敗の文面を引きずらない', () => {
    expect(labelOf(controlOf('p4a')[0])).toBe('Saved in Hologram');
    setSetting('savedBadgeMode', 'hover');
  });
});

// #334: it's a common state for only one image of a multi-image post to be saved. As long as
// the answer reaches down to the image, the corner shows a different face per image = a mark
// for the saved one, a save button for the one that isn't yet.
describe('1枚だけ保存された投稿', () => {
  beforeAll(async () => {
    // What the library has is only the 2nd image (LLL). The URL notation is the one recorded
    // at save time (name=orig), which doesn't match the page-side src (with its extension) as
    // strings = they're matched by normalized identity instead.
    savedAnswer['https://x.com/ivan/status/1010'] = { id: '1780000000010-jj', media: ['https://pbs.twimg.com/media/LLL?format=jpg&name=orig'] };
    intersect(['p10'], true);
    await settle();
    setSetting('savedBadgeMode', 'always');
  });

  afterAll(async () => {
    setSetting('savedBadgeMode', 'hover');
    intersect(['p10'], false);
    await settle();
  });

  test('保存済みの絵にだけ印が付く（1枚目ではなく、その絵に）', () => {
    expect(controlOf('p10a')).toHaveLength(0);
    expect(controlOf('p10b')).toHaveLength(1);
    expect(labelOf(controlOf('p10b')[0])).toBe('Saved in Hologram');
  });

  test('まだの絵にはホバーで保存ボタンが出る', async () => {
    hover('p10a');
    await settle();

    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].parentElement).toBe(boxOf('p10a'));
    hoverAway();
  });

  test('保存済みの絵にホバーしてもボタンにはならない', async () => {
    hover('p10b');
    await settle();

    expect(saveButtons()).toHaveLength(0);
    expect(labelOf(controlOf('p10b')[0])).toBe('Saved in Hologram');
    hoverAway();
  });

  // A notification that one more image was added via a different path in the same tab (drag
  // save). Reading it as the whole post being saved would make the remaining images' buttons
  // disappear until the next query.
  test('savedUpdate が運ぶ絵だけが追加される', () => {
    for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/ivan/status/1010', media: ['https://pbs.twimg.com/media/KKK?format=jpg&name=orig'] });

    expect(controlOf('p10a')).toHaveLength(1);
    expect(labelOf(controlOf('p10a')[0])).toBe('Saved in Hologram');
    expect(controlOf('p10b')).toHaveLength(1);
  });
});

describe('申し出るかどうかの関門', () => {
  beforeAll(async () => {
    intersect(['p5', 'p6'], true);
    await settle();
  });

  test('アバターを投稿の絵として申し出ない', async () => {
    hover('p5');
    await settle();

    expect(controls()).toHaveLength(0);
    hoverAway();
  });

  test('投稿の主題と言うには小さすぎる絵は申し出ない', async () => {
    hover('p6');
    await settle();

    expect(controls()).toHaveLength(0);
    hoverAway();
  });
});

test('同じタブの別経路で保存されたら、スクロールを待たずに印が点く', async () => {
  savedAnswer['https://x.com/carol/status/333'] = { id: '1780000000002-cc', media: [] };
  intersect(['p3'], true);
  await settle();

  for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/carol/status/333' });
  rectTop('#p3 [data-testid="tweetPhoto"]', '800');
  hover('p3');

  expect(marks()).toHaveLength(1);
  expect(marks()[0].parentElement).toBe(boxOf('p3'));
  expect(marks()[0].style.top).toBe('6px');
  hoverAway();
});

describe('ボタンを切っても印は残る', () => {
  beforeAll(() => setSetting('hoverSaveButton', false));

  test('ボタン off では未保存の絵に何も出さない', async () => {
    hover('p6');
    await settle();

    expect(controls()).toHaveLength(0);
    hoverAway();
  });

  test('印はボタン off でも働く', () => {
    hover('p1');
    expect(marks()).toHaveLength(1);

    hoverAway();
    setSetting('hoverSaveButton', true);
  });
});

// #349: a bare <li> with no article and no testid either. When <img> is the box, the control
// is placed on the nearest parent (here, the <a> that wraps the <img>) = same as other
// platforms where <img> is the box.
describe('メディアタブのグリッドタイル（#349）', () => {
  beforeAll(async () => {
    intersect(['p7', 'p8'], true);
    await settle();
  });

  test('未保存の画像タイルは保存を申し出る', async () => {
    hover('p7');
    await settle();

    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].parentElement).toBe(boxOf('p7').parentElement);
    hoverAway();
  });

  // Until #372, video/GIF tile thumbnails didn't pass the post-media check, and this was the
  // one unresponsive spot in the grid. Now that the check includes *_video_thumb, it answers the same as photo tiles.
  test('動画タイルも保存を申し出る', async () => {
    hover('p8');
    await settle();

    const p8Controls = controls().filter((el) => el.parentElement === boxOf('p8') || el.parentElement === boxOf('p8').parentElement);
    expect(p8Controls).toHaveLength(1);
    expect(labelOf(p8Controls[0])).toBe('Save image');
    hoverAway();
  });

  describe('グリッドタイルから保存する', () => {
    let gridSave: any;

    beforeAll(async () => {
      hover('p7');
      await settle();
      click(saveButtons()[0]);
      gridSave = sent.at(-1);
    });

    test('ドラッグ保存の経路を再利用する', () => {
      expect(gridSave).toMatchObject({ type: 'imageDragged', platform: 'x' });
    });

    test('パーマリンクから photo/N の接尾辞を落とす', () => {
      expect(gridSave.postUrl).toBe('https://x.com/gina/status/777');
    });

    test('タイルが保存済みとして読めるようになる', () => {
      expect(marks()).toHaveLength(1);
      expect(marks()[0].parentElement).toBe(boxOf('p7').parentElement);
      hoverAway();
    });

    // p8 is the video tile of the same post (777). Pressing lights up the mark on the spot
    // only in the box that was pressed (other boxes follow via savedUpdate from background)
    // = right after pressing, it's correct for it to still be offering to save.
    const p8Controls = () => controls().filter((el) => el.parentElement === boxOf('p8') || el.parentElement === boxOf('p8').parentElement);

    test('別の枠の押下だけでは、動画タイルの申し出は変わらない', () => {
      hover('p8');

      expect(p8Controls()).toHaveLength(1);
      expect(labelOf(p8Controls()[0])).toBe('Save image');
      hoverAway();
    });

    // What the mark answers is "do we have it" at the post level, so once a save is
    // notified, the video tile of the same post returns the same answer too.
    test('保存が通知されたら、同じ投稿の動画タイルも保存済みとして読める', () => {
      for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/gina/status/777' });
      hover('p8');

      expect(p8Controls()).toHaveLength(1);
      expect(labelOf(p8Controls()[0])).toBe('Saved in Hologram');
      hoverAway();
    });
  });
});

// #450: a timeline video post loses its <img> the moment the player starts moving. Even
// when the box only has a <video>, if it doesn't answer the same way using the poster as a
// clue, "a hoverable video always lacks a button" happens.
describe('再生中の動画投稿（#450）', () => {
  beforeAll(async () => {
    intersect(['p9'], true);
    await settle();
    hover('p9a');
    await settle();
  });

  test('<img> が無くても保存を申し出る', () => {
    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].parentElement).toBe(boxOf('p9a'));
  });

  test('押すと poster の URL を、その投稿のものとして渡す', () => {
    click(saveButtons()[0]);
    const save = sent.at(-1);

    expect(save).toMatchObject({ type: 'imageDragged', platform: 'x', postUrl: 'https://x.com/heidi/status/999' });
    expect(save.imageUrls).toContain('https://pbs.twimg.com/amplify_video_thumb/999/img/JJJ.jpg');
    hoverAway();
  });
});

// #310 / #367: "the save succeeded but the post's text and author couldn't be fetched" is a
// result that's neither success nor failure, and there's nowhere on the corner to say it (a
// 24px circle can't hold text). It used to go into the mark's title = it only appeared after a
// 1-second hover, and never reached keyboard or touch to begin with.
// Now it's stated in full at that moment by the banner's amber (partial). A plain success stays
// silent as before.
//
// What #367 added was making the banner two-tiered = holding failure (interrupting alert, red)
// and the caveat (non-interrupting status, amber) as separate urgency levels. The 3 tests below
// pin down that acceptance criteria as-is.
describe('投稿情報が取れなかった保存（#310・#367）', () => {
  // The shape "at the instant it enters the DOM". At this point the caveat must not have any
  // words in it yet (see below), so only looking at the finished state means breakage would go
  // unnoticed = captured right after the press.
  let born: { role: string | null; text: string; state: string };

  beforeAll(async () => {
    saveReply = { ok: true, metaOk: false, metaReason: 'protected' };
    intersect(['p11'], true);
    await settle();
    hover('p11a');
    await settle();
    click(saveButtons()[0]);
    const el: any = saveBanners().at(-1);
    born = { role: el.getAttribute('role'), text: el.textContent, state: el.dataset.state };
    await settle(); // waits out the announcement registration delay (status-surface.ts's ANNOUNCE_MS)
  });

  afterAll(() => {
    saveReply = { ok: true, metaOk: true };
    hoverAway();
  });

  // Looks at the most recent banner = since the exit animation is Web Animations, and this
  // harness stubs that out, the previous failure banner's element stays in the DOM (it would
  // disappear in a real browser).
  test('バナーが理由つきで出る', () => {
    const banner: any = saveBanners().at(-1);

    expect(banner.dataset.state).toBe('partial');
    expect(banner.textContent).toBe('Saved (post info unavailable: private account)');
  });

  // #367's two-tier urgency. The caveat is a "the save did succeed" kind of message, so it
  // doesn't interrupt speech = status. Failure (the describe above) stays alert, unchanged here.
  test('但し書きは割り込まない＝role は status（失敗の alert と分ける）', () => {
    expect(born.role).toBe('status');
    expect(born.state).toBe('partial');
  });

  // A status live region is only announced when "its content changes after being registered"
  // = inserting it into the DOM already carrying its text means nobody hears it. That would be
  // the same as when it was written into the title, just with the state #367 is trying to fix
  // moved onto the banner instead. So it enters empty and speaks afterward.
  // (alert gets special-cased by the browser and is read even inserted as-is, so failure doesn't take this path)
  test('読み上げが登録される前に喋らない＝空で入り、文はその後で入る', () => {
    const banner: any = saveBanners().at(-1);

    expect(born.text).toBe('');
    expect(banner.textContent).not.toBe('');
  });

  // A notification carrying an action must not be dismissed automatically (a screen-reader
  // user would lose the ability to reach the action) = since the caveat dismisses automatically,
  // it must not carry anything pressable. That the face which appears on every normal save
  // doesn't linger is guaranteed by this "carries nothing".
  test('但し書きは操作を持たない＝自動で消してよい面のまま', () => {
    const banner: any = saveBanners().at(-1);

    expect(banner.querySelector('button, a, [role="button"], input')).toBeNull();
    expect(banner.style.pointerEvents).toBe('none');
  });

  test('角そのものは印のまま＝長い文面を載せない', () => {
    expect(labelOf(controlOf('p11a')[0])).toBe('Saved in Hologram');
    expect(controlOf('p11a')[0].hasAttribute('title')).toBe(false);
  });
});

// #576: the "the host's version is out of sync" notice that #205 prepared was wired into
// Alt+S (capture-overlay.test.ts) and the drop zone (drag-zone.test.ts), but the third save
// exit — hover-save (this file) — never once passed it to showSaveBanner. The copy and urgency
// (partial = amber, ranking ahead of other success copy) are taken as-is from #205, same as the
// other 2 paths.
describe('ホストの版がずれているときの案内（#205 の配線漏れ・#576）', () => {
  beforeAll(async () => {
    saveReply = { ok: true, metaOk: true, grouped: 0, hostSkew: 'host-old' };
    intersect(['p12'], true);
    await settle();
    hover('p12a');
    await settle();
    click(saveButtons()[0]);
    await settle(); // the caveat face enters empty and speaks later (#367) = wait until the text arrives
  });

  afterAll(() => {
    saveReply = { ok: true, metaOk: true };
    hoverAway();
  });

  test('保存できたことと更新の要求を同時に出す', () => {
    const banner: any = saveBanners().at(-1);

    expect(banner.dataset.state).toBe('partial');
    expect(banner.textContent).toBe('Saved — please update the Hologram app (it no longer matches this extension)');
  });

  test('角そのものは印のまま＝長い文面を載せない', () => {
    expect(labelOf(controlOf('p12a')[0])).toBe('Saved in Hologram');
  });
});

// No false alarm = when the version matches (or no answer has been heard from any host yet),
// it stays silent, same as any other success. The reason banner count isn't compared against an
// absolute 0 is a quirk of this harness = StatusSurface's exit disappears on Web Animations'
// finish event, but this suite's animate() stub never calls onfinish (unlike drag-zone.test.ts,
// this file needs to observe the animation actually firing in other cases), so the banner the
// preceding describe raised stays in the DOM, unlike a real browser. So what's checked instead
// is "the banner count hasn't increased across this action" = if not a single new banner was
// added, this action can be said to have stayed silent.
//
// This is also #367's "condition under which the caveat doesn't appear" = a plain save where
// the post info is complete and the version isn't skewed says nothing beyond showing the mark.
// That the caveat is a thing that "only appears when there's something to say" is only pinned
// down by holding both the appearing side (the describe above) and the non-appearing side (here).
describe('版が一致しているときは誤警報を出さない', () => {
  let before: number;

  beforeAll(async () => {
    before = saveBanners().length;
    saveReply = { ok: true, metaOk: true, grouped: 0, hostSkew: null };
    intersect(['p13'], true);
    await settle();
    hover('p13a');
    await settle();
    click(saveButtons()[0]);
    await settle(); // also checks that a face which speaks late (#367) doesn't show up afterward
  });

  test('バナーが増えない（誤警報が出ない）', () => {
    expect(saveBanners().length).toBe(before);
  });
});

// #311: Alt+S saves exactly what chrome.tabs.captureVisibleTab sees — a real
// screenshot bakes in whatever is drawn on screen, this file's corner controls
// included, unless something hides them first. capture.ts (a separate content
// script sharing this same isolated world) does that through
// window.__hologramPrepareOverlayForCapture — the same window-global signal
// __hologramAutoCapture / __snsPostSaveCleanup already use to cross between
// the two files.
describe('撮影退避フック（#311）', () => {
  // Since this suite drives a single page start to finish, no post still has a save button
  // remaining at this point (every post has been marked saved by some describe or other). What
  // the hook looks at isn't the "mark" vs. "save button" distinction but the single shared
  // data-hologram-overlay attribute, so checking with a plain element that merely shares that
  // attribute, alongside the mark (p1), is enough to show that the button face is hidden away
  // through the same path too.
  let synthetic: any;

  beforeAll(() => {
    setSetting('savedBadgeMode', 'always'); // make sure p1's mark is showing
    synthetic = window.document.createElement('button');
    synthetic.setAttribute('data-hologram-overlay', '');
    synthetic.style.display = 'flex';
    window.document.body.appendChild(synthetic);
  });

  afterAll(() => {
    synthetic.remove();
    setSetting('savedBadgeMode', 'hover');
  });

  test('印・ボタン面の両方が画面上にある', () => {
    expect(controlOf('p1')).toHaveLength(1);
    expect(labelOf(controlOf('p1')[0])).toBe('Saved in Hologram');
    expect(synthetic.style.display).toBe('flex');
  });

  test('フックを呼ぶと両方 display:none になる', () => {
    const restore = window.__hologramPrepareOverlayForCapture?.() as () => void;

    expect(controlOf('p1')[0].style.display).toBe('none');
    expect(synthetic.style.display).toBe('none');
    restore();
  });

  test('返した復元関数で元の表示へ戻る', () => {
    const restore = window.__hologramPrepareOverlayForCapture?.() as () => void;
    restore();

    expect(controlOf('p1')[0].style.display).not.toBe('none');
    expect(synthetic.style.display).toBe('flex');
  });
});

// #575: a post where mediaIn returns nothing (no image box). The mark is anchored on the post
// element itself, placed a bit below the avatar's left edge/bottom edge. No button is shown =
// the means of saving stays with #122 (right-click menu); this Issue only answers "has it
// already been captured".
describe('テキストのみの投稿（#575）', () => {
  test('未保存の間はホバーしても何も出さない（ボタンにならない）', async () => {
    intersect(['p14'], true);
    await settle();
    hover('p14');
    await settle();

    // Only looks at p14's own box (controls() also picks up other posts' temporary face='flash').
    expect(controlOf('p14')).toHaveLength(0);
    hoverAway();
  });

  test('保存済みになるとホバーで印が出る。ボタンにはならない', async () => {
    savedAnswer['https://x.com/kim/status/1414'] = { id: '1780000000014-mm', media: [] };
    intersect(['p14'], false);
    await settle();
    intersect(['p14'], true);
    await settle();
    hover('p14');
    await settle();

    const p14Controls = controlOf('p14');
    expect(p14Controls).toHaveLength(1);
    expect(p14Controls[0].getAttribute('data-hologram-face')).toBe('mark');
    expect(labelOf(p14Controls[0])).toBe('Saved in Hologram');
  });

  // The mark sits on the avatar = the circle's center lands on the avatar's edge (the point
  // at 135° from top-left), so half of it overlaps the photo and half spills into the post's
  // padding. Anchored top-left, same as the image mark; for a 40px avatar the offset is
  // 20 - 20/sqrt(2) - 12 ~= -6 = the mirror of the image's +6.
  // Here the post element is at (50, 6000) and the avatar at (66, 6012), giving (10, 6) =
  // matches the measured x.com value (the avatar sits 16px in from the post's left edge).
  test('印の中心がアバターの左上の縁に乗る', () => {
    const [mark] = controlOf('p14');
    expect(mark.style.left).toBe('10px');
    expect(mark.style.top).toBe('6px');
  });

  // What it's sitting on top of is a link to the profile on every platform. If the
  // unpressable mark swallowed that corner, it would take away one of the page's own controls.
  test('アバターのリンクを塞がない（pointer-events を通す）', () => {
    expect(controlOf('p14')[0].style.pointerEvents).toBe('none');
    hoverAway();
  });
});

// #659: X's photo viewer (lightbox). An independent modal layer outside the article; the old
// modalIsOpen() was "block across the board if any modal is open", so hovering here was always
// hidden — because the viewer itself was "the modal that's open". modalCovers narrows this down
// to "block only when a modal not containing the anchor is visible", and adds the viewer's unit
// (swipe-to-dismiss) to unitSelector.
describe('写真ビューア（拡大表示）でもホバー保存が出る（#659）', () => {
  const viewerBox = () => window.document.getElementById('p16') as any;
  // #704: メディア box は実体の <img>（ラッパーではない）。ホバーも画像の矩形を狙う。
  const viewerImg = () => viewerBox().querySelector('img') as any;
  const hoverViewer = () => {
    const img = viewerImg();
    const r = img.getBoundingClientRect();
    pointerMove(img, r.left + r.width / 2, r.top + r.height / 2);
  };

  afterAll(async () => {
    dom.reconfigure({ url: 'https://x.com/home' });
    window.document.getElementById('viewerDialog')?.removeAttribute('data-rect-top');
    intersect(['p16', 'p17'], false);
    hoverAway();
    await settle();
  });

  test('URL が /photo/N でない間は絵として申し出ない', async () => {
    intersect(['p16'], true);
    await settle();
    hoverViewer();
    await settle();

    expect(controlOf('p16')).toHaveLength(0);
    hoverAway();
  });

  describe('ビューアを開いた状態（URL が /photo/N・ダイアログが可視）', () => {
    beforeAll(async () => {
      dom.reconfigure({ url: 'https://x.com/nina/status/1616/photo/1' });
      rectTop('#viewerDialog', '0');
      // The URL and the dialog's rect are read lazily by mediaIn/modalCovers —
      // neither change is itself a DOM mutation the MutationObserver above
      // watches (data-rect-top isn't in its attributeFilter, and there is no
      // navigation event in jsdom), so nothing re-runs syncAnchors on its own.
      // An intersection flip is what the real IntersectionObserver would also
      // fire once the viewer actually mounts its slide.
      intersect(['p16'], false);
      intersect(['p16'], true);
      intersect(['p17'], true);
      await settle();
    });

    test('ビューアの画像がユニットとして解決され、ホバーで保存ボタンが出る', async () => {
      hoverViewer();
      await settle();

      expect(saveButtons()).toHaveLength(1);
      // controlHost() の IMG 分岐＝mount 先は img.parentElement（ラッパー自身）。
      // 「どこに置かれて見えるか」は下の位置テストが別に見る（host と矩形は別物）。
      expect(saveButtons()[0].parentElement).toBe(viewerBox());
      expect(controlOf('p17a')).toHaveLength(0);
    });

    // #704: The viewer's swipe wrapper is the full-slide hit target, so its
    // corner is not the picture's corner. When X's close button overlays the
    // picture's own corner, preserve the image-relative left edge and clear it
    // vertically instead of moving to a different corner.
    test('保存ボタンは画像の左上に付き、Xの閉じるボタンと重ならない（#704）', () => {
      const [button] = saveButtons();
      const wrapper = viewerBox().getBoundingClientRect();
      const img = viewerImg().getBoundingClientRect();
      // フィクスチャの前提そのものを固定＝ラッパーと画像の角がずれていなければ
      // このテストは何も区別できていない（#659 の等サイズフィクスチャの穴）。
      expect(img.left).not.toBe(wrapper.left);
      expect(img.top).not.toBe(wrapper.top);
      expect(button.style.left).toBe(`${img.left - wrapper.left + 6}px`); // 106px = (150−50)+CONTROL_INSET
      expect(button.style.top).toBe('152px'); // Close button bottom (9010+36) − wrapper top + inset
    });

    test('押すとパーマリンクは URL の /photo/N を落とした投稿になる（ドラッグ保存経路を再利用）', () => {
      click(saveButtons()[0]);
      const save = sent.at(-1);

      expect(save).toMatchObject({ type: 'imageDragged', platform: 'x' });
      expect(save.postUrl).toBe('https://x.com/nina/status/1616');
      hoverAway();
    });

    // The flip side of narrowing the old modalIsOpen()'s blanket blocking down to "only when
    // a modal not containing the anchor is visible" = an image outside the viewer still doesn't
    // appear, covered by the open dialog, same as before (keeping #347's intent). p13 is
    // already saved by this point (savedBadgeMode: hover).
    test('ビューアの外の絵は、開いているダイアログに覆われて出ない', async () => {
      hover('p13a');
      await settle();

      expect(controlOf('p13a')).toHaveLength(0);
      hoverAway();
    });
  });
});

// #594: when the extension reloads/auto-updates, the resident script in a tab left open loses
// its connection to the extension (goes orphaned). The UI stays on the page, but calling
// `chrome.*` throws a synchronous exception.
//
// Warning: this must be the last suite in this file = teardown can't be undone. From here on
// no post has an overlay anymore.
//
// Warning: what's checked here is only the **wiring** (what happens once it's detected). "What
// state does being orphaned actually put things in" = the **premise itself** that
// `chrome.runtime.id` goes falsy and `sendMessage` throws can only ever be fabricated in
// jsdom, so it's `scripts/e2e-extension-orphan.cts`, which actually reloads the extension in a
// real browser, that measures that. If the premise changes, this suite would keep passing green regardless.
describe('拡張が更新されて孤児になったタブ（#594）', () => {
  // A stub matched to the measured reality (e2e-extension-orphan.cts) = `chrome.runtime`
  // stays, only `id` drops, and `sendMessage` and `storage` throw synchronously.
  const orphan = () => {
    const api = window.chrome as any;
    api.runtime.id = undefined;
    api.runtime.sendMessage = () => {
      throw new Error('Extension context invalidated.');
    };
    api.storage.local.get = () => {
      throw new Error('Extension context invalidated.');
    };
  };

  beforeAll(async () => {
    intersect(['p15'], true);
    await settle();
    hover('p15');
    await settle();
  });

  test('孤児になる前は普通に保存ボタンが出ている', () => {
    const [button] = controlOf('p15');

    expect(button?.getAttribute('data-hologram-face')).toBe('save');
  });

  // Back before this was fixed, this used to become an Uncaught Error, with the spinner
  // spinning until it timed out waiting for a receipt, then showing "the save didn't finish so
  // it was cancelled (restart Chrome if this repeats)" = copy that blamed a perfectly healthy
  // extension and host.
  test('孤児化した後に押しても投げず、再読み込みの案内が出る', () => {
    orphan();
    const [button] = controlOf('p15');

    expect(() => click(button)).not.toThrow();
    expect(saveBanners().map((el) => el.textContent)).toContain('The extension was updated. Please reload this page.');
  });

  test('注入した UI を自分で撤去する（残って無反応にならない）', () => {
    expect(controls()).toHaveLength(0);
  });

  test('撤去後はホバーしても二度と描かない', async () => {
    hoverAway();
    hover('p15');
    await settle();

    expect(controls()).toHaveLength(0);
  });
});

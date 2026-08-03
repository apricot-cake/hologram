// Which sites exist, and everything platform-specific about them, comes from
// the extractor registry (utils/extractor/) — this file holds no per-platform
// branch of its own (#212).
// The native-messaging contract, shared with the host that reads these messages
// (#400 — native-host/protocol.mts). A save request built here is the same
// declaration the bridge's parse produces, so a renamed or missing field is a
// compile error on this side rather than a save that fails on disk.
import { hostExtBuild, protocolSkewOf, readHostResponse, responseId } from '../../native-host/protocol.mts';
import type { CaptureMetadata, HostRequest, ProtocolSkew, SaveDraggedRequest, SaveRequest, SavedResults, TrashedEntry, TrashedResults } from '../../native-host/protocol.mts';
import { CROP_TIMEOUT_MS, NATIVE_HOST_TIMEOUT_MS, SAVED_QUERY_TIMEOUT_MS, withDeadline } from './deadline.ts';
import { NATIVE_HOST } from './native-host.ts';
import { DEV_RELOAD_QUIET_MS, DEV_RELOAD_STATE_KEY, DEV_RELOAD_WORK_MS, EXT_BUILD_ID, bulkActivity, captureActivity, createDevReloadGate, shouldReloadFor } from './dev-reload.ts';
import type { DevReloadState } from './dev-reload.ts';
import { buildBookmarkMeta, extractOgp } from './bookmark.ts';
import type { OgpResult } from './bookmark.ts';
import { mergeDomMeta } from './extractor/dom-meta.ts';
import { extractorFor, fetchPostMetadata, getHostname, highResUrlOf, isAllowedSender, mediaKeyOf } from './extractor/index.ts';
import type { DomMeta, PostRecord } from './extractor/types.ts';
import type {
  BridgeAck,
  CaptureAndSendResponse,
  CheckSavedResponse,
  ContentToBackgroundMessage,
  CropImageMessage,
  CropImageResponse,
  DumpLogsResponse,
  LogCaptureResponse,
  NotifyMessage,
  PopupActivateResponse,
  QueueStatsResponse,
  ResendQueueResponse,
  SavedEntry,
  SavedUpdateMessage,
  SaveProgressMessage,
  SaveResponse,
} from './messages.ts';
import { classifySaveFailure, saveFailureConsoleLevel } from './native-error.ts';
import { createSaveGate, saveRequestKey } from './host-budget.ts';
import { clearInjectFailure, escalationUrl, injectFailureKind, showInjectFailure } from './inject-failure.ts';
import type { InjectFailureKind } from './inject-failure.ts';
import { recordSave } from './save-history.ts';
import type { SaveLogEntry, SaveStage } from './capture-log.ts';
import { saveQueueStats, stashFailedSave, sweepSaveQueue } from './save-queue.ts';
import { installUncaughtReporting } from './uncaught-report.ts';

export function startBackground(): void {
  // --- Capture diagnostics ------------------------------------------------------
  // Fallback ring buffer for log entries that couldn't reach the native host's
  // capture.log (the host failing to launch is exactly the failure we most want
  // recorded). See logCapture / stashLogLocally / the dumpLogs handler.
  const DIAG_PREFIX = 'diaglog_';
  const DIAG_KEEP = 50;

  // How many saves may be in flight at once, and which requests are the same
  // save (#323 — host-budget.ts). One gate for all three save routes: the bound
  // is on the native host, and the host does not care which route asked.
  const saveGate = createSaveGate<any>();
  // What a refused request answers with. Not a malfunction and nothing for the
  // user to repair — the only way a person reaches it is by saving faster than
  // the host can finish, and waiting is the whole of the advice.
  const BUSY_ERROR = 'Too many saves in flight for this tab';

  // --- Reloading this extension when a new local build lands (#650) -------------
  // The rule for WHEN — and the reason any of this exists — is utils/dev-reload.ts.
  // Here is the wiring: what counts as work that a reload would destroy, how the
  // reload is actually performed.
  //
  // Everything below is inert unless this bundle was built by
  // scripts/build-extension.cts AND the native host finds that build's stamp
  // file, so a released install never reaches past noteHostBuild's first line.
  const devReloadGate = createDevReloadGate({ now: () => Date.now(), savesInFlight: () => saveGate.inFlight() });
  // The build the host last reported, when it is not the one running here.
  let pendingBuild: string | null = null;
  // The build a reload has already been spent on, restored from storage before
  // any decision is taken — see DevReloadState.attempted for what it prevents.
  let attemptedBuild: string | null = null;
  let devReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let devReloadStarted = false;

  // Read the note the previous instance left and learn which token has already
  // been tried. Started at once so a reply cannot race the loop-breaker restore.
  const devReloadRestored: Promise<void> = EXT_BUILD_ID ? restoreDevReload() : Promise.resolve();

  async function restoreDevReload(): Promise<void> {
    let state: DevReloadState | null = null;
    try {
      const got = await chrome.storage.local.get(DEV_RELOAD_STATE_KEY);
      state = (got?.[DEV_RELOAD_STATE_KEY] as DevReloadState | undefined) || null;
    } catch {
      return; // nothing to restore, and nothing that can be done about it
    }
    if (!state) return;
    attemptedBuild = state.attempted || null;
    // The attempt is remembered only while it is unproven. Once this bundle IS
    // the build that was asked for, the note has done its job and keeping it
    // would block a future build that happened to reuse the token.
    try {
      if (attemptedBuild && attemptedBuild !== EXT_BUILD_ID) await chrome.storage.local.set({ [DEV_RELOAD_STATE_KEY]: { attempted: attemptedBuild } satisfies DevReloadState });
      else {
        attemptedBuild = null;
        await chrome.storage.local.remove(DEV_RELOAD_STATE_KEY);
      }
    } catch {
      /* best effort — the in-memory copy above is what the decision reads */
    }
  }

  // Every host reply passes through here (acks, query answers, relayed-log acks
  // and failures alike), which is the whole point of stamping every reply rather
  // than only the successful ones: the carrier is whatever round trip happens to
  // be made next.
  function noteHostBuild(build: string | null): void {
    if (!EXT_BUILD_ID || !build || build === EXT_BUILD_ID) return;
    pendingBuild = build;
    maybeDevReload();
  }

  function scheduleDevReload(ms: number): void {
    if (devReloadTimer !== null) clearTimeout(devReloadTimer);
    // Capped: blockedUntil never looks further ahead than one work window, and a
    // timer beyond it would only outlive the worker that set it.
    devReloadTimer = setTimeout(
      () => {
        devReloadTimer = null;
        maybeDevReload();
      },
      Math.min(Math.max(ms, 0), DEV_RELOAD_WORK_MS) + 50,
    );
  }

  function maybeDevReload(): void {
    if (!pendingBuild || devReloadStarted) return;
    const wait = devReloadGate.blockedUntil() - Date.now();
    if (wait > 0) {
      scheduleDevReload(wait);
      return;
    }
    devReloadStarted = true;
    void devReloadRestored
      .then(async () => {
        const build = pendingBuild;
        if (!build || !shouldReloadFor(build, EXT_BUILD_ID, attemptedBuild)) return;
        // Asked again after the await: restoring the note is a round trip to
        // storage, and a save can have started inside it.
        if (devReloadGate.blockedUntil() > Date.now()) {
          scheduleDevReload(DEV_RELOAD_QUIET_MS);
          return;
        }
        await chrome.storage.local.set({ [DEV_RELOAD_STATE_KEY]: { attempted: build } satisfies DevReloadState });
        // Not written to capture.log: that line would travel through a native
        // connection this call is about to kill. The service worker console is
        // where a developer watching a reload is already looking.
        console.info(`[hologram] a newer extension build is on disk (${build}); reloading the extension`);
        chrome.runtime.reload();
      })
      .catch(() => {})
      .finally(() => {
        devReloadStarted = false;
      });
  }

  // What the pages tell the worker anyway, read a second time for #650. The
  // capture.log relay is the ONE channel on which the in-page surfaces already
  // announce themselves — a bulk run's `bulk`/`begin` and its terminal line, and
  // a capture UI closed without choosing anything (`select`/`cancel` and
  // `select`/`fail`). Reading it here means the reload gate needs no message of
  // its own and cannot fall out of step with the log a person reads afterwards.
  function noteDevReloadActivity(tabId: number | null, stage: unknown, phase: unknown): void {
    if (tabId == null) return;
    if (stage === 'bulk') {
      if (phase === 'begin') devReloadGate.begin(bulkActivity(tabId));
      else devReloadGate.end(bulkActivity(tabId));
    }
    // The user closed the capture UI, or clicked something that is not a post
    // and the UI came down with it. Either way there is no selection left to
    // interrupt.
    if (stage === 'select' && (phase === 'cancel' || phase === 'fail')) devReloadGate.end(captureActivity(tabId));
    maybeDevReload();
  }

  interface StageError extends Error {
    stage: SaveStage;
    metaReason?: string | null;
    // Filled in by SaveTrace.fail so the single catch per route can write a
    // line that ties the failure to the rest of the save and says how far it
    // got, without knowing anything about the route (#519).
    saveId?: string | null;
    captureId?: string | null;
    reached?: SaveStage[];
    // #203: set on a 'bridge' failure whose send was tagged unreachable, once
    // the stash into save-queue.ts has been attempted — true if the entry is
    // now queued for retry, false if nothing could be kept. Absent on every
    // other failure (a route this queue never covers, an answer the host
    // actually gave, a stage before 'bridge').
    queued?: boolean;
  }

  // Tag an error with the pipeline stage it failed at, so the single catch in the
  // message handler can log WHICH stage broke. select/permalink are reported by
  // content.js; capture/crop/metadata/bridge are tagged here.
  //
  // metaReason rides along for the one failure the user is not meant to repair:
  // the host refuses a save that obtained nothing (#492), and WHY the post info
  // was missing is the difference between "deleted, gone for good" and
  // "age-restricted, alive but out of this route's reach" (#505). Without it
  // the banner can only name the whole family.
  function stageError(stage: SaveStage, message: string, metaReason: string | null = null): StageError {
    const err = new Error(message) as StageError;
    err.stage = stage;
    err.metaReason = metaReason;
    return err;
  }

  interface SaveTrace {
    passed(stage: SaveStage): void;
    fail(stage: SaveStage, message: string, metaReason?: string | null): StageError;
  }

  // Open one save's thread in capture.log and hand back the two ways to write on
  // it (#519).
  //
  // The `save`/`begin` line is the point of this: it is on disk before any of
  // the waits below it can stall, so a save that never finishes is no longer
  // indistinguishable from one that never started. It costs one extra native
  // connection — Chrome spawns a host process per connection — which during a
  // bookmark-intake run means two per save instead of one. Deliberate: the
  // intake is precisely where a single stuck save used to stop everything
  // behind it (#507), so it is the last route that should keep the blind spot.
  //
  // Never awaited. The line is stamped with its own `ts` when it is created, so
  // a slow host can land it after the save's own terminal line without making
  // the order unreadable — sort by `ts`, not by position.
  function beginSave(type: 'save' | 'savePost' | 'saveDragged', ctx: { saveId: string | null; captureId: string; platform: string | null; url: string | null; tabId: number | null }): SaveTrace {
    const reached: SaveStage[] = [];
    logCapture({ stage: 'save', phase: 'begin', saveId: ctx.saveId, captureId: ctx.captureId, type, platform: ctx.platform, url: ctx.url });
    return {
      // A stage finished. Kept here for the terminal line, and pushed to the
      // page because the page is the only side still able to write a line when
      // this worker is what disappears (see SaveProgressMessage).
      passed(stage: SaveStage) {
        reached.push(stage);
        if (ctx.tabId == null || !ctx.saveId) return;
        chrome.tabs.sendMessage(ctx.tabId, { type: 'saveProgress', saveId: ctx.saveId, reached: [...reached] } satisfies SaveProgressMessage).catch(() => {});
      },
      fail(stage: SaveStage, message: string, metaReason: string | null = null) {
        const err = stageError(stage, message, metaReason);
        err.saveId = ctx.saveId;
        err.captureId = ctx.captureId;
        err.reached = [...reached];
        return err;
      },
    };
  }

  // The capture.log line for a save that ended in a throw. Written from the one
  // catch each route has, so every route reports the same fields: which stage
  // broke, which save it was, and which stages it had already cleared (#519 —
  // before this, a failure line named the stage and nothing else, so it could
  // not be tied to the save's own `begin` line except by timestamp).
  function logSaveFailure(error: StageError | undefined, ctx: { saveId: string | null; platform: string | null; host: string | null; url: string | null }) {
    logCapture(
      {
        stage: error?.stage || 'unknown',
        phase: 'fail',
        saveId: error?.saveId ?? ctx.saveId,
        captureId: error?.captureId ?? null,
        reached: error?.reached ?? [],
        platform: ctx.platform,
        host: ctx.host,
        url: ctx.url,
        error: error?.message,
      },
      true,
    );
  }

  // Start a save, join the identical one already running, or say no (#323 —
  // host-budget.ts). Shared by the three routes so the bound, and the line a
  // refusal leaves behind, cannot differ between them.
  //
  // The refusal is recorded because it is otherwise invisible: the save simply
  // did not happen, and `inFlight` is the only thing that says why. Written
  // through the coalescing queue below, so a page that provokes refusals in a
  // loop cannot turn the record of them back into a connection per line.
  function admitSave(message: { type: string; saveId?: string | null; platform: string; postUrl: string; capturedVia?: string | null }, tabId: number, host: string | null, imageUrls: readonly string[], start: () => Promise<any>): Promise<any> | null {
    // The popup's list of recent saves is written HERE, wrapped around `start`,
    // because this is the only funnel all four routes pass through and because
    // the gate JOINS an identical request rather than running it twice — a
    // joined request never reaches `start`, so wrapping it is what makes one
    // row mean one save that actually ran (#124 — save-history.ts).
    const admitted = saveGate.admit(saveRequestKey(tabId, message.type, message.postUrl, imageUrls), tabId, () => {
      const running = start();
      // Stamped when the save SETTLES, not when it started: the list is read as
      // "what has landed, most recent first", and two saves in flight together
      // can finish in the other order.
      const row = { type: message.type, platform: message.platform || null, url: message.postUrl || null, tabId, capturedVia: message.capturedVia || null };
      running.then(
        (result: any) => void recordSave({ ...row, ts: Date.now(), ok: true, captureId: result?.captureId || null }),
        (error: any) => void recordSave({ ...row, ts: Date.now(), ok: false, error: error?.message || String(error) }),
      );
      return running;
    });
    if (admitted) {
      // A save is under way on this tab (#650). The save itself is already
      // counted (the gate reads saveGate.inFlight()); what this adds is the
      // evidence that a bulk run on the tab is still alive — it saves a post a
      // second, and without this its hold would time out mid-run. Asked again
      // once the save settles, because that is the moment a reload deferred by
      // it becomes possible.
      devReloadGate.refresh(bulkActivity(tabId));
      const settled = () => {
        // The in-page capture UI's job is over once its save has answered — a
        // bulk run's is not, which is why only this one is closed here.
        devReloadGate.end(captureActivity(tabId));
        maybeDevReload();
      };
      admitted.then(settled, settled);
      // "Taken" — the page's deadline waits for this before it starts measuring
      // silence instead of absence (save-deadline.ts). Pushed HERE rather than
      // from beginSave because this is the one funnel every route passes through,
      // and because it is the only place that can answer for a save that JOINED
      // an identical one already running: a join never reaches beginSave, and the
      // running save's stage lines carry the first press's saveId.
      if (message.saveId) chrome.tabs.sendMessage(tabId, { type: 'saveProgress', saveId: message.saveId, reached: [] } satisfies SaveProgressMessage).catch(() => {});
      return admitted;
    }
    logCapture({ stage: 'save', phase: 'fail', saveId: message.saveId ?? null, type: message.type, platform: message.platform, host, url: message.postUrl, error: BUSY_ERROR, inFlight: saveGate.inFlight(tabId) }, true);
    return null;
  }

  // --- The click that did nothing (#269) ----------------------------------------
  // Which tabs have already been told, this worker's lifetime, that their last
  // press could not start. In memory on purpose: the state is "the press you
  // just made failed", which a restarted worker has no business asserting on
  // its own. The consequence of forgetting is only that the next failure is
  // treated as a first one again — a badge instead of a new tab, which is the
  // quieter of the two mistakes. See utils/inject-failure.ts for what is drawn.
  const injectFailedTabs = new Set<number>();

  // `escalate` is what #124 changed about this. #269's "open the repair page on
  // the second press in a row" exists because the press had NO surface to
  // report on — the badge was the whole vocabulary, and a second inert press
  // meant the badge had failed to be enough. A press made from the popup does
  // have a surface: the popup is open, it is being looked at, and it names the
  // reason and offers the same page as a button. Opening a tab behind it would
  // throw away the surface and take the choice at the same time. So the
  // keyboard routes keep the automatic escalation and the popup route does not
  // — the per-tab count is shared either way, so Alt+S's meaning is unchanged.
  async function alertInjectFailure(tabId: number, escalate: boolean): Promise<InjectFailureKind> {
    const kind = await injectFailureKind();
    const repeated = injectFailedTabs.has(tabId);
    injectFailedTabs.add(tabId);
    showInjectFailure(tabId, kind);
    // Second press in a row on this tab: the toolbar mark evidently was not
    // enough, so open the page that can actually resolve it.
    if (escalate && repeated) chrome.tabs.create({ url: escalationUrl(kind) }).catch(() => {});
    return kind;
  }

  // Chrome drops a tab-scoped badge and title by itself when the tab navigates
  // or closes (measured — see inject-failure.ts), so these listeners exist to
  // drop OUR memory in step with it. Without them a press on a freshly loaded
  // page would count as the second one and open a tab with no mark on screen
  // to explain it. Neither event needs the `tabs` permission.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'loading') return;
    injectFailedTabs.delete(tabId);
    // A navigating tab takes its in-page UI and any running intake with it, so
    // nothing on it is work a reload could still destroy (#650).
    devReloadGate.dropTab(tabId);
    maybeDevReload();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    injectFailedTabs.delete(tabId);
    devReloadGate.dropTab(tabId);
    maybeDevReload();
  });

  // Put the capture UI on a tab. Answers WHETHER it went up and, when it did
  // not, why (#124): the popup is the first surface able to tell the user that,
  // so the outcome has to travel back rather than only being drawn on the
  // toolbar. The keyboard routes ignore the answer — nothing is open to read it.
  async function activateOnTab(tab, auto = false, escalate = true): Promise<PopupActivateResponse> {
    // Log the attempt (and the silent non-http bail) to capture.log: an icon
    // click that "does nothing" is otherwise diagnosable only from the SW
    // DevTools console, which nobody has open when it happens.
    //
    // NO saveId, on purpose. Injecting the UI starts no save, and the two being
    // separately identifiable is the whole distinction this log was missing: an
    // `activate` line with no `save`/`begin` after it means the user opened the
    // UI and stopped (#519).
    if (!tab.id || !/^https?:/i.test(tab.url || '')) {
      logCapture({ stage: 'activate', phase: 'skip', url: tab.url || '(no url)' });
      return { ok: false, reason: 'not-http' };
    }
    // BEFORE the log line, which is itself a native round trip and therefore a
    // carrier for "a newer build is on disk" (#650). Reloading the extension
    // between here and the injection below would leave the press doing nothing
    // at all — the exact failure #269 exists to make visible.
    devReloadGate.begin(captureActivity(tab.id));
    logCapture({ stage: 'activate', phase: 'ok', host: getHostname(tab.url), url: tab.url, auto });
    try {
      // Auto capture (#362) is asked for by its OWN gesture, so the choice
      // rides in as a page-side flag rather than being inferred from the URL —
      // Alt+S has to keep meaning single-shot capture on every page, the
      // bookmarks list included. Set in a separate injection because the
      // unlisted capture entrypoint is a file, not a function: both run under
      // the same activeTab grant, in order.
      if (auto) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.__hologramAutoCapture = true;
          },
        });
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        // WXT emits the unlisted capture entrypoint with this stable filename.
        // It bundles its ESM dependencies, so activeTab injection remains one
        // script without relying on execution order between global files.
        files: ['capture.js'],
      });
      // The UI is on the page, so whatever alert an earlier press left on the
      // toolbar is answered (#269). Also the only moment a badge left behind
      // by a worker that has since been killed can be taken down.
      clearInjectFailure(tab.id);
      injectFailedTabs.delete(tab.id);
      return { ok: true };
    } catch (error) {
      console.error('Failed to inject content script:', error);
      // keepLocal: this line is the ONLY record of a click that did nothing,
      // and the diagnostics page reads the local ring buffer — a save that
      // never started has no other place to be read back from (#269).
      logCapture({ stage: 'activate', phase: 'fail', host: getHostname(tab.url), url: tab.url, error: (error as Error)?.message }, true);
      devReloadGate.end(captureActivity(tab.id)); // no UI went up, so none is owed protection
      return { ok: false, reason: await alertInjectFailure(tab.id, escalate) };
    }
  }

  // NO chrome.action.onClicked LISTENER, and this is deliberate rather than an
  // omission (#124). The action carries a default_popup now, and Chrome does
  // not fire onClicked for an action that has one ("This event will not fire if
  // the action has a popup" — chrome.action reference). A listener left here
  // would be dead code that reads to the next person as "the icon still starts
  // a save"; the popup's button is that route, through {type:'popupActivate'}
  // below.

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'activate' && command !== 'activate-auto') return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // Unchanged by the popup (#124): commands never went through onClicked, so
    // Alt+S still activates in one press and still escalates on the second
    // failure in a row — there is no open surface to say it any other way.
    // Awaited only so the listener's own promise settles with the work it
    // started; nothing reads the answer on this route.
    if (tab) await activateOnTab(tab, command === 'activate-auto');
  });

  // The popup's save button (#124). The worker finds the active tab itself
  // rather than trusting one named by the sender: the popup has no tab of its
  // own, and "the tab this popup opened over" is exactly what this query
  // returns. activeTab was granted by the gesture that opened the popup —
  // Chromium grants it in ExtensionActionRunner::RunAction BEFORE it decides
  // the action has a popup to show (read from source, 2026-08-03), so the
  // injection below is as permitted as the one Alt+S makes.
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, _sender, sendResponse) => {
    if (message.type !== 'popupActivate') return false;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => (tab ? activateOnTab(tab, message.auto === true, false) : ({ ok: false, reason: 'no-tab' } satisfies PopupActivateResponse)))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, reason: 'no-tab' } satisfies PopupActivateResponse));
    return true; // async response
  });

  // --- URL bookmark intake (#195) ------------------------------------------
  // Page right-click -> a bookmark record built from the DOM the browser
  // already rendered (OGP), never fetched — see extension/utils/bookmark.ts's
  // design comment (#195, 2026-08-02 comment is the current record). Registered
  // on every startBackground() call; a service-worker restart re-registers the
  // same id, so removeAll() first is what keeps a restart from throwing
  // "duplicate id" instead of silently leaving two.
  //
  // contexts (#195 2026-08-02 comment #1): 'page' + 'selection' + 'video' +
  // 'audio' — NOT 'link' (its target is a page never opened, so there is no DOM
  // to read OGP from, and reaching it would need the main-process fetch #195's
  // 2026-07-19 comment rejected) and NOT 'image' (#122's item). No
  // documentUrlPatterns — this shows on every site, and (like #122) that costs
  // no extra permission; contextMenus is the only one this feature adds.
  //
  // `?.` throughout: guards test doubles that model chrome.* without
  // contextMenus (background-wiring.test.ts is the one that DOES model it —
  // see its own comment for why). Real Chrome always has it once the manifest
  // permission is granted.
  const BOOKMARK_MENU_ID = 'hologram-bookmark';
  chrome.contextMenus?.removeAll(() => {
    chrome.contextMenus.create({ id: BOOKMARK_MENU_ID, title: chrome.i18n.getMessage('ctxBookmark'), contexts: ['page', 'selection', 'video', 'audio'] }, () => void chrome.runtime.lastError);
  });

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== BOOKMARK_MENU_ID || !tab?.id || !/^https?:/i.test(tab.url || '')) return;
    saveBookmarkForTab(tab).catch(() => {}); // saveBookmarkForTab itself logs a failure; nothing is left to do with a rejection here
  });

  // Gated and logged through the SAME admitSave/beginSave machinery every other
  // save route uses (#323's budget, #519's capture.log thread) — a
  // context-menu click is a save exactly like the other three, just with its
  // own way of producing metadata (DOM OGP instead of a platform API or a
  // screenshot).
  async function saveBookmarkForTab(tab): Promise<void> {
    const tabId = tab.id;
    if (tabId == null) return;
    const admitted = admitSave({ type: 'saveBookmark', platform: 'bookmark', postUrl: tab.url || '' }, tabId, getHostname(tab.url), [], () => doSaveBookmark(tab));
    if (!admitted) return; // busy — the same silent-no-op UX the other routes' busy path has
    try {
      await admitted;
    } catch (error: any) {
      // warn for the failures that are outcomes rather than malfunctions —
      // console.error piles them up in the extensions error console (#580).
      console[saveFailureConsoleLevel(classifySaveFailure(error?.message))](error);
      logSaveFailure(error, { saveId: null, platform: 'bookmark', host: getHostname(tab.url), url: tab.url || null });
    }
  }

  async function doSaveBookmark(tab): Promise<BridgeAck> {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('savePost', { saveId: null, captureId, platform: 'bookmark', url: tab.url || null, tabId: tab.id ?? null });

    let ogp: OgpResult;
    try {
      const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractOgp });
      const read = results[0]?.result;
      if (!read) throw new Error('OGP extraction returned nothing');
      ogp = read;
    } catch (err: any) {
      throw trace.fail('metadata', err?.message || 'OGP extraction threw');
    }
    trace.passed('metadata');

    // meta.platform stays null throughout (buildBookmarkMeta / the record built
    // below) — sendPlatform is null here too, so buildRecord's
    // `meta.platform || sendPlatform || null` fallback chain lands on null
    // exactly as #195's 2026-08-02 design comment #2 confirms.
    const meta = buildBookmarkMeta(ogp, tab.url || '');
    const record = buildRecord(meta, { captureId, capturedAt, postUrl: meta.url || tab.url || '', sendPlatform: null, extra: { mediaType: meta.mediaType, media: meta.media, source: 'bookmark' } });

    let ack: BridgeAck;
    try {
      ack = await sendPostToBridge(captureId, record, true, null, null);
    } catch (err: any) {
      throw trace.fail('bridge', err?.message || 'bridge save failed');
    }
    trace.passed('bridge');
    markSaved([record.url, tab.url], ack?.captureId || captureId, savedMediaUrls(ack), tab.id);
    // ついで掃き出し (#203): this save reaching the host is evidence it is reachable right now.
    triggerQueueSweep();
    await bumpRecentSave(record.url);
    return { ...ack, captureId: ack?.captureId || captureId };
  }

  // Bulk intake (#362): save a post from its permalink alone — no screenshot,
  // no DOM image needed. The platform API already carries the originals, so the
  // page only has to say WHICH post; the host downloads the media and makes the
  // first one the record's image. Answers with the outcome (the caller paces
  // itself on it) rather than pushing a notify like the capture path does.
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'savePost') return false;
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' } satisfies SaveResponse);
      return false;
    }
    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' } satisfies SaveResponse);
      return false;
    }
    const senderHost = getHostname(sender.tab.url);
    const tabId = sender.tab.id;
    const tab = sender.tab;
    const admitted = admitSave(message, tabId, senderHost, [], () => savePostByUrl(tab, message.platform, message.postUrl, message.capturedVia || null, message.saveId));
    if (!admitted) {
      sendResponse({ ok: false, errorKind: 'busy', error: BUSY_ERROR } satisfies SaveResponse);
      return false;
    }
    admitted
      .then((result) => sendResponse({ ok: true, ...result } satisfies SaveResponse))
      .catch((error) => {
        const errorKind = classifySaveFailure(error?.message);
        // warn for the failures that are outcomes rather than malfunctions —
        // console.error piles them up in the extensions error console (#580).
        console[saveFailureConsoleLevel(errorKind)](error);
        logSaveFailure(error, { saveId: message.saveId, platform: message.platform, host: senderHost, url: message.postUrl });
        sendResponse({ ok: false, errorKind, metaReason: error?.metaReason || null, error: error?.message } satisfies SaveResponse);
      });
    return true; // async response
  });

  async function savePostByUrl(tab, sendPlatform, postUrl, capturedVia, saveId: string | null = null) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('savePost', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');

    // A post with no media is still saved — the host writes its sidecar and the
    // library shows it once #365 lands (see handleSavePost). Losing it instead
    // would be permanent: X has no bookmark export to go back to.
    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      extra: { mediaType: meta.mediaType, media: meta.media, capturedVia },
    });

    const metaOk = metaFetched(meta);
    let ack: BridgeAck;
    try {
      ack = await sendPostToBridge(captureId, record, metaOk, meta.metaError || null, saveId);
    } catch (err) {
      throw trace.fail('bridge', err?.message || 'bridge save failed', meta.metaError || null);
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id);
    // ついで掃き出し (#203).
    triggerQueueSweep();
    const grouped = await bumpRecentSave(record.url);
    return { ...ack, captureId: ack?.captureId || captureId, metaOk, metaReason: meta.metaError || null, grouped, hostSkew: await skewNoteForBanner() };
  }

  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'captureAndSend') return false;

    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' } satisfies CaptureAndSendResponse);
      return false;
    }

    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' } satisfies CaptureAndSendResponse);
      return false;
    }

    const tabId = sender.tab.id;
    const senderHost = getHostname(sender.tab.url);
    const tab = sender.tab;
    // captureAndSend never carries a capturedVia (only the intake routes —
    // savePost / imageDragged — do): captureAndSave keeps its default (null).
    const admitted = admitSave(message, tabId, senderHost, [], () => captureAndSave(tab, message.rect, message.postUrl, message.platform, null, message.replaces || null, message.saveId, message.domMeta || null));
    if (!admitted) {
      chrome.tabs.sendMessage(tabId, { type: 'notify', success: false, errorKind: 'busy' } satisfies NotifyMessage).catch(() => {});
      sendResponse({ ok: false, errorKind: 'busy', error: BUSY_ERROR } satisfies CaptureAndSendResponse);
      return false;
    }
    admitted
      // captureAndSave has no return value (it notifies the content script
      // directly via notify() instead) — content.js's capturePost() never reads
      // this sendResponse either, so `ok:true` is the whole payload.
      .then(() => sendResponse({ ok: true } satisfies CaptureAndSendResponse))
      .catch((error) => {
        const errorKind = classifySaveFailure(error?.message);
        // warn for the failures that are outcomes rather than malfunctions —
        // console.error piles them up in the extensions error console (#580).
        console[saveFailureConsoleLevel(errorKind)](error);
        logSaveFailure(error, { saveId: message.saveId, platform: message.platform, host: senderHost, url: message.postUrl });
        // queued (#203): present only when the bridge send was tagged
        // unreachable and this save's stash into save-queue.ts was attempted.
        chrome.tabs.sendMessage(tabId, { type: 'notify', success: false, errorKind, queued: error?.queued } satisfies NotifyMessage).catch(() => {});
        sendResponse({ ok: false, errorKind } satisfies CaptureAndSendResponse);
      });

    return true;
  });

  async function captureAndSave(tab, rect, postUrl, sendPlatform, capturedVia: string | null = null, replaces: string | null = null, saveId: string | null = null, domMeta: DomMeta | null = null) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('save', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    // captureVisibleTab shoots the window's ACTIVE tab, not the sender — if the
    // user switched tabs in the click→capture gap, a different page would be
    // saved under this post's metadata. Verify and bail instead.
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (!active || active.id !== tab.id) throw trace.fail('capture', 'Tab changed before capture');

    let dataUrl: string;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
    } catch (err) {
      throw trace.fail('capture', err?.message || 'captureVisibleTab failed');
    }
    trace.passed('capture');

    // Bounded (#507): the answer comes from the page, and a page that navigated
    // away, froze, or tore its listener down mid-capture never sends one — this
    // await had no end, and neither did the banner still spinning over there.
    let response: CropImageResponse;
    try {
      response = await withDeadline<CropImageResponse>(chrome.tabs.sendMessage(tab.id, { type: 'cropImage', dataUrl, rect } satisfies CropImageMessage), CROP_TIMEOUT_MS, 'crop');
    } catch (err) {
      throw trace.fail('crop', err?.message || 'cropImage failed');
    }
    if (!response?.croppedDataUrl) throw trace.fail('crop', 'Cropping failed');
    trace.passed('crop');
    // `?? ''` for a data URL with no comma — the host answers an empty image with
    // 'Missing image data', exactly as it did when this sent `undefined`.
    const jpegBase64 = response.croppedDataUrl.split(',')[1] ?? '';

    // Metadata comes from the platform's API (no DOM scraping).
    // fetchPostMetadata is defined in metadata.js (imported at the top).
    // expectedHost pins the Misskey/Mastodon instance fetch to the sender tab's
    // host (SSRF guard — a hostile page can't aim the fetch at another host).
    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');

    // The SECOND source (#202), and the only place the two are ever combined:
    // whatever the page showed fills the fields the API left null, and nothing
    // else. Runs before metaFetched below, but does not change its answer —
    // metaOk keeps meaning "the platform API told us about this post", so a
    // record assembled off the screen stays a partial save. What changes is the
    // record: an age-restricted post that used to reach the host carrying
    // nothing now carries its text and its author, which is the difference
    // between a save the host refuses (#492) and a post in the library.
    const domFilled = mergeDomMeta(meta, domMeta);

    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      replaces,
      // The screenshot is the primary image; media[] (API original URLs) is what the
      // bridge downloads, then overwrites with the saved filenames.
      extra: { image: `${captureId}.jpg`, mediaType: meta.mediaType, media: meta.media || [], capturedVia, domFilled },
    });

    const metaOk = metaFetched(meta);
    // Built once so a failed send and its retry-queue stash (#203) share the
    // exact same object — 'save' is one of the two request shapes save-queue.ts
    // ever queues (see its header comment for why the third, 'savePost', is not).
    const saveReq: SaveRequest = { type: 'save', captureId, saveId, image: jpegBase64, metadata: record, metaOk, metaReason: meta.metaError || null };
    let ack: BridgeAck;
    try {
      ack = await bridgeSend(saveReq);
    } catch (err: any) {
      const failErr = trace.fail('bridge', err?.message || 'bridge save failed');
      if (err?.unreachable) failErr.queued = await stashFailedSave(saveReq, logCapture);
      throw failErr;
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id); // light this post's TL badge now
    // ついで掃き出し (#203): this save reaching the host is evidence it is reachable right now.
    triggerQueueSweep();
    // grouped = prior saves of this post this session → the banner says the save
    // merged with them (the app folds same-URL records into one card).
    const grouped = await bumpRecentSave(record.url);
    chrome.tabs.sendMessage(tab.id, { type: 'notify', success: true, metaOk, metaReason: meta.metaError || null, grouped, hostSkew: await skewNoteForBanner(), domFilled } satisfies NotifyMessage).catch(() => {});
    // The tab is told the outcome above and never reads this; it is returned so
    // the save-history row admitSave writes can carry the record's own id, the
    // way the other three routes' rows already do (#124, for #125's "open in
    // the app").
    return { ...ack, captureId: ack?.captureId || captureId };
  }

  // --- Protocol version handshake (#205) ----------------------------------------
  // That the two halves are the same generation is an ASSUMPTION: the extension
  // updates through the Chrome Web Store and the host through the desktop app's
  // own updater, so "one of them is behind" is the normal state of affairs after
  // release, not an accident. Every host reply carries the contract version it
  // was built from (native-host/protocol.mts) and this is where it is compared
  // with the one this bundle was built from.
  //
  // NOTHING IS GATED ON THE RESULT. A skew never refuses a save, never retries,
  // never changes which fields are sent, and no code below asks which version
  // answered — the save is attempted exactly as it always was and the outcome
  // carries a note about which side to update. Losing a post because a number
  // did not match is the failure this check exists to prevent, not to cause.
  //
  // Remembered on the worker rather than stored: it costs one field, a restarted
  // worker learns it again from the very next reply, and a stale answer is worse
  // than none (it would keep telling the user to update something they just did).
  let hostSkew: ProtocolSkew | null = null; // null until any host has answered

  function noteHostProtocol(version: number | null): void {
    hostSkew = protocolSkewOf(version);
  }

  // What a save's outcome should say about the pairing, or null for nothing to
  // say. `null` covers both halves matching AND no host having answered yet — a
  // save that never reached the host has its own, better, message.
  function skewNote(): ProtocolSkew | null {
    return hostSkew && hostSkew !== 'match' ? hostSkew : null;
  }

  // The same note, but ONCE PER BROWSER SESSION (#124).
  //
  // The save banner used to say this on every save, because there was nowhere
  // standing to put it — a skew is a condition of the installation, and the
  // banner was the only surface anyone looked at. The popup is that standing
  // place now, so repeating it on every save is noise about something the user
  // cannot fix mid-save.
  //
  // Not dropped from the banner entirely: someone who never opens the popup
  // would otherwise never learn their halves disagree. Once a session is the
  // smallest dose that still reaches them.
  //
  // chrome.storage.session — the same lifetime (and the same store) as the
  // grouping hint above: it lasts until the browser closes, and it must NOT
  // outlive an update that fixes the skew.
  const SKEW_NOTIFIED_KEY = 'skewNotified';

  async function skewNoteForBanner(): Promise<ProtocolSkew | null> {
    const skew = skewNote();
    if (!skew) return null;
    try {
      const got = await chrome.storage.session.get(SKEW_NOTIFIED_KEY);
      if (got?.[SKEW_NOTIFIED_KEY]) return null;
      await chrome.storage.session.set({ [SKEW_NOTIFIED_KEY]: true });
    } catch {
      // Storage unreachable: say it. Repeating the note is the recoverable
      // mistake; swallowing it is the one that leaves a mismatched pair silent.
    }
    return skew;
  }

  // Send a message to the native messaging host (which writes the sidecar + image
  // into the user's save folder) and resolve with its ack. The host is short-lived:
  // Chrome spawns it per connection, so this works even when the desktop app is not
  // running.
  // Tags an error so save-queue.ts can tell "the host never answered at all"
  // apart from "the host answered and said no" (#203). This is a MECHANISM
  // tag, not a text match — deliberately, so retry eligibility never inherits
  // native-error.ts's own narrow, Chrome-wording-brittle classification.
  function unreachableError(message: string): Error {
    return Object.assign(new Error(message), { unreachable: true });
  }

  function bridgeSend(message: HostRequest): Promise<BridgeAck> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let port: chrome.runtime.Port | null = null;

      function finish(error: Error | null, result?: any) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          port?.disconnect();
        } catch {
          /* already disconnected */
        }
        if (error) reject(error);
        else resolve(result);
      }

      try {
        port = chrome.runtime.connectNative(NATIVE_HOST);
      } catch (error: any) {
        reject(unreachableError(`Native host unavailable: ${error?.message || error}`));
        return;
      }

      timer = setTimeout(() => finish(unreachableError('Native host timed out')), NATIVE_HOST_TIMEOUT_MS);

      // Read through the shared contract rather than each caller's own idea of
      // what a reply looks like (#400): before this, "did that work?" and "whose
      // answer is this?" were each answered twice, here and in the query port
      // below, in slightly different words.
      port.onMessage.addListener((msg) => {
        const res = readHostResponse(msg);
        // Read off every reply, the failures included (#205): a host far enough
        // behind to be refusing saves is the one whose version matters most.
        noteHostProtocol(res.protocolVersion);
        // Same reason, different stamp: which local build is on disk (#650).
        noteHostBuild(res.extBuild);
        // NOT unreachableError below: the host DID answer, just with a refusal
        // (#492's post-unavailable and friends) — save-queue.ts must never
        // retry an answer that would only repeat itself (#203).
        if (res.ok) finish(null, res.ack);
        else finish(new Error(res.error));
      });

      port.onDisconnect.addListener(() => {
        finish(unreachableError(chrome.runtime.lastError?.message || 'Native host disconnected (is it installed?)'));
      });

      port.postMessage(message);
    });
  }

  // Bulk-intake save (#362): metadata only, no screenshot — the host downloads
  // the post's own media and the first one becomes the record's image.
  //
  // Deliberately the only save-request wrapper left (#203): the 'save' and
  // 'saveDragged' requests are now built directly in captureAndSave and
  // captureAndSaveDragged, because a failed send has to stash into
  // save-queue.ts's retry queue the EXACT object bridgeSend was given — this
  // request shape ('savePost') is never queued (see save-queue.ts's header),
  // so it keeps its own thin wrapper.
  function sendPostToBridge(captureId: string, record: CaptureMetadata, metaOk: boolean, metaReason: string | null, saveId: string | null) {
    return bridgeSend({ type: 'savePost', captureId, saveId, metadata: record, metaOk, metaReason });
  }

  // The pictures the host says it actually recorded for a save (positional, see
  // markSaved). Announced-but-undownloaded media is deliberately NOT counted:
  // the badge must agree with what a later query will answer, and the host
  // answers from what it wrote.
  function savedMediaUrls(ack: BridgeAck | undefined): Array<string | null> {
    return Array.isArray(ack?.media) ? ack.media.map((u: unknown) => (typeof u === 'string' && u ? u : null)) : [];
  }

  // --- "Already saved?" lookups (TL badge, #54) ---------------------------------
  // badge.js asks whether the permalinks it can see are already in the library.
  // The answer comes from the native host (which reads the library's index — it
  // works with the desktop app closed), through a port that STAYS OPEN: a timeline
  // scroll asks a few times a second, and connectNative spawns a fresh host process
  // per connection, so the per-save one-shot shape would fork a process per query.
  //
  // One port, many in-flight requests: each carries an id the host echoes back.
  // The service worker can be killed at any idle moment, taking the port with it —
  // that is fine, the next query reconnects (and a killed SW has no badges to keep
  // current anyway).
  let queryPort: chrome.runtime.Port | null = null;
  let nextQueryId = 1;
  const pendingQueries = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  function failAllPending(message: string) {
    for (const [, p] of pendingQueries) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pendingQueries.clear();
  }

  function getQueryPort(): chrome.runtime.Port {
    if (queryPort) return queryPort;
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    queryPort = port;
    port.onMessage.addListener((msg: unknown) => {
      const id = responseId(msg);
      const p = id == null ? null : pendingQueries.get(id);
      if (p == null || id == null) return; // late reply to a timed-out request — nothing to settle
      pendingQueries.delete(id);
      clearTimeout(p.timer);
      p.resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      if (queryPort === port) queryPort = null;
      failAllPending(chrome.runtime.lastError?.message || 'Native host disconnected');
    });
    return port;
  }

  // Ask the host about a batch of URLs. Rejects (rather than answering "not
  // saved") when the host can't be reached, so a missing host shows NO badges
  // instead of asserting that a saved post isn't saved.
  //
  // Answers BOTH halves of the host's reply (#158): what is saved, and what is in
  // the library's trash. `trashed` is sparse (only the urls that are) and empty
  // from a host built before it existed.
  function queryBridge(urls: string[]): Promise<{ results: SavedResults; trashed: TrashedResults }> {
    return new Promise((resolve, reject) => {
      let port: chrome.runtime.Port;
      try {
        port = getQueryPort();
      } catch (error: any) {
        reject(new Error(`Native host unavailable: ${error?.message || error}`));
        return;
      }
      const id = nextQueryId++;
      const timer = setTimeout(() => {
        pendingQueries.delete(id);
        reject(new Error('Native host timed out'));
      }, SAVED_QUERY_TIMEOUT_MS);
      // A host that answered ok:false answers the badge with "nothing known",
      // not with a rejection: the question is optional, and the caller already
      // treats an empty result as "leave these posts unmarked".
      pendingQueries.set(id, {
        resolve: (msg) => {
          const res = readHostResponse(msg);
          // The badge's port is often the FIRST thing to reach the host (a
          // timeline asks before anything is saved), so this is usually where a
          // skew is noticed — in time for the first save's banner to say so.
          noteHostProtocol(res.protocolVersion);
          // …and, for the same reason, the fastest carrier for a new local
          // build (#650): this port stays open for a whole browsing session.
          noteHostBuild(res.extBuild);
          resolve(res.ok ? { results: res.ack.results || {}, trashed: res.ack.trashed || {} } : { results: {}, trashed: {} });
        },
        reject,
        timer,
      });
      try {
        port.postMessage({ type: 'query', id, urls } satisfies HostRequest);
      } catch (error: any) {
        pendingQueries.delete(id);
        clearTimeout(timer);
        queryPort = null;
        reject(new Error(`Native host unavailable: ${error?.message || error}`));
      }
    });
  }

  // --- Retry queue (#203 — save-queue.ts owns the storage format and the
  // stash/eviction/degrade rules; this is only the wiring) ---------------
  //
  // A single URL lookup built on queryBridge, for save-queue.ts's idempotency
  // check (#34 already landed): a FRESH read, never the badge's cache — an
  // entry sitting in the queue is exactly the case a minute-old negative
  // could be wrong about.
  function queryForResend(url: string): Promise<SavedEntry | null> {
    return queryBridge([url]).then((r) => r.results[url] ?? null);
  }

  // Fire-and-forget from every trigger below: a sweep's own errors are
  // already handled inside sweepSaveQueue (a failed send updates `tries` and
  // stops the pass; nothing here needs to react to it), so this only exists
  // to keep `.catch(() => {})` out of every call site.
  function triggerQueueSweep(): void {
    void sweepSaveQueue({ send: bridgeSend, query: queryForResend, log: logCapture }).catch(() => {});
  }

  // Triggers (#203 design comment #4 — the reasoning for exactly these four
  // and not a chrome.alarms poll lives there): Chrome restart, an
  // install/update, the moment right after a save succeeds (below, in
  // captureAndSave/captureAndSaveDragged/savePostByUrl/doSaveBookmark), and
  // the moment right after the saved-badge's query port answers (the
  // checkSaved handler below) — never the service worker merely starting,
  // which a badge query provokes every few seconds on its own.
  //
  // `?.`: onStartup/onInstalled need no manifest permission in real Chrome
  // and are always present there; the guard is only for this suite's own
  // chrome stub, which models neither (background-wiring.test.ts).
  chrome.runtime.onStartup?.addListener(() => triggerQueueSweep());
  chrome.runtime.onInstalled?.addListener(() => triggerQueueSweep());

  // Answers already known, so scrolling back over a post costs nothing.
  // BOTH answers expire. A "not saved" goes stale the moment the user saves that
  // post (a save made HERE updates the entry directly — see markSaved), and a
  // "saved" goes stale when they delete it in the desktop app, which this side
  // never sees. Positives used to be kept for the life of the worker, so a
  // deleted post kept its badge until the service worker restarted — and worse,
  // the bulk intake asks through this same cache, so it would SKIP a post the
  // user had just deleted and meant to take again. Re-asking is cheap: the host
  // answers from an index it keeps in memory, invalidated by the save folder's
  // own mtimes, so it already sees the delete.
  // Both halves of the host's answer are cached together (#158): they come from
  // one round trip, and a trash notice goes stale on exactly the events a "saved"
  // does (the post is restored, the trash is emptied, the record expires).
  const SAVED_TTL_MS = 60_000;
  const SAVED_CACHE_MAX = 2000;
  interface CachedAnswer {
    entry: SavedEntry | null;
    trashed: TrashedEntry | null;
  }
  const savedCache = new Map<string, CachedAnswer & { until: number }>();

  function cacheGet(url: string): CachedAnswer | undefined {
    const hit = savedCache.get(url);
    if (!hit) return undefined;
    if (hit.until && hit.until < Date.now()) {
      savedCache.delete(url);
      return undefined;
    }
    return hit;
  }

  function cacheSet(url: string, entry: SavedEntry | null, trashed: TrashedEntry | null = null) {
    savedCache.delete(url); // re-insert so Map iteration order is LRU-ish
    savedCache.set(url, { entry, trashed, until: Date.now() + SAVED_TTL_MS });
    if (savedCache.size > SAVED_CACHE_MAX) {
      for (const k of [...savedCache.keys()].slice(0, savedCache.size - SAVED_CACHE_MAX)) savedCache.delete(k);
    }
  }

  // A save just landed: the badge for that post must appear now, not after the
  // negative entry expires. Told to the saving tab directly — other tabs pick it
  // up when their own negatives expire.
  //
  // `media` is what the host REPORTS it recorded, not what was announced: after
  // saving one picture of a multi-image post, the other pictures must keep
  // offering their save button (#334). Cached as "the whole post" — the shape
  // that hides every button — would undo that for a minute. Merged with any
  // entry already cached, because the earlier save of the same post recorded a
  // different picture.
  //
  // BOTH url forms are marked: the record's url comes from the platform API and
  // the page's permalink from the DOM, and the two can differ in spelling for the
  // same post (the host normalizes them to one key, this side deliberately does
  // not — see native-host/post-key.mts). Caching only one form would leave the
  // other's negative entry to expire on its own, and the badge would lag a minute
  // behind the save that just happened in front of the user.
  // captureId, NOT the ack's `file`: the two differ (the bulk-intake path's file
  // is a media filename that carries no id at all), and since #34 this value is
  // read as an identifier — a "replace" answer names the capture it retires.
  function markSaved(urls: Array<string | null | undefined>, captureId: string | null, media: Array<string | null>, tabId?: number) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const known = cacheGet(url)?.entry;
      const merged: SavedEntry = known ? { id: known.id || captureId || '', media: known.media.slice(), owners: (known.owners || known.media.map(() => known.id || null)).slice() } : { id: captureId || '', media: [] as Array<string | null>, owners: [] as Array<string | null> };
      // An entry that already answered "whole post" stays that way: adding one
      // picture to an empty list would claim the rest are NOT saved.
      if (!known || known.media.length) {
        for (const u of media) {
          if (!u || merged.media.includes(u)) continue;
          merged.media.push(u);
          merged.owners?.push(captureId || null); // this save wrote this picture
        }
      }
      // No trash notice survives a save of the same post (#158): whatever is in
      // the trash, this post is now in the library, and "saved" is the answer.
      cacheSet(url, merged, null);
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'savedUpdate', url, media } satisfies SavedUpdateMessage).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, _sender, sendResponse) => {
    if (message.type !== 'checkSaved') return false;
    const urls: string[] = Array.isArray(message.urls) ? message.urls.filter((u) => typeof u === 'string' && u) : [];
    const results: SavedResults = {};
    const ask: string[] = [];
    for (const u of urls) {
      const hit = cacheGet(u);
      if (hit) results[u] = hit.entry;
      else ask.push(u);
    }
    if (!ask.length) {
      sendResponse({ ok: true, results } satisfies CheckSavedResponse);
      return false;
    }
    queryBridge(ask)
      .then((fresh) => {
        for (const u of ask) {
          const entry = (Object.hasOwn(fresh.results, u) ? fresh.results[u] : null) || null;
          // The badge does not draw trash notices — it only asks "is this
          // saved" — but the answer is cached so the duplicate check does not
          // have to ask again for a post the timeline just looked at.
          cacheSet(u, entry, (Object.hasOwn(fresh.trashed, u) ? fresh.trashed[u] : null) || null);
          results[u] = entry;
        }
        sendResponse({ ok: true, results } satisfies CheckSavedResponse);
        // Trigger 4 (#203 design comment #4): the query port just proved the
        // host answers RIGHT NOW, without costing a connection of its own —
        // this port is already open and asking on its own schedule while a
        // timeline is on screen. sweepSaveQueue itself is a no-op the instant
        // it finds nothing queued for the current host.
        triggerQueueSweep();
      })
      // Unreachable host → report the failure instead of a page full of
      // "not saved": badge.js leaves those posts unmarked and retries later.
      .catch((error) => sendResponse({ ok: false, error: error?.message, results } satisfies CheckSavedResponse));
    return true; // async response
  });

  // --- Duplicate-save warning (#34) ---------------------------------------------
  // Asked by the content scripts BEFORE they start a save, so the answer can be
  // a choice (copy / replace / skip) rather than an after-the-fact notice: the
  // extension writes through the native host, so a save made with the desktop
  // app closed has no in-app surface to resolve later.
  //
  // Read-only and fail-open. Anything that leaves the question unanswered — no
  // permalink, an unreachable host, a thrown lookup — answers `ok:false`, and
  // the caller saves as it always did. A missed warning costs one extra record;
  // a blocked save costs the post.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'checkDuplicate') return false;
    duplicateOf(message.url, message.platform, Array.isArray(message.imageUrls) ? message.imageUrls : [])
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true; // async response
  });

  interface DuplicateAnswer {
    ok: boolean;
    duplicate?: boolean;
    captureId?: string | null;
    // #158: the post is not in the library, but its record and files are in the
    // library's trash. Never set together with duplicate:true — a live capture
    // is the stronger answer, and it is the one that can be replaced.
    trashed?: TrashedEntry | null;
  }

  // Two axes, in the order they can be decided (#34's confirmed design):
  //   1. the post URL (postKeyOf, host-side) — is this post in the library at all?
  //   2. the pictures — does what is about to be saved OVERLAP what is saved?
  // Axis 2 is what keeps a manga's next page from being called a duplicate: same
  // post URL, a picture the library does not have, so nothing is re-saved. When
  // the pictures cannot be compared at all (a text-only post, a record saved
  // before per-picture answers existed, a page whose platform has no picture
  // identity rule) axis 1 stands alone and warns — a false warning is answered
  // with "copy" and costs nothing, while a missed one is a silent duplicate.
  async function duplicateOf(url: unknown, platform: string, imageUrls: string[]): Promise<DuplicateAnswer> {
    if (typeof url !== 'string' || !url) return { ok: true, duplicate: false };
    const hit = cacheGet(url);
    let entry: SavedEntry | null;
    let trashed: TrashedEntry | null;
    if (hit) {
      entry = hit.entry;
      trashed = hit.trashed;
    } else {
      const fresh = await queryBridge([url]);
      entry = (Object.hasOwn(fresh.results, url) ? fresh.results[url] : null) || null;
      trashed = (Object.hasOwn(fresh.trashed, url) ? fresh.trashed[url] : null) || null;
      cacheSet(url, entry, trashed);
    }
    // Nothing live, but the post is in the trash (#158): re-saving would build a
    // second copy of a post whose original is still restorable, so the notice is
    // worth the interruption. Asked BEFORE the picture comparison below because
    // there are no saved pictures to compare against — the record left the
    // library, and the trash index answers per post, not per picture.
    if (!entry) return trashed ? { ok: true, duplicate: false, trashed } : { ok: true, duplicate: false };

    const wanted = imageUrls.map((u) => mediaKeyOf(platform, u)).filter((k): k is string => !!k);
    const saved = entry.media.map((u, i) => ({ key: u ? mediaKeyOf(platform, u) : null, owner: (entry?.owners && entry.owners[i]) || entry?.id || null }));
    const comparable = saved.filter((s) => s.key);
    if (!comparable.length || !wanted.length) return { ok: true, duplicate: true, captureId: entry.id || null };
    const overlap = comparable.find((s) => s.key && wanted.includes(s.key));
    return overlap ? { ok: true, duplicate: true, captureId: overlap.owner } : { ok: true, duplicate: false };
  }

  // --- Recent-save memory (per post URL) ------------------------------------------
  // Consecutive saves of the SAME post (multi-page manga, re-grabs) merge into one
  // card in the app, so the save toast should say so — otherwise the second save
  // looks like a no-op (nothing new appears; the card face doesn't change).
  // The count lives in chrome.storage.session: survives service-worker restarts,
  // clears when the browser closes ("recent" ≈ this browsing session). Keyed by the
  // record's canonical post URL (both save paths build it from the same metadata).
  // Returns how many saves of this URL happened BEFORE this one (0 = first).
  const RECENT_SAVES_KEY = 'recentSaves.v1';
  const RECENT_SAVES_MAX = 200; // prune oldest beyond this many distinct posts
  async function bumpRecentSave(url) {
    if (!url) return 0;
    try {
      const got = await chrome.storage.session.get(RECENT_SAVES_KEY);
      const map = got[RECENT_SAVES_KEY] || {};
      const prev = map[url] ? map[url].n : 0;
      map[url] = { n: prev + 1, t: Date.now() };
      const keys = Object.keys(map);
      if (keys.length > RECENT_SAVES_MAX) {
        keys.sort((a, b) => map[a].t - map[b].t);
        for (const k of keys.slice(0, keys.length - RECENT_SAVES_MAX)) delete map[k];
      }
      await chrome.storage.session.set({ [RECENT_SAVES_KEY]: map });
      return prev;
    } catch {
      return 0; // memory is best-effort; never fail or delay a save over it
    }
  }

  // Best-effort diagnostics: append one capture event to the native host's
  // capture.log so a broken save can be diagnosed from disk later. Its own
  // short-lived native connection — not piggybacked on the save (bridgeSend
  // finishes on its first reply), and pre-bridge failures have no save connection
  // at all. NEVER throws and never blocks the save: if the host can't be reached
  // (e.g. it isn't registered — itself worth recording) the entry falls back to a
  // chrome.storage ring buffer that {type:'dumpLogs'} can read back.
  //
  // ONE CONNECTION AT A TIME, and no more than one per cooldown (#323). Chrome
  // starts a host process per connection, so a line-per-connection log turns any
  // source of repeated lines into a source of processes — which is how #323's
  // synthetic clicks spawned them without saving anything. Lines written while a
  // flush is open ride out on the next one, and the queue is capped: past it,
  // lines go to the local ring buffer only, so the log can drop entries but never
  // grow the memory or the process count of a wedged worker.
  //
  // The cooldown is why the flush is LEADING-EDGE — the first line after a quiet
  // spell goes out at once. #519's `save`/`begin` line has to reach disk before
  // the waits it precedes can stall, and a debounce that held it back would take
  // that away from every save to slow down a case that only a loop reaches.
  const LOG_COOLDOWN_MS = 1000;
  const LOG_HOST_TIMEOUT_MS = 4000;
  const LOG_QUEUE_MAX = 100;
  interface QueuedLog {
    entry: SaveLogEntry & { ts: string };
    // Already in the ring buffer (a `fail` line, stashed before anything is
    // attempted), so a flush that fails must not stash it a second time.
    stashed: boolean;
  }
  let logQueue: QueuedLog[] = [];
  let logFlushing = false;
  let logFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLogFlushAt = Number.NEGATIVE_INFINITY;

  function logCapture(entry: SaveLogEntry, keepLocal = false): void {
    const full = Object.assign({ ts: new Date().toISOString() }, entry);
    if (keepLocal) stashLogLocally(full);
    if (logQueue.length >= LOG_QUEUE_MAX) {
      if (!keepLocal) stashLogLocally(full); // dropped from the log, kept on disk
      return;
    }
    logQueue.push({ entry: full, stashed: keepLocal });
    scheduleLogFlush();
  }

  function scheduleLogFlush() {
    if (logFlushing || logFlushTimer !== null || !logQueue.length) return;
    const wait = Math.max(0, lastLogFlushAt + LOG_COOLDOWN_MS - Date.now());
    if (!wait) {
      flushLog();
      return;
    }
    logFlushTimer = setTimeout(() => {
      logFlushTimer = null;
      flushLog();
    }, wait);
  }

  function flushLog() {
    if (logFlushing || !logQueue.length) return;
    const batch = logQueue;
    logQueue = [];
    logFlushing = true;
    lastLogFlushAt = Date.now();

    let settled = false;
    let acked = 0; // replies received = lines this host has taken
    let port: chrome.runtime.Port | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        port?.disconnect();
      } catch {
        /* already gone */
      }
      // Whatever the host did not acknowledge never reached capture.log.
      for (const queued of batch.slice(acked)) {
        if (!queued.stashed) stashLogLocally(queued.entry);
      }
      logFlushing = false;
      // The cooldown runs from the END of a flush: a host that took four
      // seconds to answer must not be asked again the moment it does.
      lastLogFlushAt = Date.now();
      scheduleLogFlush(); // anything written while this connection was open
    };

    timer = setTimeout(done, LOG_HOST_TIMEOUT_MS);
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch {
      done();
      return;
    }
    port.onMessage.addListener((msg: unknown) => {
      acked++;
      // These acks carry the local build's stamp too (#650), and they are the
      // one round trip that happens on a page nobody is saving from — the
      // `activate` line goes out the moment the UI is asked for.
      noteHostBuild(hostExtBuild(msg));
      if (acked >= batch.length) done();
    });
    port.onDisconnect.addListener(done);
    try {
      // The host reads its stdin in a loop and answers each framed message, so
      // one connection carries the whole batch (native-host/bridge.cts).
      for (const queued of batch) port.postMessage({ type: 'log', entry: queued.entry } satisfies HostRequest);
    } catch {
      done();
    }
  }

  // Ring buffer for entries that couldn't reach the host. One key per entry
  // (append-only — no read-modify-write race between concurrent captures); ISO ts
  // in the key makes lexical sort == chronological, so trimming drops the oldest.
  function stashLogLocally(entry) {
    try {
      const key = `${DIAG_PREFIX}${entry.ts}_${Math.floor(Math.random() * 1e6)}`;
      chrome.storage.local.set({ [key]: entry }, () => {
        void chrome.runtime.lastError; // ignore quota / other set errors
        chrome.storage.local.get(null, (all) => {
          if (chrome.runtime.lastError) return;
          const keys = Object.keys(all)
            .filter((k) => k.startsWith(DIAG_PREFIX))
            .sort();
          if (keys.length > DIAG_KEEP) chrome.storage.local.remove(keys.slice(0, keys.length - DIAG_KEEP));
        });
      });
    } catch {
      /* ignore — diagnostics are non-essential */
    }
  }

  // What only the chrome://extensions error console would otherwise hold
  // (#727). keepLocal: an uncaught error is precisely the situation in which
  // the host may be the thing that is broken. No origin filter — everything
  // running in this worker is the extension's own. Guarded because tests run
  // this closure where no service-worker global exists.
  if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
    installUncaughtReporting(self, (entry) => logCapture(entry, true), { context: 'background' });
  }

  // A metadata fetch "succeeded" if the platform API returned any identifying
  // field. An empty record (fetch failed / API down / unparseable URL) has null
  // author/date/text and no media — the screenshot still saved, but the user
  // should be told the post info is missing rather than seeing a plain success.
  // metaError is authoritative when set: screenName is parsed from the URL and
  // date can be decoded from an X snowflake id, so both can be present on a
  // record whose API fetch returned nothing (a protected X account looked like
  // a full success via its URL-derived screenName — 2026-07-12).
  // Media a platform serves as a file the page can only preview. The still frame
  // shown in its place is never the record's content, so these posts are saved
  // by downloading what the platform announces rather than what the page shows.
  function isPlayableMedia(mediaType) {
    return mediaType === 'video' || mediaType === 'gif';
  }

  function metaFetched(meta) {
    if (!meta || meta.metaError) return false;
    return !!(meta.displayName || meta.userId || meta.text || meta.date || (Array.isArray(meta.media) && meta.media.length));
  }

  // --- Image-drag save (drag.js → here) ---
  // Same metadata as a post-click save, but no screenshot: the dragged image
  // itself becomes the record's primary image (the bridge downloads it). Produces
  // the "illustration record" shape (image = the art, media: []).
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'imageDragged') return false;
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' } satisfies SaveResponse);
      return false;
    }
    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' } satisfies SaveResponse);
      return false;
    }
    const senderHost = getHostname(sender.tab.url);
    const tabId = sender.tab.id;
    const tab = sender.tab;
    const imageUrls = message.imageUrls || [];
    const admitted = admitSave(message, tabId, senderHost, imageUrls, () => captureAndSaveDragged(tab, message.platform, message.postUrl, imageUrls, message.replaces || null, message.saveId));
    if (!admitted) {
      sendResponse({ ok: false, errorKind: 'busy', error: BUSY_ERROR } satisfies SaveResponse);
      return false;
    }
    admitted
      .then((result) => sendResponse({ ok: true, ...result } satisfies SaveResponse))
      .catch((error) => {
        const errorKind = classifySaveFailure(error?.message);
        // warn for the failures that are outcomes rather than malfunctions —
        // console.error piles them up in the extensions error console (#580).
        console[saveFailureConsoleLevel(errorKind)](error);
        logSaveFailure(error, { saveId: message.saveId, platform: message.platform, host: senderHost, url: message.postUrl });
        sendResponse({ ok: false, errorKind, metaReason: error?.metaReason || null, queued: error?.queued } satisfies SaveResponse);
      });
    return true; // async response
  });

  // Diagnostics relays. content.js reports pre-bridge stage failures (select /
  // permalink) here; {type:'dumpLogs'} reads back the local fallback ring buffer
  // (entries that never reached the host's capture.log).
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type === 'logCapture') {
      const entry = Object.assign({ host: getHostname(sender.tab?.url) }, message.entry || {});
      noteDevReloadActivity(sender.tab?.id ?? null, entry.stage, entry.phase);
      logCapture(entry, entry.phase === 'fail');
      sendResponse({ ok: true } satisfies LogCaptureResponse);
      return false;
    }
    if (message.type === 'dumpLogs') {
      chrome.storage.local.get(null, (all) => {
        const entries = Object.keys(all)
          .filter((k) => k.startsWith(DIAG_PREFIX))
          .sort()
          .map((k) => all[k]);
        sendResponse({ ok: true, entries } satisfies DumpLogsResponse);
      });
      return true; // async
    }
    // #203: the diag page's read-only inventory of the retry queue — no
    // sweep, so loading the page never itself provokes a connectNative
    // attempt (see resendQueue below for the one that does).
    if (message.type === 'queueStats') {
      saveQueueStats().then((stats) => sendResponse({ ok: true, stats } satisfies QueueStatsResponse));
      return true; // async
    }
    // #203: the diag page's "今すぐ再送" button — run one sweep now (its own
    // errors are swallowed the same way triggerQueueSweep's callers accept),
    // then answer with whatever the queue looks like afterward.
    if (message.type === 'resendQueue') {
      sweepSaveQueue({ send: bridgeSend, query: queryForResend, log: logCapture })
        .catch(() => {})
        .then(() => saveQueueStats())
        .then((stats) => sendResponse({ ok: true, stats } satisfies ResendQueueResponse));
      return true; // async
    }
    return false;
  });

  async function captureAndSaveDragged(tab, sendPlatform, postUrl, imageUrls, replaces: string | null = null, saveId: string | null = null) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('saveDragged', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    // expectedHost pins Misskey/Mastodon instance fetches to the sender tab's host
    // (SSRF guard). Drag is x/bsky/pixiv only today, but keep it consistent.
    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');
    const metaOk = metaFetched(meta);

    // What the page can hand over for a video or GIF post is the poster frame,
    // and a poster on its own is not worth a library entry — the content is the
    // video file (#450). The post-save path already downloads the originals a
    // platform announces, video bodies included since #119 stage 1, so send
    // those posts down it rather than teaching this path to fetch video too.
    // Everything else keeps the illustration-record shape, where the picture
    // that was pointed at IS what the user asked to save.
    let record: any;
    let send: () => Promise<BridgeAck>;
    // Set only in the branch below whose bridgeSend call is ever retried
    // (#203): the 'saveDragged' request. The playable-media branch sends
    // 'savePost' instead, which save-queue.ts's header comment excludes from
    // the retry queue on purpose, so it is left null there.
    let queueable: SaveDraggedRequest | null = null;
    if (isPlayableMedia(meta.mediaType)) {
      // capturedVia stays null — an ordinary save, not an intake route (#362).
      record = buildRecord(meta, { captureId, capturedAt, postUrl, sendPlatform, replaces, extra: { mediaType: meta.mediaType, media: meta.media, capturedVia: null } });
      send = () => sendPostToBridge(captureId, record, metaOk, meta.metaError || null, saveId);
    } else {
      const primary = pickPrimaryImage(meta.platform || sendPlatform, imageUrls, meta);
      if (!primary || !primary.url) throw trace.fail('image', 'Could not resolve a dragged image URL');
      trace.passed('image');
      record = buildRecord(meta, {
        captureId,
        capturedAt,
        postUrl,
        sendPlatform,
        replaces,
        extra: {
          mediaType: 'image',
          // Which image of a multi-image post this is (1-based) + the total. Only
          // recorded for multi-image posts; imageIndex is null when undeterminable.
          imageCount: (meta.media || []).length > 1 ? meta.media.length : null,
          imageIndex: (meta.media || []).length > 1 && primary.index >= 0 ? primary.index + 1 : null,
          // image + media[] are set by the bridge (image = downloaded original, media = [])
        },
      });
      const draggedReq: SaveDraggedRequest = { type: 'saveDragged', captureId, saveId, imageUrl: primary.url, imageReferer: primary.referer, metadata: record, metaOk, metaReason: meta.metaError || null };
      queueable = draggedReq;
      send = () => bridgeSend(draggedReq);
    }

    let ack: BridgeAck;
    try {
      ack = await send();
    } catch (err: any) {
      const failErr = trace.fail('bridge', err?.message || 'bridge save failed', meta.metaError || null);
      if (err?.unreachable && queueable) failErr.queued = await stashFailedSave(queueable, logCapture);
      throw failErr;
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id); // light this post's TL badge now
    // ついで掃き出し (#203): this save reaching the host is evidence it is reachable right now.
    triggerQueueSweep();
    // Surface metadata-fetch failure to the drop overlay (same partial-success
    // signal as the click-save banner) so a screenshot-less illustration that
    // saved without post info isn't shown as a plain success. grouped = prior
    // saves of this post this session (the overlay says the save merged).
    const grouped = await bumpRecentSave(record.url);
    return { ...ack, captureId: ack?.captureId || captureId, metaOk, metaReason: meta.metaError || null, grouped, hostSkew: await skewNoteForBanner() };
  }
}

// Build the sidecar record shared by both save paths. The click path adds image +
// media (the screenshot is the content; media[] carries the API originals the
// bridge downloads). The drag path leaves image/media to the bridge (the
// downloaded illustration becomes image, media stays []) and instead records
// which image of a multi-image post it was. Single source of truth so a new field
// can't drift between the two paths.
function buildRecord(meta, { captureId, capturedAt, postUrl, sendPlatform, replaces, extra }: { captureId: string; capturedAt: string; postUrl: string; sendPlatform: string | null; replaces?: string | null; extra: Record<string, unknown> }): CaptureMetadata {
  return Object.assign(
    {
      captureId,
      // #34: the captureId this save replaces, when the user answered the
      // duplicate warning with "replace". The host writes it through as a plain
      // record field — trashing the old capture is the app's job (write-once).
      replaces: replaces || null,
      url: meta.url || postUrl || null,
      // meta.platform is null only when the URL didn't parse; fall back to the
      // sender-reported platform (already origin-validated) so the record stays
      // visible in the viewer's platform filter rather than becoming platform:null.
      platform: meta.platform || sendPlatform || null,
      text: meta.text,
      title: meta.title || null,
      displayName: meta.displayName,
      screenName: meta.screenName,
      userId: meta.userId,
      avatar: meta.avatar,
      avatarReferer: meta.avatarReferer,
      followers: meta.followers,
      authorCreatedAt: meta.authorCreatedAt,
      likes: meta.likes,
      reposts: meta.reposts,
      replies: meta.replies,
      bookmarks: meta.bookmarks,
      views: meta.views,
      // No silent fallback to capture time: a fabricated "post date" pollutes the
      // viewer's date sort/filter. The viewer handles null dates.
      date: meta.date || null,
      capturedAt,
      updatedAt: capturedAt, // last modified in Hologram (bumped on tag edits etc.)
      lang: meta.lang,
      isReply: meta.isReply,
      isQuote: meta.isQuote,
      isThread: meta.isThread,
      isEdited: meta.isEdited,
      editedAt: meta.editedAt,
      cw: meta.cw,
      sensitive: meta.sensitive,
      quotedUrl: meta.quotedUrl,
      replyToId: meta.replyToId,
      // #180's sidecar sub-records (the extractors build them; this was the
      // missing wire-up — see #751). Undefined (not null) on the bookmark
      // path, whose meta object has no such fields at all.
      quotedPost: meta.quotedPost,
      replyToPost: meta.replyToPost,
      // #179: the post's poll, when it has one (X / Misskey / Mastodon).
      // Undefined (not null) on the bookmark path, like the two above.
      poll: meta.poll,
      // #181: the OGP preview card of a link-share post (Bluesky / Mastodon /
      // X). Undefined (not null) on the bookmark path, like the two above.
      linkCard: meta.linkCard,
      seriesId: meta.seriesId,
      seriesTitle: meta.seriesTitle,
      seriesOrder: meta.seriesOrder,
      hashtags: meta.hashtags || [],
      tags: meta.tags || [],
      // #290: the post's own :shortcode: custom emoji (Misskey/Mastodon only —
      // see extractor/types.ts's CustomEmoji). Announced here; the bridge
      // downloads each one into the shared emoji/ store and fills its `file`,
      // the same avatar-store pattern media-download.cts's downloadAvatar uses.
      customEmojis: meta.customEmojis || [],
      // The acquisition originals (#292), still as received text — the native
      // host compresses, hashes and caps them (native-host/raw-payload.mts).
      // Carried on every save path, including a partial one: a response that
      // yielded no usable fields is precisely the one whose body has to survive.
      rawPayloads: meta.raw || [],
    },
    extra,
  );
}

function generateCaptureId() {
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `${Date.now()}-${hex}`;
}

// Choose which original to save for a dragged image, preferring the platform
// API's original (matched to the dragged image) so we store full resolution.
// Returns { url, referer, index } where index = the 0-based position of the
// chosen image within the post's media[] (-1 if we couldn't determine it).
function pickPrimaryImage(platform, imageUrls, meta) {
  const media = (meta && meta.media) || [];
  const extractor = extractorFor(platform);
  // A site whose media[] is indexed by a page number in the file name (pixiv)
  // answers straight from the dragged URL, no key matching needed.
  if (extractor?.mediaPageIndex) {
    const page = extractor.mediaPageIndex(imageUrls);
    const referer = extractor.mediaReferer;
    const i = page !== null && page < media.length ? page : media.length === 1 ? 0 : -1;
    // Only substitute the API original when the dragged page was actually
    // matched — silently saving p0 for an unmatched drag asserted an image the
    // user never dragged. Unmatched → keep the dragged URL (like X/Bluesky).
    const pick = i >= 0 ? media[i] : null;
    if (pick && pick.url) return { url: pick.url, referer: pick.referer || referer, index: i };
    return { url: imageUrls[0], referer, index: -1 };
  }
  const i = matchMediaIndex(platform, imageUrls, media);
  if (i >= 0 && media[i] && media[i].url) return { url: media[i].url, referer: media[i].referer, index: i };
  return { url: hiRes(platform, imageUrls[0]), referer: undefined, index: media.length === 1 ? 0 : -1 };
}

// Index (0-based) of the post's media[] entry that the dragged image came from,
// matched by mediaKeyOf (the extractor owns the per-site rule — the overlay
// compares the library's saved pictures with the same one, #334).
// -1 if none matched (or the platform has no key scheme).
function matchMediaIndex(platform, imageUrls, media) {
  const keys = imageUrls.map((u) => mediaKeyOf(platform, u)).filter(Boolean);
  if (!keys.length) return -1;
  for (let i = 0; i < media.length; i++) {
    const k = mediaKeyOf(platform, media[i].url);
    if (k && keys.includes(k)) return i;
  }
  return -1;
}

// The site's original-resolution rewrite, falling back to the URL as given —
// a save has to send something even where no rewrite rule applies.
function hiRes(platform, url) {
  if (!url) return url;
  return highResUrlOf(platform, url) ?? url;
}

// Pure helpers with no chrome.* / DOM dependency, exported for direct unit
// testing (scripts/background-unit.test.ts) — the rest of this file only
// runs inside the extension service worker via startBackground().
export { isAllowedSender, pickPrimaryImage, matchMediaIndex, hiRes, buildRecord, generateCaptureId };

'use strict';

// The toolbar action's panel (#124) — the extension's standing answer to "is
// this thing working, and did what I saved go in?".
//
// WHY THE ICON NO LONGER SAVES IN ONE PRESS. Chrome gives an action either a
// click event or a popup, never both, so putting a panel here costs the
// one-press save from the toolbar. That trade was taken deliberately: the
// connection to the desktop app, the retry queue behind a host that was down
// (#203) and the last saves that did or did not land had no place to be read at
// all, while saving still has three entrances (Alt+S, the hover button #94, and
// dragging an image). The panel's own first row is a save button, so the press
// that used to save still does — one click later, and now able to say why when
// it cannot.
//
// Everything here is deliberately plain: no framework, the same shape as the
// settings and diagnostics pages. Strings come from _locales via chrome.i18n
// (the standard channel for extension pages); the static text in popup.html is
// the Japanese fallback for a file:// preview where chrome.i18n is absent.
//
// Wrapped in a function for the same reason diag.ts and options.ts are: tsc
// compiles every extension file as one program, so top-level names must stay
// unique across it.
import { escalationUrl } from './inject-failure.ts';
import type { InjectFailureKind } from './inject-failure.ts';
import { pingNativeHost, protocolReportOf } from './host-probe.ts';
import type { PopupActivateReason, PopupActivateResponse, QueueStatsResponse } from './messages.ts';
import { SAVE_HISTORY_KEY, countOf, readSaveHistory, savedOn } from './save-history.ts';
import type { SaveHistoryEntry } from './save-history.ts';

export function startPopup(): void {
  const byId = (id: string) => document.getElementById(id);

  // The same spelling the settings page uses, because scripts/ext-consistency.test.ts
  // reads THIS call shape to decide which _locales keys are in use — a key set a
  // different way would silently leave the parity check.
  const setText = (id: string, key: string) => {
    const el = byId(id);
    const text = chrome.i18n && chrome.i18n.getMessage(key);
    if (el && text) el.textContent = text;
  };

  const show = (id: string, visible: boolean) => byId(id)?.toggleAttribute('hidden', !visible);

  try {
    const title = chrome.i18n && chrome.i18n.getMessage('popupTitle');
    if (title) document.title = title;
    setText('save', 'popupSave');
    setText('saveHint', 'popupSaveHint');
    setText('statusText', 'popupStatusChecking');
    setText('statusDiag', 'popupOpenDiag');
    setText('historyTitle', 'popupHistoryTitle');
    setText('historyEmpty', 'popupHistoryEmpty');
    setText('openOptions', 'popupOpenOptions');
    setText('openDiag', 'popupOpenDiag');
  } catch {
    /* not running as an extension page — the static fallback text stays */
  }

  // --- the save button -------------------------------------------------------

  const saveButton = byId('save') as HTMLButtonElement | null;
  let repairUrl: string | null = null;

  // Why the press could not start a save, said in the panel that is already
  // open (#124 §3). #269's escalation — open the repair page on the second
  // failure in a row — stays on the keyboard routes and is deliberately NOT
  // taken here: opening a tab behind a panel the user is reading throws away
  // the surface AND the choice at once. The same page is offered as a button.
  function refuse(reason: PopupActivateReason) {
    const el = byId('saveReason');
    const message = chrome.i18n && chrome.i18n.getMessage(reason === 'package-unreadable' ? 'popupRefusedUnreadable' : reason === 'page-refused' ? 'popupRefusedPage' : reason === 'not-http' ? 'popupRefusedNotHttp' : 'popupRefusedNoTab');
    if (el && message) el.textContent = message;
    show('saveReason', true);
    if (saveButton) saveButton.disabled = true;

    // Only the two injection failures have somewhere to go: a page that cannot
    // be scripted at all is not broken, and there is nothing to repair.
    const kind: InjectFailureKind | null = reason === 'package-unreadable' || reason === 'page-refused' ? reason : null;
    const repair = byId('saveRepair');
    if (!kind || !repair) return;
    repairUrl = escalationUrl(kind);
    const label = chrome.i18n && chrome.i18n.getMessage(kind === 'package-unreadable' ? 'popupOpenExtensions' : 'popupOpenDiag');
    if (label) repair.textContent = label;
    show('saveRepair', true);
  }

  byId('saveRepair')?.addEventListener('click', () => {
    // chrome.tabs.create rather than a link: the unreadable branch's
    // destination is chrome://extensions, which a page may not link to.
    if (repairUrl) chrome.tabs.create({ url: repairUrl }).catch(() => {});
    window.close();
  });

  saveButton?.addEventListener('click', () => {
    saveButton.disabled = true;
    chrome.runtime.sendMessage({ type: 'popupActivate' }, (res?: PopupActivateResponse) => {
      void chrome.runtime.lastError;
      // The capture UI is up on the page behind this panel — the panel has
      // nothing left to show, and leaving it open would cover the thing the
      // user is about to click.
      if (res?.ok) {
        window.close();
        return;
      }
      refuse(res?.reason ?? 'no-tab');
    });
  });

  // Answer before the press when the answer is already knowable: the active tab
  // is what the save would act on, and a tab nothing can be injected into
  // should not offer a button that will fail. The tab's url is readable here
  // because opening this popup granted activeTab for it.
  chrome.tabs
    ?.query({ active: true, currentWindow: true })
    .then(([tab]) => {
      if (tab && tab.url && !/^https?:/i.test(tab.url)) refuse('not-http');
    })
    .catch(() => {});

  // --- connection, versions, queue -------------------------------------------

  // Takes the resolved sentence rather than a message key, so every key stays
  // spelled inside a literal chrome.i18n.getMessage(...) call — that is the
  // shape scripts/ext-consistency.test.ts scans for, and a key reaching here as
  // a variable would leave the _locales parity check without anyone noticing.
  function paintStatus(state: 'ok' | 'warn' | 'bad', text: string | null, detail: string | null) {
    byId('statusDot')?.setAttribute('data-state', state);
    const el = byId('statusText');
    if (el && text) el.textContent = text;
    const detailEl = byId('statusDetail');
    if (detailEl && detail) detailEl.textContent = detail;
    show('statusDetail', !!detail);
    // The diagnostics page is the next step only when the connection is the
    // problem; a version mismatch is answered by updating, not by diagnosing.
    show('statusDiag', state === 'bad');
  }

  async function checkConnection() {
    const ping = await pingNativeHost();
    const protocol = protocolReportOf(ping);
    if (!ping.ok) {
      // WHERE it failed, in the vocabulary host-probe.ts classifies it with:
      // "no host is registered" and "the host was there and died" send a person
      // to different places, and the diagnostics page prints the raw text.
      const detail = chrome.i18n && chrome.i18n.getMessage(ping.where === 'connect-threw' ? 'popupHostNotRegistered' : ping.where === 'timeout' ? 'popupHostNoAnswer' : ping.where === 'disconnect' ? 'popupHostDisconnected' : 'popupHostSendFailed');
      paintStatus('bad', (chrome.i18n && chrome.i18n.getMessage('popupStatusDisconnected')) || null, detail || null);
      return;
    }
    // #205's standing condition finally has a standing place to be read. The
    // save banner still says it once per browser session (background.ts's
    // skewNoteForBanner) so that someone who never opens this panel is not left
    // in the dark, but the sentence lives here.
    if (protocol.skew === 'host-old') paintStatus('warn', (chrome.i18n && chrome.i18n.getMessage('popupStatusHostOld')) || null, null);
    else if (protocol.skew === 'host-new') paintStatus('warn', (chrome.i18n && chrome.i18n.getMessage('popupStatusExtensionOld')) || null, null);
    else paintStatus('ok', (chrome.i18n && chrome.i18n.getMessage('popupStatusConnected')) || null, null);
  }

  // #203: saves stashed for a host that was not there. Read-only — the sweep
  // that drains it is the diagnostics page's button, and provoking a host
  // launch from a panel that opens on every icon press is not the same thing.
  function checkQueue() {
    try {
      chrome.runtime.sendMessage({ type: 'queueStats' }, (res?: QueueStatsResponse) => {
        void chrome.runtime.lastError;
        const count = res?.ok ? res.stats.count : 0;
        const el = byId('queueRow');
        const text = count > 0 && chrome.i18n && chrome.i18n.getMessage('popupQueued', [String(count)]);
        if (el && text) el.textContent = text;
        show('queueRow', count > 0);
      });
    } catch {
      /* no extension context — nothing this panel can do about it */
    }
  }

  // --- recent saves ----------------------------------------------------------

  // Enough of the URL to recognise the post by (the author's name is in the
  // leading part of every platform's permalink), from the FRONT, so what gets
  // dropped is the numeric id nobody reads.
  function shortUrl(url: string): string {
    const bare = url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    return bare.length > 44 ? `${bare.slice(0, 43)}…` : bare;
  }

  function whenOf(ts: number, now: Date): string {
    const at = new Date(ts);
    const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
    const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return sameDay ? time : `${at.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })} ${time}`;
  }

  function rowOf(entry: SaveHistoryEntry, now: Date): HTMLLIElement {
    const li = document.createElement('li');
    li.className = entry.ok ? 'row' : 'row failed';

    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = whenOf(entry.ts, now);
    li.append(when);

    // A real link, not a click handler: it is keyboard-reachable, it says where
    // it goes on hover, and it needs no permission. #125 adds an "open in the
    // app" control beside it once the app can be addressed by captureId.
    const label = shortUrl(entry.url || '');
    const target = entry.url ? document.createElement('a') : document.createElement('span');
    target.className = 'where';
    target.textContent = label;
    target.title = entry.url || '';
    if (target instanceof HTMLAnchorElement && entry.url) {
      target.href = entry.url;
      target.target = '_blank';
      target.rel = 'noreferrer';
    }
    li.append(target);

    const count = countOf(entry);
    if (count > 1) {
      const many = document.createElement('span');
      many.className = 'count';
      const text = chrome.i18n && chrome.i18n.getMessage('popupRunCount', [String(count)]);
      if (text) many.textContent = text;
      li.append(many);
    }
    if (!entry.ok) {
      const mark = document.createElement('span');
      mark.className = 'mark';
      const text = chrome.i18n && chrome.i18n.getMessage('popupSaveFailed');
      if (text) mark.textContent = text;
      mark.title = entry.error || '';
      li.append(mark);
    }
    return li;
  }

  async function renderHistory() {
    const rows = await readSaveHistory();
    const list = byId('history');
    if (!list) return;
    const now = new Date();
    list.replaceChildren(...rows.map((entry) => rowOf(entry, now)));
    show('historyEmpty', rows.length === 0);
    const today = byId('todayRow');
    const text = chrome.i18n && chrome.i18n.getMessage('popupToday', [String(savedOn(rows, now))]);
    if (today && text) today.textContent = text;
  }

  // Follow the ring while the panel is open. This only pays off in the narrow
  // case of a save started some other way (Alt+S, a hover button) while the
  // panel happens to be up, but it costs one listener — and a panel showing
  // stale counts is exactly the thing it exists not to be.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && SAVE_HISTORY_KEY in changes) void renderHistory();
  });

  // The options page prefers its own opener: it reuses an already-open settings
  // tab instead of stacking another one. The href stays in the HTML as the
  // fallback for a preview outside the extension.
  byId('openOptions')?.addEventListener('click', (event) => {
    if (!chrome.runtime?.openOptionsPage) return;
    event.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });

  byId('statusDiag')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('diag.html') }).catch(() => {});
    window.close();
  });

  void renderHistory();
  void checkConnection();
  checkQueue();
}

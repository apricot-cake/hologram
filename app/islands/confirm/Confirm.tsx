import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { close, get, subscribe as subscribeConfirm } from '../../renderer/confirm.ts';

// Shared confirm modal (#confirmOverlay) — React-owned. viewer.ts pushes a config via
// confirm.ts's open({message, okLabel, cancelLabel, skipLabel?, keyword?, onOk,
// onCancel}); this host renders the .confirm-box into #confirmOverlay (the container stays
// viewer's — CSS + setupModalChrome key on #confirmOverlay.show, which this toggles from
// model presence, like the lightbox owns #lightbox's classes). Local state (skip checkbox,
// keyword value) lives here; OK is gated until the keyword matches. The destructive work
// runs in viewer's onOk closure — this only decides when to call it. Same DOM (ids/classes)
// as the old static HTML so styling is unchanged.

const subscribe = (cb: () => void) => subscribeConfirm(cb);
const getSnapshot = () => get();

function ConfirmBox({ model }: { model: CorpusConfirmModel }) {
  const [skip, setSkip] = useState(false);
  const [kw, setKw] = useState('');
  const okDisabled = model.keywordRequired != null && kw.trim() !== model.keywordRequired;
  const doOk = () => {
    if (okDisabled) return;
    close();
    model.onOk({ skip });
  };
  const doCancel = () => {
    close();
    model.onCancel?.();
  };
  return (
    <div className="confirm-box">
      <p id="confirmMsg">{model.message}</p>
      {model.skipLabel != null && (
        <label id="confirmSkipLabel" style={{ display: 'flex', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px', cursor: 'pointer', justifyContent: 'center', alignItems: 'center', gap: '6px' }}>
          <input type="checkbox" id="confirmSkip" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          <span id="confirmSkipText">{model.skipLabel}</span>
        </label>
      )}
      {model.keywordPlaceholder != null && (
        // keyword-gated wipe: the input is the sole focus target the moment the modal opens (matches the old openClearAllConfirm focus()).
        <input type="text" id="confirmKeyword" className="search-box" style={{ marginBottom: '14px', fontSize: '13px' }} autoComplete="off" placeholder={model.keywordPlaceholder} value={kw} onChange={(e) => setKw(e.target.value)} autoFocus />
      )}
      <div className="confirm-actions">
        <button className="btn-outline" id="confirmCancel" type="button" onClick={doCancel}>
          {model.cancelLabel}
        </button>
        <button className="btn-danger" id="confirmOk" type="button" onClick={doOk} disabled={okDisabled}>
          {model.okLabel}
        </button>
      </div>
    </div>
  );
}

export function ConfirmHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  // #confirmOverlay is the portal target (viewer-owned): toggle its .show class from model
  // presence (CSS shows/hides the modal; setupModalChrome observes it for the modal-open
  // body class + titlebar). useLayoutEffect = before paint.
  useLayoutEffect(() => {
    const el = document.getElementById('confirmOverlay');
    if (el) el.classList.toggle('show', !!m);
  }, [m]);
  // Backdrop click (on #confirmOverlay itself, outside .confirm-box) cancels — attached
  // once on the static element, like the lightbox's backdrop.
  useEffect(() => {
    const el = document.getElementById('confirmOverlay');
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.target !== el) return;
      const cur = get();
      close();
      cur?.onCancel?.();
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);
  const host = document.getElementById('confirmOverlay');
  return m && host ? createPortal(<ConfirmBox key={m.openId} model={m} />, host) : null;
}

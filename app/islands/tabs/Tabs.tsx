// Presentational tab strip. Emits the SAME DOM the old viewer.js innerHTML did —
// `.tab-item[data-tab]` (+active/+pinned), `.tab-body > .tab-icon + .tab-title`,
// optional `.tab-close[data-close]`, and a trailing `.tab-new` — so the delegated
// handlers on #tabBarInner (click/auxclick/contextmenu/keydown/focusout) keep
// firing. React renders; corpusStore owns tabs/activeTabId/editingId (P4-B
// slice⑯), viewer.js owns their mutation + every event. (React also dodges the
// old "a <button> can't contain the .tab-close button" HTML-parser hazard — it
// builds the DOM via createElement.)

// The strip model TabsHost pulls from renderer/tabs.ts's corpusTabsSource.
export interface TabModel {
  id: string;
  title: string;
  icon: string;
  active?: boolean;
  pinned?: boolean;
  showClose?: boolean;
}
export interface TabsModel {
  tabs: TabModel[];
  editingId?: string | null;
  closeTitle?: string;
  newTitle?: string;
}

// Trailing ＋ (new tab) — ported 1:1 from viewer.js.
function NewIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ✕ (close tab) — ported 1:1 from viewer.js.
function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function Tab({ t, editing, closeTitle }: { t: TabModel; editing?: boolean; closeTitle?: string }) {
  const cls = 'tab-item' + (t.active ? ' active' : '') + (t.pinned ? ' pinned' : '');
  return (
    <div className={cls} role="tab" aria-selected={t.active ? 'true' : 'false'} tabIndex={0} data-tab={t.id}>
      <span className="tab-body">
        {/* icon SVG comes from viewer.js (pin glyph or TAB_ICONS[iconType]); the
            .tab-icon span is the existing wrapper, so insert the SVG straight in. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: established SVG-glyph pattern — app-defined constants, never user content */}
        <span className="tab-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: t.icon }} />
        {editing ? <input className="tab-rename-input" defaultValue={t.title} /> : <span className="tab-title">{t.title}</span>}
      </span>
      {t.showClose && (
        <button className="tab-close" data-close={t.id} data-tip={closeTitle} aria-label={closeTitle}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

export function Tabs({ model }: { model: TabsModel | null }) {
  if (!model) return null;
  return (
    <>
      {model.tabs.map((t) => (
        <Tab key={t.id} t={t} editing={t.id === model.editingId} closeTitle={model.closeTitle} />
      ))}
      <button className="tab-new" data-tip={model.newTitle} aria-label={model.newTitle}>
        <NewIcon />
      </button>
    </>
  );
}

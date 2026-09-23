import { startBulkEntry } from './bulk-entry.ts';
import { getContentSite } from './extractor/index.ts';
import { createI18n } from './i18n.ts';
import { ICONS, makeIcon } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { userOnly } from './user-gesture.ts';

const DISMISSED = 'bulkDiscoveryDismissed';

/** 一覧への SPA 遷移も含めて、取り込みの入口を案内する。 */
export function startBulkDiscovery(): () => void {
  let disposed = false;
  let shown = false;
  let lastUrl = '';
  let surface: StatusSurface | undefined;
  const hide = () => {
    surface?.remove();
    surface = undefined;
  };
  const check = async () => {
    const url = location.href;
    if (url === lastUrl || disposed) return;
    lastUrl = url;
    hide();
    if (shown || window.__snsPostSaveCleanup) return;
    const prefs = await chrome.storage.local.get(DISMISSED);
    if (prefs[DISMISSED]) return;
    const site = getContentSite();
    if (!site || !(await site.isBulkCapturePage?.())) return;
    const { getMessage: t } = await createI18n();
    if (disposed || url !== location.href || window.__snsPostSaveCleanup) return;
    shown = true;
    const banner = new StatusSurface({ resting: ICONS.drop });
    surface = banner;
    banner.el.dataset.hologramBulkDiscovery = '';
    banner.setState('idle');
    const title = document.createElement('div');
    title.textContent = t(location.pathname.startsWith('/i/history') ? 'bulkIntroSaved' : 'bulkIntro');
    const description = document.createElement('div');
    description.className = 'bulk-description';
    description.textContent = t('bulkIntroDescription');
    const actions = document.createElement('div');
    actions.className = 'bulk-actions';
    const remember = () => void chrome.storage.local.set({ [DISMISSED]: true }).catch(() => {});
    const button = (text: string, onClick: () => void) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'action';
      el.textContent = text;
      el.onclick = userOnly<MouseEvent>((event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      return el;
    };
    actions.append(
      button(t('bulkStart'), () => {
        hide();
        remember();
        void startBulkEntry();
      }),
      button(t('bulkNeverShow'), () => {
        hide();
        remember();
      }),
    );
    banner.label.append(title, description, actions);
    const close = button('', hide);
    close.classList.add('bulk-close');
    close.setAttribute('aria-label', t('bulkCloseIntro'));
    close.append(makeIcon(ICONS.cross, 16));
    banner.slot(close);
    banner.mount();
    banner.enter();
  };
  const refresh = () => void check().catch(() => {});
  const timer = setInterval(refresh, 1000);
  window.addEventListener('hologram:bulk-start', hide);
  refresh();
  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('hologram:bulk-start', hide);
    hide();
  };
}

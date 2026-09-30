import type { HologramI18nApi } from './i18n.ts';
import { ICONS, makeIcon } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { userOnly } from './user-gesture.ts';

export const SAVE_TOAST_DURATION_MS = 2000;
const SUCCESS_DURATION_MS = 2000;
export interface SaveNoticeDetails {
  url?: string;
  savedSummary?: string;
}

// 進行・成功は集約し、失敗は確認または再試行するまで残す。
export class SaveToasts {
  private active = new Set<string>();
  private completed = 0;
  private progressCount = 0;
  private progress: StatusSurface | null = null;
  private failures = new Map<string, { target: string; text: string; retry?: () => void; severity: 'error' | 'partial' | 'idle'; details?: SaveNoticeDetails }>();
  private failure: StatusSurface | null = null;
  private failureDetails: HTMLElement | null = null;
  private failureGroup: HTMLElement | null = null;
  private detailsOpen = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private t: HologramI18nApi['getMessage']) {}

  clearFailure(id: string) {
    if (this.failures.delete(id)) this.renderFailures();
  }

  begin(id: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active.add(id);
    this.renderProgress();
  }

  end(id: string, success: boolean) {
    if (!this.active.delete(id)) return;
    if (success) this.completed++;
    this.renderProgress();
    if (!this.active.size) this.expire();
  }

  notice(id: string, target: string, text: string, retry?: () => void, severity: 'error' | 'partial' | 'idle' = 'error', details?: SaveNoticeDetails) {
    if (severity === 'idle' || (!details && !retry)) {
      const surface = new StatusSurface({ resting: ICONS.warn, variant: 'toast', role: severity === 'error' ? 'alert' : 'status' });
      surface.el.dataset.hologramSaveBanner = '';
      surface.setState(severity, severity === 'error' ? text : undefined);
      this.close(surface, () => surface.remove());
      surface.mount();
      if (severity !== 'error') surface.announce(text);
      surface.enter();
      if (severity === 'idle') setTimeout(() => surface.exit(), SAVE_TOAST_DURATION_MS);
      return;
    }
    this.failures.set(id, { target, text, retry, severity, details });
    this.renderFailures();
  }

  private button(label: string, action: () => void, once = true) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.textContent = label;
    button.onclick = userOnly<MouseEvent>((event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = once;
      action();
    });
    return button;
  }

  private close(surface: StatusSurface, action: () => void) {
    const button = this.button(this.t('toastClose'), action);
    button.classList.add('toast-close');
    button.setAttribute('aria-label', this.t('toastClose'));
    button.replaceChildren(makeIcon(ICONS.cross, 14));
    surface.slot(button);
    surface.el.style.pointerEvents = 'auto';
    return button;
  }

  private renderProgress() {
    if (!this.active.size && !this.completed) {
      this.progress?.remove();
      this.progress = null;
      this.progressCount = 0;
      return;
    }
    if (!this.progress) {
      this.progress = new StatusSurface({ resting: ICONS.check, variant: 'toast' });
      this.progress.el.dataset.hologramSaveProgress = '';
      this.progress.mount();
      this.progress.enter();
    }
    const text = this.active.size ? this.t('toastProgress', [this.active.size]) : this.t('toastSaved', [this.completed]);
    this.progress.setState(this.active.size ? 'busy' : 'success', text);
    this.progressCount = Math.max(this.progressCount, this.active.size + this.completed);
    const visible = document.createElement('span');
    visible.textContent = text;
    const measures = ['toastProgress', 'toastSaved'].map((key) => {
      const span = document.createElement('span');
      span.className = 'toast-measure';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = this.t(key, [this.progressCount]);
      return span;
    });
    this.progress.label.replaceChildren(visible);
    const content = document.createElement('div');
    content.className = 'toast-progress-content';
    content.append(this.progress.badge, this.progress.label);
    this.progress.el.replaceChildren(...measures, content);
    this.progress.el.style.pointerEvents = 'auto';
  }

  private expire() {
    this.timer = setTimeout(() => {
      if (this.progress?.el.matches(':hover') || this.progress?.el.contains(this.progress.el.getRootNode() instanceof ShadowRoot ? (this.progress.el.getRootNode() as ShadowRoot).activeElement : document.activeElement)) {
        this.expire();
        return;
      }
      this.resetProgress();
    }, SUCCESS_DURATION_MS);
  }

  private resetProgress() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.progress?.exit();
    this.progress = null;
    this.completed = 0;
    this.progressCount = 0;
  }

  private renderFailures() {
    const previousWidth = this.detailsOpen ? this.failureGroup?.style.width : '';
    this.failure?.remove();
    this.failureGroup?.remove();
    this.failureGroup = null;
    this.failureDetails?.remove();
    this.failureDetails = null;
    this.failure = null;
    if (!this.failures.size) {
      this.detailsOpen = false;
      return;
    }
    const severity = [...this.failures.values()].some((x) => x.severity === 'error') ? 'error' : ([...this.failures.values()][0]?.severity ?? 'idle');
    const surface = new StatusSurface({ resting: ICONS.warn, variant: 'toast', role: severity === 'error' ? 'alert' : 'status' });
    this.failure = surface;
    surface.el.dataset.hologramSaveBanner = '';
    const entries = [...this.failures.values()];
    const text = entries.length === 1 && entries[0] ? entries[0].text : this.t('toastFailed', [entries.length]);
    surface.setState(severity, severity === 'error' ? text : undefined);
    const panel = document.createElement('div');
    panel.className = 'surface';
    panel.dataset.variant = 'toast';
    panel.dataset.hologramToastDetails = '';
    panel.id = `hologram-toast-details-${crypto.randomUUID()}`;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', this.t('toastFailureDetails'));
    this.failureDetails = panel;
    const toggle = this.button(
      this.t('toastDetails'),
      () => {
        this.detailsOpen = !this.detailsOpen;
        updateDetails();
      },
      false,
    );
    toggle.classList.add('toast-details-toggle');
    toggle.setAttribute('aria-controls', panel.id);
    const updateDetails = () => {
      if (this.detailsOpen && this.failureGroup && !surface.el.hidden && !this.failureGroup.style.width) {
        this.failureGroup.style.width = `${surface.el.getBoundingClientRect().width}px`;
      }
      panel.hidden = !this.detailsOpen;
      surface.el.hidden = this.detailsOpen;
      toggle.setAttribute('aria-expanded', String(this.detailsOpen));
      if (this.detailsOpen) panel.querySelector<HTMLButtonElement>('button')?.focus();
    };
    const heading = document.createElement('div');
    heading.className = 'toast-details-heading';
    const dismissDetails = this.button(
      this.t('toastClose'),
      () => {
        this.failures.clear();
        this.renderFailures();
      },
      false,
    );
    dismissDetails.classList.add('toast-close');
    dismissDetails.setAttribute('aria-label', this.t('toastClose'));
    dismissDetails.replaceChildren(makeIcon(ICONS.cross, 14));
    heading.append(dismissDetails);
    panel.appendChild(heading);
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      this.failures.clear();
      this.renderFailures();
    });
    const list = document.createElement('div');
    list.className = 'toast-failures';
    for (const [id, entry] of this.failures) {
      const row = document.createElement('div');
      row.className = 'toast-failure';
      const reason = document.createElement('div');
      reason.textContent = entry.text;
      row.appendChild(reason);
      if (entry.details?.savedSummary && entry.details.savedSummary !== entry.text) {
        const summary = document.createElement('div');
        summary.className = 'toast-target';
        summary.textContent = entry.details.savedSummary;
        row.appendChild(summary);
      }
      if (entry.details?.url && /^https?:\/\//i.test(entry.details.url)) {
        const link = document.createElement('a');
        link.href = entry.details.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = this.t('toastOpenOriginal');
        row.appendChild(link);
      }
      if (entry.retry)
        row.appendChild(
          this.button(this.t('toastRetry'), () => {
            this.failures.delete(id);
            this.renderFailures();
            entry.retry?.();
          }),
        );
      list.appendChild(row);
    }
    panel.appendChild(list);
    const close = this.close(surface, () => {
      this.failures.clear();
      this.renderFailures();
    });
    const actions = document.createElement('div');
    actions.className = 'toast-actions';
    actions.append(toggle);
    surface.slot(actions);
    actions.append(close);
    surface.mount();
    const group = document.createElement('div');
    group.className = 'toast-failure-group';
    if (previousWidth) group.style.width = previousWidth;
    surface.el.before(group);
    group.append(panel, surface.el);
    this.failureGroup = group;
    updateDetails();
    if (severity !== 'error') surface.announce(text);
    surface.enter();
  }
}

import type { HologramI18nApi } from './i18n.ts';
import { ICONS, makeIcon } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { userOnly } from './user-gesture.ts';

// 進行・成功は集約し、失敗は確認または再試行するまで残す。
export class SaveToasts {
  private active = new Set<string>();
  private completed = 0;
  private progress: StatusSurface | null = null;
  private failures = new Map<string, { target: string; text: string; retry?: () => void; severity: 'error' | 'partial' | 'idle' }>();
  private failure: StatusSurface | null = null;
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

  notice(id: string, target: string, text: string, retry?: () => void, severity: 'error' | 'partial' | 'idle' = 'error') {
    if (severity !== 'error') {
      const surface = new StatusSurface({ resting: ICONS.warn, variant: 'toast' });
      surface.el.dataset.hologramSaveBanner = '';
      surface.setState(severity);
      this.close(surface, () => surface.remove());
      surface.mount();
      surface.announce(text);
      surface.enter();
      if (severity === 'idle') setTimeout(() => surface.exit(), 3500);
      return;
    }
    this.failures.set(id, { target, text, retry, severity });
    this.renderFailures();
  }

  private button(label: string, action: () => void) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.textContent = label;
    button.onclick = userOnly<MouseEvent>((event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
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
  }

  private renderProgress() {
    if (!this.active.size && !this.completed) {
      this.progress?.remove();
      this.progress = null;
      return;
    }
    if (!this.progress) {
      this.progress = new StatusSurface({ resting: ICONS.check, variant: 'toast' });
      this.progress.el.dataset.hologramSaveProgress = '';
      this.progress.mount();
      this.progress.enter();
    }
    const text = this.active.size ? this.t(this.completed ? 'toastProgressCompleted' : 'toastProgress', [this.active.size, this.completed]) : this.t('toastSaved', [this.completed]);
    this.progress.setState(this.active.size ? 'busy' : 'success', text);
    this.progress.el.style.pointerEvents = 'auto';
    if (!this.active.size) this.close(this.progress, () => this.resetProgress());
  }

  private expire() {
    this.timer = setTimeout(() => {
      if (this.progress?.el.matches(':hover') || this.progress?.el.contains(this.progress.el.getRootNode() instanceof ShadowRoot ? (this.progress.el.getRootNode() as ShadowRoot).activeElement : document.activeElement)) {
        this.expire();
        return;
      }
      this.resetProgress();
    }, 3500);
  }

  private resetProgress() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.progress?.remove();
    this.progress = null;
    this.completed = 0;
  }

  private renderFailures() {
    this.failure?.remove();
    this.failure = null;
    if (!this.failures.size) return;
    const severity = [...this.failures.values()].some((x) => x.severity === 'error') ? 'error' : ([...this.failures.values()][0]?.severity ?? 'idle');
    const surface = new StatusSurface({ resting: ICONS.warn, variant: 'toast', role: severity === 'error' ? 'alert' : 'status' });
    this.failure = surface;
    surface.el.dataset.hologramSaveBanner = '';
    surface.setState(severity);
    const list = document.createElement('div');
    list.className = 'toast-failures';
    for (const [id, entry] of this.failures) {
      const row = document.createElement('div');
      row.className = 'toast-failure';
      if (entry.target) {
        const target = document.createElement('div');
        target.className = 'toast-target';
        target.textContent = entry.target;
        row.appendChild(target);
      }
      const reason = document.createElement('div');
      reason.textContent = entry.text;
      row.appendChild(reason);
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
    if (this.failures.size > 1) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = this.t('toastFailed', [this.failures.size]);
      details.append(summary, list);
      surface.label.appendChild(details);
    } else surface.label.appendChild(list);
    this.close(surface, () => {
      this.failures.clear();
      this.renderFailures();
    });
    surface.mount();
    surface.enter();
  }
}

import type { SaveLogEntry } from './capture-log.ts';

export const DIAGNOSTIC_RATE_KEY = 'captureLogRateState';
export const DIAGNOSTIC_ALARM = 'hologram:capture-log-window';
export const DIAGNOSTIC_WINDOW_MS = 60_000;
const LIMIT = 200;
const MAX_COUNTER = 2_147_483_647;
const FIELDS = new Set('stage phase via saveId captureId type platform host url error stack source uncaught operation suppressed reached reason count total done queued savedNothing inFlight site category message elapsedMs durationMs mediaCount retry tries code delivery'.split(' '));
const STAGES = new Set(['activate', 'save', 'metadata', 'bridge', 'result', 'bulk', 'queue', 'unknown']);
const PHASES = new Set(['begin', 'ok', 'fail', 'cancel', 'skip', 'evict', 'giveup']);

// 転送前に閉じたスカラー形へ揃える。文字列、欄数、JSON のバイト数を別々に制限する。
export function boundedDiagnostic(value: unknown): SaveLogEntry | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.stage !== 'string' || typeof source.phase !== 'string' || !STAGES.has(source.stage) || !PHASES.has(source.phase)) return null;
  const result: Record<string, unknown> = { stage: source.stage, phase: source.phase };
  for (const key of FIELDS) {
    if (key === 'stage' || key === 'phase') continue;
    const field = source[key];
    if (typeof field === 'string') result[key] = field.slice(0, key === 'stack' ? 2048 : 1024);
    else if (field === null || typeof field === 'boolean' || (typeof field === 'number' && Number.isFinite(field))) result[key] = field;
    if (new TextEncoder().encode(JSON.stringify(result)).length > 8000) delete result[key];
  }
  return result as SaveLogEntry;
}

interface RateState {
  startedAt: number;
  count: number;
  suppressed: number;
}
interface AdmissionOptions {
  read(): Promise<unknown>;
  write(state: RateState, summary?: SaveLogEntry & { ts: string }): Promise<void>;
  alarm(when: number): Promise<void>;
  emit(entry: SaveLogEntry, keepLocal: boolean, alreadyStored?: boolean): void;
  now?: () => number;
}

// 一つの worker の受理を直列化し、永続予約を確定したバッチだけを出力する。
// 起動待ち・書込み待ちの payload は 200 件まで。残りは有限の件数に集約する。
export function createDiagnosticAdmission(options: AdmissionOptions) {
  const now = options.now ?? Date.now;
  let state: RateState = { startedAt: now(), count: 0, suppressed: 0 };
  let loaded = false;
  let failed = false;
  let retryAfter = 0;
  let running = false;
  let overflow = 0;
  let scheduledAt = 0;
  let pending: Array<{ entry: SaveLogEntry; keepLocal: boolean }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const add = (a: number, b: number) => Math.min(MAX_COUNTER, a + b);
  const schedule = async () => {
    if (!state.count && !state.suppressed) return;
    const when = state.startedAt + DIAGNOSTIC_WINDOW_MS;
    if (scheduledAt === when) return;
    await options.alarm(when);
    scheduledAt = when;
  };
  const load = async () => {
    const raw = (await options.read()) as Partial<RateState> | undefined;
    const valid =
      raw &&
      typeof raw.startedAt === 'number' &&
      Number.isSafeInteger(raw.startedAt) &&
      raw.startedAt >= 0 &&
      raw.startedAt <= now() &&
      typeof raw.suppressed === 'number' &&
      Number.isSafeInteger(raw.suppressed) &&
      raw.suppressed >= 0 &&
      raw.suppressed <= MAX_COUNTER &&
      (raw.count === undefined || (Number.isSafeInteger(raw.count) && raw.count >= 0 && raw.count <= LIMIT));
    if (valid) state = { startedAt: Number(raw.startedAt), count: raw.count ?? LIMIT, suppressed: Number(raw.suppressed) };
    // 壊れた状態は予算ゼロとして一窓待つ。欠落した初期状態とは区別する。
    else if (raw !== undefined) state = { startedAt: now(), count: LIMIT, suppressed: 0 };
    loaded = true;
    failed = false;
    await schedule();
  };
  const expire = async () => {
    if (now() < state.startedAt + DIAGNOSTIC_WINDOW_MS) return;
    const summary = state.suppressed ? { stage: 'unknown' as const, phase: 'fail' as const, error: 'capture log rate limit', suppressed: state.suppressed, ts: new Date(now()).toISOString() } : undefined;
    const next = { startedAt: now(), count: 0, suppressed: 0 };
    // 同じ storage.set に summary と次の窓を保存する。終了が挟まっても summary は残る。
    await options.write(next, summary);
    state = next;
    scheduledAt = 0;
    await schedule();
    if (summary) options.emit(summary, false, true);
  };
  const drain = async () => {
    if (running || failed) return;
    running = true;
    try {
      if (!loaded) await load();
      await expire();
      while (pending.length || overflow) {
        const batch = pending;
        pending = [];
        const extra = overflow;
        overflow = 0;
        const accepted = Math.min(LIMIT - state.count, batch.length);
        const next = { ...state, count: state.count + accepted, suppressed: add(state.suppressed, add(extra, batch.length - accepted)) };
        await options.write(next);
        state = next;
        await schedule();
        for (const item of batch.slice(0, accepted)) options.emit(item.entry, item.keepLocal);
      }
    } catch {
      // 失敗はログへ再帰させない。既に出力済みの数を推測せず、再読込みまで閉じる。
      failed = true;
      retryAfter = now() + 5000;
      loaded = false;
      overflow = add(overflow, pending.length);
      pending = [];
      scheduledAt = 0;
      try {
        await options.alarm(now() + DIAGNOSTIC_WINDOW_MS);
      } catch {
        /* 次の入力で再試行 */
      }
    } finally {
      running = false;
    }
  };
  const wake = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    failed = false;
    scheduledAt = 0;
    void drain();
  };
  void drain();
  return {
    submit(value: unknown, keepLocal = false) {
      const entry = boundedDiagnostic(value);
      if (!entry) return;
      if (failed) {
        if (now() < retryAfter) {
          overflow = add(overflow, 1);
          return;
        }
        wake();
      }
      if (pending.length < LIMIT) pending.push({ entry, keepLocal });
      else overflow = add(overflow, 1);
      if (loaded && state.count >= LIMIT) {
        // 件数だけの書込みを集約する。alarm が worker の終了後も期限を運ぶ。
        if (!timer)
          timer = setTimeout(() => {
            timer = undefined;
            void drain();
          }, 1000);
      } else void drain();
    },
    wake,
  };
}

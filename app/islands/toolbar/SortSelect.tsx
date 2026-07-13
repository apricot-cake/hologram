import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Sidebar sort select (post / poster), on shadcn Select. One component, two mounts —
// the options/storeKey props parameterize it. The native <select> stays hidden
// (.cs-host) as viewer's value source: on pick we drive it (set value + dispatch
// 'change') so the existing change handlers (renderPosts / renderPosters, and the
// per-tab sort persistence) fire UNCHANGED. The active value is mirrored into
// corpusStore so the trigger label updates without reading the hidden select.
//
// Option LABELS come from i18n keys here (not the native <select>'s textContent), so
// the component never races viewer's option-text setup and survives a language reload
// by re-mounting. `items` must be passed to the Root: Base UI's Select.Value renders
// the raw value string otherwise.

// `sel` = the (now hidden) native <select> value source. `options` = [{ value, key }]
// where key is the i18n message key for the label.
export function SortSelect({ sel, storeKey, options }: { sel: HTMLSelectElement; storeKey: string; options: { value: string; key: string }[] }) {
  const subscribe = useCallback((cb: () => void) => storeSubscribe(storeKey, cb), [storeKey]);
  const getVal = useCallback((): string => {
    const v = storeGet(storeKey);
    return v != null ? v : sel.value; // store wins; fall back to the native select's initial value
  }, [storeKey, sel]);
  const value = useSyncExternalStore(subscribe, getVal);

  const items = useMemo(() => Object.fromEntries(options.map((o) => [o.value, t(o.key)])), [options]);

  const choose = useCallback(
    (next: string | null) => {
      if (next == null) return; // Base UI passes null when the selection is cleared — never our case
      // Drive the native select so viewer's existing change handlers fire, then mirror
      // into the store so the trigger label updates immediately (idempotent set => no echo).
      if (sel.value !== next) {
        sel.value = next;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      storeSet(storeKey, next);
    },
    [sel, storeKey],
  );

  return (
    <Select items={items} value={value} onValueChange={choose}>
      <SelectTrigger size="sm" className="w-full font-sans">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {t(o.key)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

import { Combobox } from '@base-ui/react/combobox';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { setSelectOpen } from '../../services/open-select-registry.ts';
import { t } from '../../_shared/i18n.ts';

// Interface-font picker (Settings → Appearance, #137). Base UI Combobox again
// (inspector/TagField.tsx already established the pattern for this codebase), but single-
// value rather than multi-tag: the committed pref IS the combobox's own selected value,
// and the input's live text is a SEPARATE query the caller previews on every keystroke —
// see settings/ipc.ts's uiFont.preview/commit split.
//
// The item list comes from window.queryLocalFonts() (Local Font Access API), loaded lazily
// on first open — Electron 43 grants it with no permission prompt (verified via the CDP
// sandbox: window.queryLocalFonts() resolved 359 real installed families with no dialog),
// but the API itself is optional web platform surface, so a build/OS where it is absent
// (typeof window.queryLocalFonts !== 'function') degrades to an empty item list: the field
// keeps working as a plain free-text input, which is the fallback the Issue's design
// explicitly allows.
export function FontCombobox({ value, onPreview, onCommit }: { value: string; onPreview: (v: string) => void; onCommit: (v: string) => void }) {
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<string[] | null>(null); // null = not queried yet
  const highlightedRef = useRef<string | null>(null);
  const popupId = useRef(Symbol('ui-font-combobox'));

  // Reconcile with the committed value when it changes out from under us (the
  // config.json reconcile in ui-font-api.ts's boot, or a future external setter) — same
  // shape as Appearance's theme Select reconciling after getPrefs() resolves.
  useEffect(() => {
    setQuery(value);
  }, [value]);
  useEffect(() => {
    const id = popupId.current;
    return () => setSelectOpen(id, false);
  }, []);

  const loadItems = () => {
    if (items !== null) return; // already queried (or already known unsupported)
    if (typeof window.queryLocalFonts !== 'function') {
      setItems([]);
      return;
    }
    window
      .queryLocalFonts()
      .then((fonts) => {
        const families = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b));
        setItems(families);
      })
      .catch(() => setItems([])); // permission denied / not implemented on this OS — free text still works
  };

  const commit = (v: string) => {
    const cleaned = v.trim();
    setQuery(cleaned);
    onCommit(cleaned);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Cancel the in-progress edit: restore the last committed font, live, and stop the
      // popup from also eating the Escape (it already closes itself; this only undoes
      // the preview so the rest of the app doesn't stay wearing an uncommitted font).
      setQuery(value);
      onPreview(value);
      return;
    }
    if (e.key !== 'Enter') return;
    if (highlightedRef.current) return; // Base UI commits the highlighted item instead
    e.preventDefault();
    commit(query);
  };

  return (
    <Combobox.Root
      items={items || []}
      value={value || null}
      onValueChange={(picked) => {
        // null covers both the Clear button and a programmatic reset — either way,
        // that means "back to the default stack".
        const v = picked ?? '';
        setQuery(v);
        onPreview(v);
        onCommit(v);
      }}
      inputValue={query}
      onInputValueChange={(v) => {
        setQuery(v);
        onPreview(v.trim());
      }}
      onOpenChange={(open) => {
        setSelectOpen(popupId.current, open);
        if (open) loadItems();
      }}
      onItemHighlighted={(it) => {
        highlightedRef.current = (it as string | undefined) ?? null;
      }}
    >
      <Combobox.InputGroup className="flex w-56 items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
        <Combobox.Input placeholder={t('uiFontPlaceholder')} onKeyDown={onKeyDown} onBlur={() => commit(query)} className="h-5 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground" />
        {query ? (
          <Combobox.Clear aria-label={t('uiFontClear')} className="cursor-pointer rounded-full text-muted-foreground hover:text-foreground">
            ×
          </Combobox.Clear>
        ) : null}
      </Combobox.InputGroup>
      <Combobox.Portal>
        {/* z-[13500]: same legacy-overlay-coexistence slot components/ui/select.tsx uses. */}
        <Combobox.Positioner side="bottom" align="start" sideOffset={4} collisionPadding={8} className="isolate z-[13500]">
          <Combobox.Popup className="max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 font-sans text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground">{t('uiFontNoMatch')}</Combobox.Empty>
            <Combobox.List>
              {(family: string) => (
                <Combobox.Item key={family} value={family} className="flex cursor-default items-center rounded-sm px-2 py-1 text-xs select-none data-highlighted:bg-muted" style={{ fontFamily: `"${family.replace(/"/g, '\\"')}"` }}>
                  {family}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

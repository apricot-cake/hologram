// The search box + suggest dropdown as a react-aria ComboBox — the first island
// that OWNS its input DOM instead of mirroring viewer-owned DOM. The value source
// is corpusStore 'searchQuery' (established in this slice's stage 1): typing
// pushes into the store; programmatic writes (resets / tab & history restore)
// flow back into the controlled input. Suggestion DATA (buildSuggest) and what a
// pick DOES (applySuggest / confirmEditingTextLeaf) stay in viewer.js, pulled
// lazily through the corpusSearchBox bridge — react-aria supplies keyboard nav,
// open/close, positioning and aria wiring (the hand-rolled suggestIdx/fixed-div
// machinery is gone).
import { useCallback, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import { ComboBox, Input, ListBox, ListBoxItem, Popover } from 'react-aria-components';

const SUG_ICON = { tag: '\u{1F3F7}', user: '\u{1F464}', folder: '\u{1F4C1}' };
const handlers = () => (window.corpusSearchBox && window.corpusSearchBox.handlers()) || null;

export function SearchBox({ placeholder }) {
  const subscribe = useCallback((cb) => window.corpusStore.subscribe('searchQuery', cb), []);
  const value = useSyncExternalStore(subscribe, () => String(window.corpusStore.get('searchQuery') || ''));
  // Focus recomputes suggestions for an unchanged value (viewer may have booted /
  // the library may have changed since the last keystroke) — bump to bust the memo.
  const [focusTick, bumpFocus] = useReducer((x) => x + 1, 0);
  const pickingRef = useRef(false);   // swallow react-aria's own input commit during a pick

  // Suggestions are derived synchronously from the value (buildSuggest is a fast
  // pure scan; the HEAVY typing side effect — re-filtering the grid — stays
  // debounced in viewer.js). Deriving instead of setState keeps the popover in
  // lockstep: any path that empties the value closes it (empty collection).
  const items = useMemo(() => {
    const h = handlers();
    const q = value.trim();
    if (!q || !h) return [];
    return h.getSuggestions(q).map((it) => ({ ...it, id: it.kind + ':' + it.value }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focusTick]);

  const onInputChange = (v) => {
    if (pickingRef.current) return;   // the selection commit echoes the item's text — the pick already cleared the value
    window.corpusStore.set('searchQuery', v);
  };

  const onSelectionChange = (key) => {
    if (key == null) return;
    const it = items.find((i) => i.id === key);
    if (!it) return;
    pickingRef.current = true;
    setTimeout(() => { pickingRef.current = false; }, 0);
    const h = handlers();
    if (h) h.onPick({ kind: it.kind, value: it.value, label: it.label });   // viewer: drop the editing text leaf + addFilter (clears the value too)
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    // A focused option means react-aria commits it (→ onSelectionChange). Bare
    // Enter confirms the free-text term as a query-tree leaf (viewer's
    // confirmEditingTextLeaf path — it also empties the box, closing the popover).
    if (e.currentTarget.getAttribute('aria-activedescendant')) return;
    e.preventDefault();
    const h = handlers();
    if (h) h.onConfirmText();
  };

  // allowsEmptyCollection: react-aria decides open/close against the collection AS
  // OF the input event, so a paste into an empty box (one event, items still [])
  // would never open with allowsEmptyCollection=false. Allow empty opens and hide
  // the empty panel in CSS instead (.search-suggest:not(:has(.sg-row))).
  return (
    <ComboBox
      className="search-cb"
      aria-label={placeholder}
      menuTrigger="focus"
      allowsCustomValue
      allowsEmptyCollection
      items={items}
      inputValue={value}
      onInputChange={onInputChange}
      selectedKey={null}
      onSelectionChange={onSelectionChange}
    >
      <Input
        id="searchBox"
        className={'search-box' + (value.trim() ? ' has-value' : '')}
        placeholder={placeholder}
        onFocus={bumpFocus}
        onKeyDown={onKeyDown}
      />
      <Popover className="search-suggest" offset={4} placement="bottom start">
        <ListBox shouldFocusWrap>
          {(it) => (
            <ListBoxItem id={it.id} textValue={it.label} className="sg-row">
              <span className="sg-ic">{SUG_ICON[it.kind]}</span>
              <span className="sg-name">{it.label}</span>
              <span className="sg-n">{it.note}</span>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}

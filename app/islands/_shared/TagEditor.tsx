import { useState, useRef, useLayoutEffect, useMemo } from 'react';

// Shared inline tag editor — used by the post/poster inspector (ivTag*/pdTag*, the
// always-live per-card editor) AND the bulk "add tags to selection" modal (edit*, a
// staging list committed on Save). Mirrors the old refreshInspectorTags/
// refreshInspectorPicker/renderEditTags/renderEditPicker + their delegated handlers,
// but the picker filter query is now LOCAL React state instead of a round trip
// through viewer.js: vocabGroups/coocGroups/srcTags arrive unfiltered (full universe)
// and this component filters them by substring match client-side (matching the old
// simple `.includes(q)` filter — no fuzzy search), so keystrokes never touch the
// bridge. The add/filter input doubles as both "type a new tag" and "filter the
// picker", exactly like the old #ivTagInput/#pdTagInput/#editTagInput.
//
// chipsClass/addrowClass/pickerClass/showLabel let the two callers match their own
// (different) DOM/CSS contracts: the inspector wraps everything in one label+chips+
// picker block (iv-tag-chips/iv-tag-addrow), the bulk modal has no internal label and
// uses the plain confirm-dialog classes (edit-current/edit-addrow/edit-picker alone).
export interface TagPickItem {
  tag: string;
  kind?: string | null;
  title?: string;
}
export interface TagPickGroup {
  name: string;
  items: TagPickItem[];
}
export interface TagEditorProps {
  idPrefix: string;
  className?: string | null;
  tags: string[];
  vocabGroups?: TagPickGroup[] | null;
  coocGroups?: TagPickGroup[] | null;
  srcTags?: TagPickItem[] | null;
  labels: Record<string, string>;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  onToggle: (tag: string) => void;
  onContextMenu: (tag: string, x: number, y: number) => void;
  autoFocus?: boolean;
  showLabel?: boolean;
  chipsClass?: string;
  addrowClass?: string;
  pickerClass?: string;
}

export function TagEditor({ idPrefix, className, tags, vocabGroups, coocGroups, srcTags, labels, onAdd, onRemove, onToggle, onContextMenu, autoFocus, showLabel = true, chipsClass = 'iv-tag-chips', addrowClass = 'iv-tag-addrow', pickerClass = 'edit-picker iv-tag-picker' }: TagEditorProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selected = useMemo(() => new Set(tags), [tags]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only focus (new panel open) — matches the old one-shot focus() after showPosterDetail
  useLayoutEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, []);

  const submit = () => {
    const t = query.trim();
    setQuery('');
    if (t) onAdd(t);
    if (inputRef.current) inputRef.current.focus();
  };

  const q = query.trim().toLowerCase();
  const matches = (t: string) => !q || t.toLowerCase().includes(q);

  const chip = (t: string, kind?: string | null, title?: string) => (
    <button
      key={t}
      type="button"
      className={'edit-pick-chip' + (selected.has(t) ? ' on' : '')}
      title={title}
      onClick={() => onToggle(t)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(t, e.clientX, e.clientY);
      }}
    >
      {kind ? <span className={'tag-pal-kind tk-' + kind} /> : null}
      {t}
    </button>
  );

  // Co-occurrence suggestions are context hints, not vocabulary — hidden while the
  // user is filter-typing (typing means "find me a known tag", not "suggest more").
  const filteredCooc = q ? [] : (coocGroups || []).filter((g) => g.items.length);
  const filteredSrc = (srcTags || []).filter((it) => matches(it.tag));
  const filteredGroups = (vocabGroups || []).map((g) => ({ name: g.name, items: g.items.filter((it) => matches(it.tag)) })).filter((g) => g.items.length);
  const isEmpty = !filteredCooc.length && !filteredSrc.length && !filteredGroups.length;

  return (
    <div id={idPrefix + 'TagEdit'} className={className as string | undefined}>
      {showLabel ? <div className="iv-tag-label">{labels.tagsLabel}</div> : null}
      <div id={idPrefix + 'TagChips'} className={chipsClass}>
        {tags.length ? (
          tags.map((t) => (
            <span
              key={t}
              className="tag-chip"
              onClick={() => onRemove(t)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(t, e.clientX, e.clientY);
              }}
            >
              {t} ×
            </span>
          ))
        ) : (
          <span className="edit-empty">{labels.noTags}</span>
        )}
      </div>
      <div className={addrowClass}>
        <input
          ref={inputRef}
          type="text"
          id={idPrefix + 'TagInput'}
          placeholder={labels.newTagPlaceholder}
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="btn-outline" id={idPrefix + 'TagAdd'} onClick={submit}>
          {labels.addBtn}
        </button>
      </div>
      <div id={idPrefix + 'TagPicker'} className={pickerClass}>
        {isEmpty ? (
          <span className="edit-empty">{query ? labels.noMatch : labels.noVocab}</span>
        ) : (
          <>
            {filteredCooc.map((g) => (
              <div className="edit-pick-group" key={g.name}>
                <div className="edit-pick-gname">{g.name}</div>
                <div className="edit-pick-chips">{g.items.map((it) => chip(it.tag, it.kind, it.title))}</div>
              </div>
            ))}
            {filteredSrc.length ? (
              <div className="edit-pick-group">
                <div className="edit-pick-gname">{labels.adoptSource}</div>
                <div className="edit-pick-chips">{filteredSrc.map((it) => chip(it.tag, it.kind))}</div>
              </div>
            ) : null}
            {filteredGroups.map((g) => (
              <div className="edit-pick-group" key={g.name}>
                <div className="edit-pick-gname">{g.name}</div>
                <div className="edit-pick-chips">{g.items.map((it) => chip(it.tag, it.kind))}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

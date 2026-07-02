import { useSyncExternalStore, useRef, useLayoutEffect, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, RefObject } from 'react';

type Commit = (fn?: () => void) => void;
interface FormProps {
  model: CorpusFilterPopoverModel;
  commit: Commit;
}

// Glass date / engagement / poster-date-range popover — ONE always-mounted host that
// renders whatever window.corpusFilterPopover currently holds (or nothing). viewer.js
// owns the field values (open) + apply/remove actions; this island owns the form's
// local input state (controlled inputs) and draws the glass popup. Emits the SAME DOM
// the old imperative builders did (.qf-popover with .chip / .date-input /
// .engagement-select / .engagement-input / .btn-outline.qf-popover-delete / .pd-field)
// so the existing CSS is unchanged. Labels are provided already-localized by viewer (no
// i18n here); numeric/date validation ("apply with nothing entered = no-op") stays in
// viewer's onApply — this component only collects and hands off the raw field values.

// Positions to the right of the anchor (top-aligned), clamped into the viewport —
// mirrors viewer.js placeFlyout() with no maxHeight cap (these are compact forms, not
// the scrolling value list qf-pop caps itself to).
function usePlaceFlyout(popRef: RefObject<HTMLDivElement | null>, anchorRect: CorpusAnchorRect | null | undefined) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: popRef is a stable ref — anchorRect is the only reposition trigger
  useLayoutEffect(() => {
    if (!anchorRect) return;
    const pop = popRef.current;
    if (!pop) return;
    pop.style.left = anchorRect.right + 8 + 'px';
    pop.style.top = anchorRect.top + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > innerWidth - 8) pop.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
    if (pr.bottom > innerHeight - 8) pop.style.top = Math.max(8, innerHeight - pr.height - 8) + 'px';
  }, [anchorRect]);
}

function RemoveApplyRow({ model, commit, applyStyle, onApply }: FormProps & { applyStyle: CSSProperties; onApply: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      {model.editing && (
        <button type="button" className="btn-outline qf-popover-delete" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => commit(model.onRemove)}>
          {model.labels.removeLabel}
        </button>
      )}
      <button type="button" className="btn-outline" style={applyStyle} onClick={() => commit(onApply)}>
        {model.labels.applyLabel}
      </button>
    </div>
  );
}

function DateForm({ model, commit }: FormProps) {
  const [dateField, setDateField] = useState(model.fields.dateField);
  const [from, setFrom] = useState(model.fields.from);
  const [to, setTo] = useState(model.fields.to);
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <button type="button" className={'chip' + (dateField === 'capturedAt' ? ' active' : '')} onClick={() => setDateField(dateField === 'date' ? 'capturedAt' : 'date')}>
          {dateField === 'capturedAt' ? model.labels.typeCaptured : model.labels.typeDate}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <input type="date" className="date-input" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>〜</span>
        <input type="date" className="date-input" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <RemoveApplyRow model={model} commit={commit} applyStyle={{ background: 'var(--indigo-600)', color: '#fff', borderColor: 'var(--indigo-600)' }} onApply={() => model.onApply({ dateField, from, to })} />
    </>
  );
}

function EngForm({ model, commit }: FormProps) {
  const [engType, setEngType] = useState(model.fields.engType);
  const [min, setMin] = useState(model.fields.min);
  const [op, setOp] = useState(model.fields.op);
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <select className="engagement-select" style={{ width: '100%' }} value={engType} onChange={(e) => setEngType(e.target.value)}>
          {(model.typeOptions as { value: string; label: string }[]).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <input type="number" className="engagement-input" min="0" placeholder="0" style={{ flex: 1 }} value={min} onChange={(e) => setMin(e.target.value)} />
        <button type="button" className={'chip' + (op === 'lte' ? ' active' : '')} style={{ minWidth: 40, textAlign: 'center' }} onClick={() => setOp(op === 'gte' ? 'lte' : 'gte')}>
          {op === 'lte' ? model.labels.opLte : model.labels.opGte}
        </button>
      </div>
      <RemoveApplyRow model={model} commit={commit} applyStyle={{ background: 'var(--indigo-600)', color: '#fff', borderColor: 'var(--indigo-600)' }} onApply={() => model.onApply({ engType, min: Number.parseInt(min, 10), op })} />
    </>
  );
}

function PosterDateForm({ model, commit }: FormProps) {
  const [dateField, setDateField] = useState(model.fields.dateField);
  const [from, setFrom] = useState(model.fields.from);
  const [to, setTo] = useState(model.fields.to);
  return (
    <>
      <div className="pd-field">
        <span className="pd-label">{model.labels.dimLabel}</span>
        <select className="engagement-select" style={{ width: '100%' }} value={dateField} onChange={(e) => setDateField(e.target.value)}>
          {(model.dimOptions as { value: string; label: string }[]).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="pd-field">
        <span className="pd-label">{model.labels.rangeLabel}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="date" className="date-input" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>〜</span>
          <input type="date" className="date-input" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <RemoveApplyRow model={model} commit={commit} applyStyle={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }} onApply={() => model.onApply({ dateField, from, to })} />
    </>
  );
}

const FORMS = { date: DateForm, eng: EngForm, posterDate: PosterDateForm };

export function FilterPopoverHost() {
  const model = useSyncExternalStore(window.corpusFilterPopover.subscribe, window.corpusFilterPopover.get);
  const popRef = useRef<HTMLDivElement | null>(null);
  usePlaceFlyout(popRef, model && model.anchorRect);

  // Dismiss on outside-click (capture) / Escape, like the old popovers' shared document
  // listener — but excluding .sb-row / [data-tag-group] clicks, which the row handler
  // already closes-and-reopens itself (avoids a double-close race).
  useEffect(() => {
    if (!model) return;
    const onDoc = (e: MouseEvent) => {
      if (!document.contains(e.target as Node)) return;
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      if ((e.target as Element).closest('.sb-row') || (e.target as Element).closest('[data-tag-group]')) return;
      window.corpusFilterPopover.close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.corpusFilterPopover.close();
    };
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [model]);

  if (!model) return null;
  const commit: Commit = (fn) => {
    window.corpusFilterPopover.close();
    if (fn) fn();
  };
  const Form = FORMS[model.kind];
  return createPortal(
    <div className="qf-popover" ref={popRef} key={model.openId}>
      <Form model={model} commit={commit} />
    </div>,
    document.body,
  );
}

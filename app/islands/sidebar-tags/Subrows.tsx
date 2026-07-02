// The right-chevron arrow — identical to viewer.js CHEV_R, as JSX.
function ChevR() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 1.5l4 4-4 4" />
    </svg>
  );
}

// One button per tag group (＋ the __all / __other pseudo-rows). Emits the SAME
// markup the old viewer.js innerHTML did — class `sb-subrow` (+ active) and the
// `data-tag-group` attribute — so the existing delegated click handler on
// #filterRows keeps catching clicks. React owns rendering; viewer.js keeps owning
// the data + the events. `name` is plain text (React escapes it; no escapeHtml).
export interface SubrowModel {
  key: string;
  name?: string;
  count?: number | string;
  active?: boolean;
}

export function Subrows({ rows }: { rows: SubrowModel[] }) {
  return (
    <>
      {rows.map((r) => (
        <button key={r.key} className={'sb-subrow' + (r.active ? ' active' : '')} type="button" data-tag-group={r.key}>
          <span className="sb-subrow-name">{r.name}</span>
          <span className="sb-subrow-count">{r.count}</span>
          <span className="sb-subrow-arrow">
            <ChevR />
          </span>
        </button>
      ))}
    </>
  );
}

// Presentational search-suggest dropdown rows. Emits the SAME DOM the old
// viewer.js innerHTML did — `.sg-row[data-sg]` (+sel) with `.sg-ic` / `.sg-name` /
// `.sg-n` — so the delegated mousedown on the dropdown (and the search-box keyboard
// nav that re-renders on suggestIdx change) keep working. React renders; viewer.js
// owns suggestItems, suggestIdx, build/apply, positioning, show/hide, and events.
// The icon is a plain emoji (SUG_ICON), so it's text — no dangerouslySetInnerHTML.
export function Suggest({ model }) {
  if (!model || !model.items.length) return null;
  return (
    <>
      {model.items.map((it, i) => (
        <div key={i} className={'sg-row' + (i === model.selIdx ? ' sel' : '')} data-sg={i}>
          <span className="sg-ic">{it.iconEmoji}</span>
          <span className="sg-name">{it.label}</span>
          <span className="sg-n">{it.note}</span>
        </div>
      ))}
    </>
  );
}

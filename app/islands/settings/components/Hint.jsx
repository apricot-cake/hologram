import { Highlight } from './Highlight.jsx';

// Sub-label explanatory text under a control. Reuses the `.hint` style.
export function Hint({ text }) {
  return (
    <div className="hint">
      <Highlight text={text} />
    </div>
  );
}

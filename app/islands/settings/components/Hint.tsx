import { Highlight } from './Highlight.tsx';

// Sub-label explanatory text under a control. Reuses the `.hint` style.
export function Hint({ text }: { text?: string | null }) {
  return (
    <div className="hint">
      <Highlight text={text} />
    </div>
  );
}

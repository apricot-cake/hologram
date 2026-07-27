import { Highlight } from './Highlight.tsx';

// Sub-label explanatory text under a control (shadcn form-description styling).
export function Hint({ text }: { text?: string | null }) {
  return (
    <div className="text-muted-foreground mt-1.5 text-[0.8rem] leading-snug">
      <Highlight text={text} />
    </div>
  );
}

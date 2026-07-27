import type { ReactNode, Ref } from 'react';
import { Highlight } from './Highlight.tsx';

// A settings section: a uniform heading + body. Centralizing the heading here is
// the point of the pilot — sections can't drift on how they render a title.
// `innerRef` exposes the wrapper so the parent can read its textContent for
// cross-page search; `hidden` toggles page visibility.
export function Section({ title, hidden, innerRef, children }: { title: string; hidden?: boolean; innerRef?: Ref<HTMLDivElement>; children?: ReactNode }) {
  return (
    <div className="mb-10 last:mb-0" hidden={hidden} ref={innerRef}>
      <h2 className="mb-1 text-lg font-semibold tracking-tight">
        <Highlight text={title} />
      </h2>
      <div className="pt-3">{children}</div>
    </div>
  );
}

import { Highlight } from './Highlight.jsx';

// A settings section card: a uniform <h2> heading + body, wrapped in `.section`.
// Centralizing the heading here is the point of the pilot — sections can't drift
// on how they render a title. `innerRef` exposes the wrapper so the parent can
// read its textContent for cross-page search; `hidden` toggles page visibility.
export function Section({ title, hidden, innerRef, children }) {
  return (
    <div className="section" hidden={hidden} ref={innerRef}>
      <h2>
        <Highlight text={title} />
      </h2>
      {children}
    </div>
  );
}

import { PracticeMode } from './PracticeMode.tsx';

// Mounted once in App.tsx, alongside the other body-level overlay hosts (Lightbox,
// Settings, TriageHost...). Practice mode carries no keyboard registration of its
// own beyond what PracticeMode.tsx already scopes to its own mounted stage (Space/
// arrows), so this Host is a thin wrapper -- kept as its own component (rather than
// mounting PracticeMode directly from App.tsx) purely to match every other
// full-screen mode own index.tsx entry point, so a reader looking for "where does
// X mode start" finds the same shape every time.
export function PracticeHost() {
  return <PracticeMode />;
}

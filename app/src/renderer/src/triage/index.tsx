import { useEffect } from 'react';
import { loadPinnedTags } from '../services/triage.ts';
import { triageHandleKey } from '../services/orchestrator.ts';
import { TriageMode } from './TriageMode.tsx';

// Mounted once in App.tsx, alongside the other body-level overlay hosts (Lightbox,
// Settings, BulkTagDialog…). Two responsibilities besides rendering the dialog:
//  - reconcile the pinned-tag pref once on mount (triage.ts's own load, same idiom
//    as panels.ts's — see that module's comment for why this isn't in bootApp);
//  - register the triage-scoped keydown listener (1-9/Space/Backspace) for the
//    app's lifetime. It no-ops while triage is closed (triage-builder.ts's
//    handleTriageKey checks isOpen() first), so this can sit beside
//    GlobalShortcuts without a mount/unmount dance keyed on open state — the same
//    "registered once, guards internally" shape image-tab/index.tsx's own ←/→
//    listener uses.
export function TriageHost() {
  useEffect(() => {
    loadPinnedTags();
  }, []);
  useEffect(() => {
    // Guarded the same way as AppToolbar's TriageButton: this listener is live from
    // first mount, before orchestrator.ts's async boot has necessarily assigned
    // triageHandleKey (see that component's comment for why).
    const onKeydown = (e: KeyboardEvent) => triageHandleKey?.(e);
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, []);
  return <TriageMode />;
}

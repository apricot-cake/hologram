import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../../renderer/lightbox.ts';
import { Lightbox } from './Lightbox.tsx';

// React-owned single-image quick-view (peek) overlay (#lightbox) — lives under the
// single App root. The state store (open/close/setLabels) moved to
// renderer/lightbox.ts (V18 §4) so orchestrator.ts and the *-builder.ts modules can
// import it directly; this island just subscribes and renders. #lightbox itself is
// the portal TARGET (orchestrator-owned), so its show class is toggled imperatively
// in renderer/lightbox.ts, not in JSX. #143 reduced it to a single item (no paging).

export function LightboxHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return <Lightbox state={s} />;
}

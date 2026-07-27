import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from '../services/lightbox.ts';
import { Lightbox } from './Lightbox.tsx';

// React-owned single-image quick-view (peek) overlay — lives under the single App
// root. The state store (open/close) is services/lightbox.ts so orchestrator.ts and
// the *-builder.ts modules can import it directly; this component just subscribes and
// renders. #143 reduced it to a single item (no paging); P2⑦ moved the overlay
// element itself here (it was a static #lightbox div with an imperatively toggled
// class), so Lightbox portals its own scrim onto document.body.

export function LightboxHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return <Lightbox state={s} />;
}

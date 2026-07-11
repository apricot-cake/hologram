import { useSyncExternalStore } from 'react';
import { getLabels, getSnapshot, step, subscribe } from '../../renderer/lightbox.ts';
import { Lightbox } from './Lightbox.tsx';

// React-owned image lightbox / gallery overlay (#lightbox) — lives under the single App
// root. The state store (open/close/step/setLabels) moved to renderer/lightbox.ts (V18
// §4) so orchestrator.ts and the *-builder.ts modules can import it directly; this island
// just subscribes and renders. #lightbox itself is the portal TARGET (orchestrator-owned),
// so its show/multi classes are toggled imperatively in renderer/lightbox.ts, not in JSX.

export function LightboxHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot);
  return <Lightbox state={s} labels={getLabels()} onPrev={() => step(-1)} onNext={() => step(1)} />;
}

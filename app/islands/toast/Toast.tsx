import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { getToast, subscribeToast } from '../../renderer/ui.ts';

// Toast (#ivToast) — V18 §2: React owns the glass toast pill's content, .show class, and
// auto-hide timer. ui.ts's notify() still pushes the message (every caller — folders.ts,
// the *-builder.ts modules — keeps calling notify() unchanged); this island just renders
// whatever it pushed. #ivToast stays the portal target (App.tsx wraps this in
// <Portal id="ivToast">), same "static host, React-owned content" idiom as MirrorStatus.

export function Toast() {
  const model = useSyncExternalStore(subscribeToast, getToast);
  const [visible, setVisible] = useState(false);

  // Re-fires on every notify() (model.openId bumps even for the identical message twice in
  // a row), showing the pill and restarting the 1.4s countdown — matching the old
  // clearTimeout+setTimeout behavior. `visible` is separate from `model` itself so the last
  // message stays rendered while the pill fades out via CSS, instead of vanishing with it —
  // the old code left #ivToast's textContent alone and only toggled the .show class.
  useEffect(() => {
    if (!model) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 1400);
    return () => clearTimeout(timer);
  }, [model?.openId]);

  // #ivToast's CSS keys on a .show class (not [hidden]) — write it on the host span itself
  // (the portal target, not a React element), same idiom as MirrorStatus's className write.
  useLayoutEffect(() => {
    const el = document.getElementById('ivToast');
    if (el) el.classList.toggle('show', visible);
  }, [visible]);

  return model ? model.msg : null;
}

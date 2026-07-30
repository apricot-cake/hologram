// The page side's end to a save it is showing a spinner for.
//
// One deadline shared by the four surfaces that wait on a save (the Alt+S
// banner, the hover button, the drop zone, the bookmark intake), because the
// first version of this was a flat timer copied into each of them and the
// copies had already drifted apart in what they logged.
//
// WHAT IT BOUNDS is silence, not the save. A save is legitimately slow — the
// host downloads every original — so a flat cap has to clear the sum of every
// leg, which is how the first version arrived at 90 seconds and why a save that
// was simply never taken sat under a spinner for a minute and a half. The worker
// pushes a line at every leg boundary (SaveProgressMessage), so this waits for
// the NEXT line rather than for the whole save, and the two questions it asks
// are short (deadline.ts):
//
//   was it acknowledged?  SAVE_ACK_MS    — nothing on the worker side ever ran
//   has it gone quiet?    SAVE_STALL_MS  — it ran, then stopped between legs
//
// The acknowledgement is pushed from the one funnel every route passes through,
// so it also answers for a save that JOINED an identical one already running
// (host-budget.ts). What that join does NOT get is the running save's stage
// lines — those carry the first press's saveId — so a joiner falls back to the
// silence bound for the rest of its wait. Two presses of the same picture where
// the save then takes over 40s would report a timeout for a save that succeeds;
// the heaviest save measured is 12.4s, and the alternative is teaching the gate
// to fan every stage out to a set of waiters for a case a user cannot aim for.
import { SAVE_ACK_MS, SAVE_STALL_MS } from './deadline.ts';
import type { BackgroundToContentMessage } from './messages.ts';

export interface SaveDeadline {
  // The save is over — a result arrived, or the caller is abandoning it. True
  // when this call is what ended it, false when the deadline got there first
  // and the caller is holding a late answer to a save already given up on.
  settle(): boolean;
}

// Start waiting. `giveUp` is called at most once, from the timer, with a line
// for capture.log naming which of the two bounds ran out — the distinction is
// the whole diagnostic value: "never acknowledged" is a dead worker, "went
// quiet" is a live one stuck in a leg it has already reported passing.
export function startSaveDeadline(saveId: string | null, giveUp: (error: string) => void): SaveDeadline {
  let settled = false;
  let acknowledged = false;
  let timer: ReturnType<typeof setTimeout>;

  function stop() {
    clearTimeout(timer);
    chrome.runtime.onMessage.removeListener(onProgress);
  }

  function expire() {
    if (settled) return;
    settled = true;
    stop();
    giveUp(acknowledged ? `save timed out — the background acknowledged it, then went quiet for ${SAVE_STALL_MS}ms` : `save timed out — the background never acknowledged it within ${SAVE_ACK_MS}ms`);
  }

  // Any line about THIS save resets the wait: the worker is alive and moving,
  // which is the only thing being measured. Progress for another save says
  // nothing — a second tab saving happily must not hold this spinner open.
  function onProgress(message: BackgroundToContentMessage) {
    if (settled || message?.type !== 'saveProgress' || message.saveId !== saveId) return;
    acknowledged = true;
    clearTimeout(timer);
    timer = setTimeout(expire, SAVE_STALL_MS);
  }

  timer = setTimeout(expire, SAVE_ACK_MS);
  chrome.runtime.onMessage.addListener(onProgress);

  return {
    settle() {
      if (settled) return false;
      settled = true;
      stop();
      return true;
    },
  };
}

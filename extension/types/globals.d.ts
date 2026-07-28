// State held by one dynamically injected capture session and by the internal
// diagnostics page. Shared application code uses ESM imports instead.
interface Window {
  __snsPostSaveActive?: boolean;
  __snsPostSaveCleanup?: () => void;
  // Set by background.ts immediately before injecting the capture entrypoint
  // when the user asked for auto capture (#362) rather than a single shot.
  // Read once and cleared by capture.ts, so a stale flag can't turn a later
  // Alt+S into auto mode.
  __hologramAutoCapture?: boolean;
  __hologramDiag?: Record<string, unknown>;
  // #311: set by overlay.ts (the persistent resident content script) so
  // capture.ts can hide the saved-mark/save-button overlay before shooting the
  // screen. Returns a restore function. Undefined if overlay.ts hasn't run on
  // this page (its matches list is narrower than capture.ts's).
  __hologramPrepareOverlayForCapture?: () => () => void;
}

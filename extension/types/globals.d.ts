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
}

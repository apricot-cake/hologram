// State held by one dynamically injected capture session and by the internal
// diagnostics page. Shared application code uses ESM imports instead.
interface Window {
  __snsPostSaveActive?: boolean;
  __snsPostSaveCleanup?: () => void;
  __hologramDiag?: Record<string, unknown>;
}

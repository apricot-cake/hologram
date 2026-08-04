// AI features opt-in (#830, parent #98) — thin forwarding over
// hologramIpc.getAiConfig/setAiConfig (same pattern as backup.ts). This is the
// renderer half of the ONE opt-in flag: any future AI-backed feature UI checks
// getAiConfig().enabled before showing itself, rather than re-deriving the gate.
import { hologramIpc } from './ipc.ts';

export function getAiConfig() {
  return hologramIpc.getAiConfig();
}
export function setAiConfig(patch: { enabled?: boolean }) {
  return hologramIpc.setAiConfig(patch);
}

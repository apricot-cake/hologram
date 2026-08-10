// AI 機能の opt-in（#830、親 #98）――hologramIpc.getAiConfig/setAiConfig への
// 薄い転送（backup.ts と同じパターン）。これは唯一の opt-in フラグの
// レンダラー側半分: 将来のどんな AI を使う機能の UI も、そのゲートを
// 自前で導出し直すのではなく、表に出る前に getAiConfig().enabled を
// チェックする。
import { hologramIpc } from './ipc.ts';

export function getAiConfig() {
  return hologramIpc.getAiConfig();
}
export function setAiConfig(patch: { enabled?: boolean }) {
  return hologramIpc.setAiConfig(patch);
}

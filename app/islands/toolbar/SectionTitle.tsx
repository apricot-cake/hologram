import { t } from '../_shared/i18n.ts';

// Sidebar section title — the plain control name ("ビュー" / "レイアウト").
// History: gained a "· mode" suffix (2026-06-27), then a right-aligned mode
// readout (2026-07-04 am), then lost the mode entirely (2026-07-04 pm): the
// instant per-segment .ui-tip tooltips name the segments and the glass thumb
// shows which is active, so a second mode label was redundant (user). Kept as
// a (now static) component so the titles stay island-rendered.

export function SectionTitle({ baseKey }: { baseKey: string }) {
  return <>{t(baseKey)}</>;
}

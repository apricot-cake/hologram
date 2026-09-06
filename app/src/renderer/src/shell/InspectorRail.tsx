// つまみの操作範囲はインスペクタ内に収め、隣のスクロールバーに重ねない。
import type { PanelResize } from './use-panel-resize.ts';

export function InspectorRail({ resize }: { resize: PanelResize }) {
  return (
    <button
      type="button"
      data-slot="inspector-rail"
      title={resize.handleProps['aria-label']}
      className="absolute inset-y-0 left-0 z-30 hidden w-2 cursor-ew-resize after:absolute after:inset-y-0 after:left-0 after:w-[2px] hover:after:bg-sidebar-border focus-visible:after:bg-ring focus-visible:outline-none sm:block"
      {...resize.handleProps}
    />
  );
}

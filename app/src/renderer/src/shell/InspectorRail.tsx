// Resize handle for the right inspector (#30) — the sidebar's rail has an upstream
// home (shadcn's SidebarRail, forked in #30 and removed with the sidebar's drag in #981);
// this column has none, so its edge is drawn here.
//
// Sits on the panel's left edge, straddling it: the grab zone is wider than the 1px
// border it appears to be, which is the same trade the sidebar rail makes. Only the
// hairline lights up on hover, so the chrome stays quiet until aimed at.
import type { PanelResize } from './use-panel-resize.ts';

export function InspectorRail({ resize }: { resize: PanelResize }) {
  return (
    <button
      type="button"
      data-slot="inspector-rail"
      title={resize.handleProps['aria-label']}
      className="absolute inset-y-0 left-0 z-30 hidden w-4 -translate-x-1/2 cursor-ew-resize after:absolute after:inset-y-0 after:start-1/2 after:w-[2px] hover:after:bg-sidebar-border focus-visible:after:bg-ring focus-visible:outline-none sm:block"
      {...resize.handleProps}
    />
  );
}

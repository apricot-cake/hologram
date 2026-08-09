// 右のインスペクタの大きさを変えるつまみ（#30）＝サイドバーのレールには上流に置き場がある
// （shadcn の SidebarRail。#30 で枝分かれさせ、#981 でサイドバーのドラッグごと外した）。
// この列にはそれが無いので、縁をここで描く。
//
// パネルの左の縁の上に、それをまたぐ形で座る: つかめる範囲は、見た目どおりの 1px の境界線
// より広い。これはサイドバーのレールが払っているのと同じ取引。hover で光るのは細い線だけ
// なので、狙われるまで枠の装飾は静かなまま。
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

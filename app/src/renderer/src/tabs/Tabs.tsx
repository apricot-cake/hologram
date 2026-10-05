import type { MouseEvent } from 'react';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { Plus, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { addTab, closeTab, closeTabByGesture, showTabMenu } from '../services/orchestrator.ts';

// TabsHost が services/tabs.ts の hologramTabsSource から引く、帯のモデル。
export interface TabModel {
  id: string;
  title: string;
  icon: string;
  active?: boolean;
  showClose?: boolean;
}
export interface TabsModel {
  tabs: TabModel[];
  closeTitle?: string;
  newTitle?: string;
}

const TAB_BASE = 'app-no-drag group relative flex h-7 max-w-[220px] min-w-0 flex-1 cursor-pointer items-center overflow-hidden rounded-md py-0 pr-6 pl-2.5 text-xs transition-colors select-none';
const TAB_ACTIVE = 'bg-background text-foreground shadow-sm';
const TAB_IDLE = 'bg-background/40 text-muted-foreground hover:bg-background/70 hover:text-foreground';

function Tab({ t, closeTitle }: { t: TabModel; closeTitle?: string }) {
  return (
    <div className="group relative flex min-w-0 max-w-[220px] flex-1">
      <TabsPrimitive.Tab
        value={t.id}
        data-slot="tab"
        data-tab-id={t.id}
        data-active={t.active || undefined}
        className={`${TAB_BASE} ${t.active ? TAB_ACTIVE : TAB_IDLE}`}
        // 中クリックで閉じる。mousedown の preventDefault は、Chromium が帯の上で
        // オートスクロールのカーソルに切り替わるのを止めるためのもの。
        onMouseDown={(e: MouseEvent) => {
          if (e.button === 1) e.preventDefault();
        }}
        onAuxClick={(e: MouseEvent) => {
          if (e.button !== 1) return;
          e.preventDefault();
          closeTabByGesture(t.id);
        }}
        onContextMenu={(e: MouseEvent) => {
          e.preventDefault();
          showTabMenu(t.id, e);
        }}
      >
        {/* relative z-1: 読ませるものはすべて ::before のピルより上に座らせる必要がある。 */}
        <span className="relative z-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
          {/* グリフはアプリ側で定義した SVG の定数（tabs-builder の TAB_ICONS、またはピン）で、
            利用者の作ったものが入ることは一切ない。 */}
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 定着した SVG グリフの書き方＝アプリ定義の定数で、利用者の内容が入ることはない */}
          <span className={`flex size-3 shrink-0 items-center ${t.active ? 'opacity-100' : 'opacity-70'}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: t.icon }} />
          <span data-slot="tab-title" className="min-w-0 flex-1 truncate font-medium" style={{ fontFamily: '"Segoe UI", sans-serif' }}>
            {t.title}
          </span>
        </span>
      </TabsPrimitive.Tab>
      {t.showClose && (
        <button
          type="button"
          data-slot="tab-close"
          className={`absolute top-1/2 right-1.5 z-1 grid size-4 -translate-y-1/2 place-items-center rounded-[3px] text-[var(--text-muted)] transition-opacity hover:bg-[var(--hover)] hover:text-[var(--text)] hover:opacity-100! focus-visible:opacity-100 ${t.active ? 'opacity-100' : 'opacity-0 group-hover:opacity-70 group-focus-within:opacity-70'}`}
          aria-label={closeTitle}
          onClick={(e: MouseEvent) => {
            e.stopPropagation(); // 止めないと、下の行が閉じようとしているタブへ切り替えてしまう
            closeTab(t.id);
          }}
        >
          <X aria-hidden="true" size={10} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

export function Tabs({ model }: { model: TabsModel | null }) {
  if (!model) return null;
  return (
    <div data-slot="tab-strip" className="flex min-w-0 flex-1 items-center gap-1 self-stretch px-2">
      <TabsPrimitive.List className="contents">
        {model.tabs.map((t) => (
          <Tab key={t.id} t={t} closeTitle={model.closeTitle} />
        ))}
      </TabsPrimitive.List>
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" data-slot="tab-new" className="app-no-drag ml-1.5 grid size-6 shrink-0 place-items-center self-center rounded-[6px] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]" aria-label={model.newTitle} onClick={() => addTab()}>
              <Plus aria-hidden="true" size={13} />
            </button>
          }
        />
        <TooltipContent side="bottom">{model.newTitle}</TooltipContent>
      </Tooltip>
    </div>
  );
}

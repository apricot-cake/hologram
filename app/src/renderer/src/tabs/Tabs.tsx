import type { MouseEvent } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { addTab, closeTab, closeTabByGesture, showTabMenu, switchTab } from '../services/orchestrator.ts';

// TabsHost が services/tabs.ts の hologramTabsSource から引く、帯のモデル。
export interface TabModel {
  id: string;
  title: string;
  icon: string;
  active?: boolean;
  pinned?: boolean;
  showClose?: boolean;
}
export interface TabsModel {
  tabs: TabModel[];
  closeTitle?: string;
  newTitle?: string;
}

// 行末の ＋（新しいタブ）。グリフは周りのボタンが既に言っていることの繰り返しなので
// aria-hidden にする＝どのアイコンセットも同じ形で配っている。
function NewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ✕（タブを閉じる）。aria-hidden にする理由は上の NewIcon と同じ。
function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const TAB_BASE = 'app-no-drag group relative flex h-7 max-w-[220px] min-w-0 flex-1 cursor-pointer items-center overflow-hidden rounded-md py-0 pr-6 pl-2.5 text-xs transition-colors select-none';
const TAB_ACTIVE = 'bg-background text-foreground shadow-sm';
const TAB_PINNED = 'bg-[var(--accent-subtle)] text-[var(--accent-text)]';
const TAB_IDLE = 'bg-background/40 text-muted-foreground hover:bg-background/70 hover:text-foreground';

function Tab({ t, closeTitle }: { t: TabModel; closeTitle?: string }) {
  return (
    <div
      data-slot="tab"
      data-tab-id={t.id}
      data-active={t.active || undefined}
      data-pinned={t.pinned || undefined}
      className={`${TAB_BASE} ${t.active ? TAB_ACTIVE : t.pinned ? TAB_PINNED : TAB_IDLE}`}
      role="tab"
      aria-selected={t.active ? 'true' : 'false'}
      tabIndex={0}
      onClick={() => switchTab(t.id)}
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
        <span data-slot="tab-title" className="min-w-0 flex-1 truncate font-medium">
          {t.title}
        </span>
      </span>
      {t.showClose && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-slot="tab-close"
                className={`absolute top-1/2 right-1.5 z-1 grid size-4 -translate-y-1/2 place-items-center rounded-[3px] text-[var(--text-muted)] transition-opacity hover:bg-[var(--hover)] hover:text-[var(--text)] hover:opacity-100! ${t.active ? 'opacity-100' : 'opacity-0 group-hover:opacity-70'}`}
                aria-label={closeTitle}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation(); // 止めないと、下の行が閉じようとしているタブへ切り替えてしまう
                  closeTab(t.id);
                }}
              >
                <CloseIcon />
              </button>
            }
          />
          <TooltipContent side="bottom">{closeTitle}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function Tabs({ model }: { model: TabsModel | null }) {
  if (!model) return null;
  return (
    <div data-slot="tab-strip" role="tablist" className="flex min-w-0 flex-1 items-center gap-1 self-stretch px-2">
      {model.tabs.map((t) => (
        <Tab key={t.id} t={t} closeTitle={model.closeTitle} />
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" data-slot="tab-new" className="app-no-drag ml-1.5 grid size-6 shrink-0 place-items-center self-center rounded-[6px] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]" aria-label={model.newTitle} onClick={() => addTab()}>
              <NewIcon />
            </button>
          }
        />
        <TooltipContent side="bottom">{model.newTitle}</TooltipContent>
      </Tooltip>
    </div>
  );
}

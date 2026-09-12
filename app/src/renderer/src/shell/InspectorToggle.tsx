import { useSyncExternalStore } from 'react';
import { PanelRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isOpen, setOpen, subscribe, toggle } from '../services/inspector-panel.ts';
import { isHidden as panelsAreHidden, reveal as panelsReveal, subscribe as panelsSubscribe } from '../services/panels.ts';
import { t } from '../_shared/i18n.ts';

// #245 の一括非表示が効いている間、画面に残るパネル操作はこのボタンだけになる（タブの帯に
// あって、開く対象のパネルの中には無いため）＝だからこれが戻り道でなければならない。この
// ボタンが読み書きするのは利用者に見えている状態のほう。覆われていればパネル自身の状態が
// どうであろうと「閉じている」扱いで、押せば覆いを外して開く。覆いの裏で状態だけを反転させ、
// 壊れたように見えることはしない。
export function InspectorToggle() {
  const panelOpen = useSyncExternalStore(subscribe, isOpen);
  const panelsHidden = useSyncExternalStore(panelsSubscribe, panelsAreHidden);
  const open = panelOpen && !panelsHidden;
  const press = () => {
    if (panelsHidden) {
      panelsReveal();
      setOpen(true);
      return;
    }
    toggle();
  };
  const label = t('toggleInspector');
  return (
    <div className="app-no-drag grid h-8 shrink-0 place-items-center px-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" data-slot="inspector-toggle" className="inline-grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-foreground/8 hover:text-foreground active:bg-foreground/16" aria-label={label} aria-pressed={open} onClick={press}>
              <PanelRight className="size-4" />
            </button>
          }
        />
        <TooltipContent side="bottom" align="end">
          {label}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

import { useSyncExternalStore } from 'react';
import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isOpen, setOpen, subscribe, toggle } from '../services/inspector-panel.ts';
import { isHidden as panelsAreHidden, reveal as panelsReveal, subscribe as panelsSubscribe } from '../services/panels.ts';
import { t } from '../_shared/i18n.ts';

// #245 の一括非表示が効いている間、画面に残るパネル操作はこのボタンだけになる（ページの操作行に
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
    <Button variant="outline" size="sm" data-slot="inspector-toggle" className="shrink-0 aria-pressed:bg-foreground/6 aria-pressed:hover:bg-foreground/8" aria-label={label} aria-pressed={open} onClick={press}>
      <PanelRight aria-hidden="true" />
      {t('tipInfo')}
    </Button>
  );
}

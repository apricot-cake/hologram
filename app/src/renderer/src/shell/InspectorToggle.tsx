// インスペクタの開閉トグル（#243）＝同じタイトルバー帯の左端にあるサイドバーの折りたたみ
// トリガーの、右側の相方。
//
// 置き場所は、木と複数のパネルを持つ製品（VS Code / Obsidian）に倣う。パネルのトグルは
// ツールバーではなくウィンドウの枠の上の隅に置かれる。ツールバーの外に出しておくことは、
// この作り直しが土台にしている情報設計の切り分けも保つ＝ツールバーが持つのは述語（検索・
// 絞り込み・表示）であって、パネルを開くことはそれに当たらない。
//
// タイトルバー帯の素の子要素で、ウィンドウのボタンが確保している隅のすぐ左に並ぶ。
// 以前は代わりに portal でウィンドウに固定していた。当時は帯がインスペクタの左端で終わって
// いて、帯の中に置いたトグルは操作対象のパネルが開くたびに 320px ずれてしまうためだった。
// #518 以降は帯がウィンドウの端まで届くので、通常の配置の位置がそのまま隅になり、portal
// で解くべきものは残っていない。
//
// WindowControls とは1点だけ、意図して違えている。こちらはモーダルの覆いより下に留まる
// ので、ダイアログが被せられる。ダイアログが出ている間に切り替えるものは無い。一方で
// ウィンドウの最小化・最大化・閉じるは常に届く必要があり、そのために覆いより上に座る。
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
    // px-2 は反対側の隅から測ったサイドバーのトリガーの寄せ幅と揃う。#628 でサイドバーの
    // ヘッダ行に列自身の 8 を与えたので、再び揃っている（4 にずれていて、それがこの注記を
    // 黙って間違いにしていた）。ウィンドウのボタンとの間隔を空けているのは、帯自身の右の
    // padding（--window-controls-w）のほう。
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

import { ContextMenuContent } from '../context-menu/ContextMenuContent';
import { Pencil, Trash2, FolderInput } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { close, get, pick, subscribe } from '../services/menu.ts';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

// コンテキストメニューのホスト＝常に載っているただ1つのインスタンスで、menu.ts が今
// 持っているものを描く（何も無ければ何も描かない）。メニューのデータと動作は
// orchestrator 側が持つ。このコンポーネントがやるのは、クリック地点を基準にした shadcn の
// DropdownMenu を描くことと、クリックを menu.ts の pick() へ返すことだけ。
//
// メニューはコードから開く。右クリックが指すのはカーソルの位置で、トリガーとなる要素は
// 無い。だから内容はその座標にある仮想の要素を基準にする＝Base UI がその場合のために
// 用意している API（位置決めとビューポート内への収まりは Base UI が行う。手で書いていた
// 旧 clampIntoView は無くなった）。ボタンから開いたメニューは代わりにボタン自身を渡す
// （menu.ts の anchorEl）ので、矩形を座標に直したり間隔を手で足したりする必要が無い。
//
// closeOnClick はどの行でも false にしてある。選んだ時にメニューを閉じるか（既定）、開いた
// まま描き直すか（フォルダ割り当ての切り替え行は新しい items の配列を返す）、別のメニューに
// 差し替えるか（カードのメニュー → フォルダの選択）を決めるのはブリッジだけ。クリックで
// Base UI に自分で閉じさせると、開いたままにする経路と競ってしまう。外側のクリックと
// Escape での閉じは onOpenChange を通る。
//
// 行の対応: `checked` があれば CheckboxItem（右側に印）、`danger` なら破壊的な見た目、
// `manage` なら「管理…」用の抑えた見た目。

export function ContextMenuHost() {
  const menu = useSyncExternalStore(subscribe, get);

  // 開いた側のボタン、またはクリック地点にある仮想の基準（モデルが変わるたびに作り直す）。
  const anchor = useMemo(() => {
    if (!menu) return null;
    if (menu.anchorEl) return menu.anchorEl;
    const { x, y } = menu;
    return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
  }, [menu]);

  if (!menu) return null;
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <ContextMenuContent anchor={anchor} side={menu.side ?? 'bottom'} align={menu.align ?? 'start'} sideOffset={2} collisionPadding={8}>
        {menu.items.map((it, i) =>
          it.sep ? (
            <DropdownMenuSeparator key={i} />
          ) : it.checked !== undefined ? (
            <DropdownMenuCheckboxItem key={i} checked={!!it.checked} closeOnClick={false} onClick={() => pick(it)}>
              {it.label}
            </DropdownMenuCheckboxItem>
          ) : (
            <DropdownMenuItem key={i} variant={it.danger ? 'destructive' : 'default'} className={it.manage ? 'text-muted-foreground' : undefined} closeOnClick={false} onClick={() => pick(it)}>
              {it.iconName === 'pencil' && <Pencil aria-hidden="true" />}
              {it.iconName === 'trash-2' && <Trash2 aria-hidden="true" />}
              {it.iconName === 'folder-input' && <FolderInput aria-hidden="true" />}
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: 定着した SVG グリフの書き方＝アイコンの文字列はオーケストレータが持つアプリ定義の定数で、利用者の内容が入ることはない */}
              {it.icon && <span className="flex items-center" dangerouslySetInnerHTML={{ __html: it.icon }} />}
              {it.label}
            </DropdownMenuItem>
          ),
        )}
      </ContextMenuContent>
    </DropdownMenu>
  );
}

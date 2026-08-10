// ウィンドウのタブ帯＝Chrome のタブ帯の作りを Tailwind で描き、タブの操作へ直結させた
// もの（#621・redesign P1-2 の積み残し）。
//
// ここでは2つのものが同時に消えた。同じ結び目だったから。この帯はかつて決まった形の旧
// DOM（`.tab-item[data-tab]`・`.tab-close[data-close]`・`.tab-new`）を出していたが、それは
// #tabBarInner の委譲リスナーが `closest()` でクリックを振り分けて戻せるようにするためだけ
// のものだった。今はどの操作もそれが属する要素の prop になっている＝onClick /
// onAuxClick / onContextMenu が orchestrator の export したタブ操作を呼ぶ。だからマーク
// アップは誰に対する義理も負わず、装飾は index.html の旧レイヤーからここのユーティリティ
// へ移った。
//
// これが何でないか: shadcn の <Tabs> ではない。あの部品はページの中でパネルを切り替え、
// value/onValueChange のモデルを自分で持つ。こちらはウィンドウのタブ（Chrome）で、閉じる・
// ピン留め・複製・コンテキストメニュー・タブごとの履歴を背負っている。
//
// 旧い帯から引き継いだもの。すべて意図してそうしている: ✕ はホバーで出る（アクティブな
// タブでは常に出る）、ピン留めしたタブはピンのグリフをまとって ✕ を出さない、＋ は行の
// 末尾に続く、中クリックで閉じる、操作できるものはすべてタイトルバーのドラッグ領域から
// 外れる（app-no-drag）＝帯自身のパディングが、ウィンドウを動かすために掴める場所として
// 残る。
//
// 名前を変える UI は無い。タブ名を手で付ける機能は redesign で落とした（2026-07-13）＝
// タブは何を映しているかで名前が決まる（tabTitleOf）。Chrome や VS Code と同じ。
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

// どのタブも下端を揃えた 34px の箱1つと1本のテキスト軸を共有する（Chrome 式）＝状態で
// 変わるのは塗りだけ。::before は非アクティブなタブがホバーで見せる浮いたピル（箱の内側に
// 収まる丸角の下地）で、アクティブなタブは代わりに箱そのものを塗り、下の帯へつながる。
// `group` は、タブごとのホバー状態を React に持たせずに ✕ をホバーで浮かび上がらせるための
// もの。
const TAB_BASE = 'app-no-drag group relative flex h-[34px] max-w-[200px] min-w-0 flex-1 cursor-pointer items-center overflow-hidden rounded-[8px] py-0 pr-2 pl-2.5 text-xs transition-colors select-none before:pointer-events-none before:absolute before:inset-[3px_2px] before:rounded-[7px] before:transition-colors';
// 下の帯とつながる＝下側の角は直角にし、耳が箱からはみ出すのを許す。
const TAB_ACTIVE = 'z-1 overflow-visible rounded-b-none bg-[var(--sidebar-bg)] text-[var(--text)]';
// ピン留めされていてアクティブではないとき＝アクセント色の色味こそが、ピン留めをひと目で
// 読み取れるようにしている当のもの。
const TAB_PINNED = 'text-[var(--accent-text)] before:bg-[var(--accent-subtle)] hover:text-[var(--text)]';
// ホバーのピルは帯の外側（--bg）と帯（--sidebar-bg）のちょうど中間に座る。これが Chrome の
// 階層。素の --hover はここでは使えない。ダークモードでは --hover が --sidebar-bg そのもの
// なので、ホバーした非アクティブなタブがアクティブなタブと寸分違わぬ見た目になる。
const TAB_IDLE = 'text-[var(--text-muted-strong)] hover:text-[var(--text)] hover:before:bg-[color-mix(in_srgb,var(--sidebar-bg)_60%,var(--bg))]';
// アクティブなタブの下端の左右の角に付ける、へこんだ「耳」。帯の背景に触れる角を中心とする
// 四分円の外側だけを塗る＝塗られた細片がタブの壁と帯に沿い、残りは帯の背景を透かす。
const EAR_LEFT = 'pointer-events-none absolute bottom-0 -left-2 size-2 bg-[radial-gradient(circle_8px_at_top_left,transparent_7.5px,var(--sidebar-bg)_8px)]';
const EAR_RIGHT = 'pointer-events-none absolute bottom-0 -right-2 size-2 bg-[radial-gradient(circle_8px_at_top_right,transparent_7.5px,var(--sidebar-bg)_8px)]';

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
      {t.active && (
        <>
          <span className={EAR_LEFT} />
          <span className={EAR_RIGHT} />
        </>
      )}
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
    // タイトルバーの帯の中にある、タブ帯自身の行。タブは下端を揃えて（items-end）座り、
    // アクティブなタブが下の帯へつながれるようにしてある。右のパディングは掴みしろ＝最後の
    // タブとインスペクタの切り替えボタンの間に取る、ドラッグできる場所で、タブが行を埋め尽く
    // しても残る。帯そのものはドラッグ領域の一部のままで、操作できる子はそれぞれ外れる
    // （app-no-drag）。Windows のタイトルバーの指針が求めているのはまさにこれ＝キャプション
    // ボタンの左に、いつでも掴める領域を置くこと。
    //
    // 88px はトークンに隠さずここに直書きしている（#628）。追加した日から
    // `var(--tabbar-drag-gutter, 88px)` の形だったが、その変数はどこにも定義されていなかった
    // ＝フォールバックが常に実際の値で、名前は存在しない持ち主を匂わせていただけ。長さが
    // トークンになるのは、独立した2つの持ち主が値を合わせなければならないとき。--tabbar-h は
    // 帯と、その中で高さを揃えるものすべてが読む。--window-controls-w は帯のパディングと、
    // ポータルで出すウィンドウ操作ボタンの列の幅が読む。掴みしろに合わせなければならない
    // ものは何もない＝1つの要素自身のパディングであり、タブの右の空きは帯に残った分が
    // そのまま出るだけ。
    // だからリテラルのまま置く。#628 の受け入れ条件6（サイズのトークンを増やさない）が
    // 求めているのも同じこと。
    <div data-slot="tab-strip" role="tablist" className="flex min-w-0 flex-1 items-end self-stretch pr-[88px] pl-2">
      {model.tabs.map((t) => (
        <Tab key={t.id} t={t} closeTitle={model.closeTitle} />
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-slot="tab-new"
              // タブは下端揃えなので、＋ はタブのベースラインに乗せず、帯の中心線に合わせる。
              className="app-no-drag ml-1.5 grid size-6 shrink-0 place-items-center self-center rounded-[6px] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
              aria-label={model.newTitle}
              onClick={() => addTab()}
            >
              <NewIcon />
            </button>
          }
        />
        <TooltipContent side="bottom">{model.newTitle}</TooltipContent>
      </Tooltip>
    </div>
  );
}

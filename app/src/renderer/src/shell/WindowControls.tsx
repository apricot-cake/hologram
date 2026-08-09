// ウィンドウの最小化／最大化／閉じるのボタン。アプリが自分で描く。
//
// OS のオーバーレイ（titleBarOverlay / WCO）ではなくアプリが描く理由: OS 側の列はブラウザ
// プロセスがそれ自身のコンポジタで描き、ページはレンダラーが別のコンポジタで描く＝display
// コンポジタは、双方がそれぞれ用意できたフレームをただ束ねるだけ。だからページ全体の変化
// （モーダルのスクリム）と列の色替えを同じフレームに載せることは保証できない。近づけることし
// かできず、それを狙ったのが以前の減光／色替え／遅延の仕掛けだった。残った1〜2フレームのずれ
// は、素早く開閉したときにちらつきとして見えていた。ボタンをここで描けば他のすべてと同じ
// フレームに入るので、同期させるものは何も残らない＝スクリムは他のピクセルと同じようにボタン
// を覆うだけになる。
//
// 引き換えに失うのは、最大化ボタンにホバーしたときの Windows 11 のスナップレイアウトの
// フライアウト。あれには本物のキャプションボタンが要る（Windows がウィンドウをヒットテスト
// し、"HTMAXBUTTON" と答えられるのはネイティブのオーバーレイだけ）が、Electron はアプリが
// 描くボタンにそれを露出していない。スナップ自体は影響を受けない＝Win+矢印・画面端への
// ドラッグ・Win+Z はどれも今までどおり効く。
//
// 寸法は Windows のキャプションの慣習に従う＝幅 46px のボタン、Segoe 風のグリフ、閉じるボタン
// の赤いホバー（#c42b1c＝システム自身の値で、Windows Terminal も使っている）。高さだけは
// キャプションのグリッドの 32 ではなく帯の高さにしてある（#628）。Microsoft のタイトルバーの
// 指針は、タイトルバーを高くしたらキャプションボタンも一緒に高くすると述べている（WinUI の
// PreferredHeightOption=Tall はバーと一緒にボタンを 48 へ上げる）。実際、44 の帯の中で 32 に
// すると、この3つだけが帯の他のコントロールが共有する中心より 6px 上に座っていた。帯いっぱい
// の高さにすると、閉じるボタンがウィンドウの実際の右上角に入る＝それが、放り投げるように
// 狙える位置になる理由（フィッツの法則）。
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { hologramIpc } from '../services/ipc.ts';

function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    hologramIpc.windowIsMaximized().then(setMaximized);
    // main は変化をすべて押し出す。ボタン由来でないもの（スナップ、ドラッグ領域のダブル
    // クリック、Win+矢印、タスクバー）も含むので、グリフが同期からずれることはない。
    hologramIpc.onWindowMaximizedChanged(setMaximized);
  }, []);
  return maximized;
}

// Windows のキャプションのグリッドに載せる 10x10 のグリフ。塗りではなく 1px の線にすると
// 100% でくっきり出るうえ、端数 DPI のディスプレイではブラウザが拡大縮小してくれる。
function MinimizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function MaximizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
// 元のサイズに戻すのグリフは、標準どおりずらして重ねた2つの四角＝手前の面と、その右上から
// 覗く奥の面。
function RestoreGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowControls() {
  const maximized = useMaximized();
  // app-no-drag: この列はタブバーのドラッグ領域と重なっていて、そのままだとクリックを飲まれて
  // しまう。タブバーは右に --window-controls-w のパディングを取ってあるので、タブがこの下へ
  // 潜り込むことはない（index.html）。
  // ホバーと押下は前景色を薄く敷いたもの。Windows がキャプションボタンに色を付けるのと同じ
  // やり方で、テーマごとのトークンを持たずに明暗どちらのテーマでも読める。--hover のように列
  // 自身の背景とぶつかることもない（あのトークンはライトテーマでは --tabbar-bg そのものなの
  // で、そこではホバーが見えなかった。しかも `bg-[var(--hover)]` はそもそも規則を1つも生成して
  // いなかった）。
  // 高さは帯自身のトークンにしてあるので、この列が帯の中心線から再びずれることはない。
  // e2e/flows/shell-axes.spec.ts がそれを不変条件として押さえている。幅は 46（キャプションの
  // グリッドの値）のままで、それに伴い帯が右に取り置く --window-controls-w は 138 になる。
  const base = 'app-no-drag inline-grid h-[var(--tabbar-h)] w-[46px] place-items-center text-muted-foreground transition-colors duration-75';
  // body へポータルで出し z-[13600] を与える＝どのモーダルの面（dialog 13000 / alert 13100 /
  // sheet 13500）よりも上に置き、この列がスクリムの上に正しく合成されるようにする（下記）。
  // タブバーの中ではこの位置決めは不可能だった＝帯は z-50 で自前の重ね合わせコンテキストを
  // 作るので、子にどんな z-index を与えてもスクリムを越えられない。スクリムが掛けるはずだった
  // 減光は、代わりに .wc-dim が塗る（globals.css）。同じ .wc-dim が pointer-events の遮断も担う＝モーダルは、
  // スクリムの背後にある他のすべてと同じようにウィンドウ操作も遮らなければならないので、
  // globals.css は .wc-dim が出ている間（開いている間と退出中）[data-slot='window-control'] の
  // pointer-events を無効にする。:has() の並びは同じもので、複製せず1か所にまとめてある。
  // この列は不透明にする＝スクリムより上に座るので、背景を持たないとスクリムが透けて見え、
  // .wc-dim が既に暗くなっている場所をさらに暗くしてしまう＝列だけが周りのページより目に見えて
  // 深い色になっていた。不透明にしたうえで自前の減光を1枚だけ重ねると、ページが受けるのと
  // まったく同じ結果になる。色味は .wc-strip の仕事で（globals.css）、今は条件を付けていない
  // ＝#518 以降タブの帯はサイドバーの右を全幅で走るので、このボタンの下に来る面はそれしかない。
  return createPortal(
    <div className="wc-strip app-no-drag fixed top-0 right-0 z-[13600] flex">
      <button type="button" data-slot="window-control" aria-label="最小化" className={`${base} hover:bg-foreground/8 active:bg-foreground/16`} onClick={() => hologramIpc.windowControl('minimize')}>
        <MinimizeGlyph />
      </button>
      <button type="button" data-slot="window-control" aria-label={maximized ? '元のサイズに戻す' : '最大化'} className={`${base} hover:bg-foreground/8 active:bg-foreground/16`} onClick={() => hologramIpc.windowControl('toggle-maximize')}>
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button type="button" data-slot="window-control" aria-label="閉じる" className={`${base} hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/90 active:text-white`} onClick={() => hologramIpc.windowControl('close')}>
        <CloseGlyph />
      </button>
      {/* スクリムの減光を、ボタンの上に作り直したもの（ボタンはスクリムより上にあるため）。
          pointer-events を切ってあるので、暗くはするが、守るために存在しているクリックを
          奪わない。黒は不透明にし、濃さは .wc-dim の opacity に任せる＝スクリムは面によって
          違うから（モーダルは 50% の黒、ライトボックスは 80%）。 */}
      <div className="wc-dim pointer-events-none absolute inset-0 bg-black" aria-hidden="true" />
    </div>,
    document.body,
  );
}

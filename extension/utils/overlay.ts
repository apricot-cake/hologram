// 常駐する content script（manifest の content_scripts、対象は x /
// bsky / pixiv）。画像ごとの保存操作と、アバターに置く一括保存操作。
//
//   すでにライブラリにある -> 「保存済み」の印（#54）
//   まだライブラリにない -> ホバー時の保存ボタン（#94）
//
// これらは2つの機能ではなく1つのシステムだ: 状態が隅のどちらの面を見
// せるか決めるので、ユーザーは見るべき場所を1つだけ覚えればよい。
//
// 答えは background.js を通して native host から来る（そこの
// queryBridge を参照）: host はライブラリ自身の索引を読むので、これは
// デスクトップアプリを閉じていても動く。ページについての何かがどこか
// へ送られることは一切ない＝タブを離れる唯一のものはページ自身が公開
// しているパーマリンクで、それはローカルのプロセスへ行く。パーマリン
// クの抽出は extractor が担い、保存済みの照会と保存要求は同じ URL を
// 使うため、印が保存の記録内容と食い違わない。
//
// ホバーは導出されるものであって、積み上がるものでは絶対にない: 操作
// はポインタが幾何学的に内側にある画像に表示され、それを奪えるのはそ
// の同じ幾何がポインタはもうその上にないと言うことだけだ（あるいは何
// か fixed/sticky なものがポインタの上に重なった場合）。スクロール、
// intersection の変化、ページ自身のマークアップの再描画＝どれもそれ自
// 体では何も決めない。それらは画像を動かすだけで、その後に改めて幾何
// を尋ねる。すべての経路が pointerStillOn()
// （overlay/positioning.ts）を通るので、「カーソルが画像の上にある間
// はボタンが残る」は各経路がチェックを覚えておくことによってではな
// く、構造上そうなる（#347）。
//
// 各操作は自分のメディアの箱の（<img> の場合はその直近の親の）絶対位
// 置指定された子要素だ。それによってブラウザは、画像と同じ合成された
// スクロールの中でそれを動かす。ビューポート座標をコピーする固定レイ
// ヤーは、スクロールのフレームごとに JavaScript を待たなければなら
// ず、滑らかなスクロールに対して目に見えて遅れる。
//
// テキストのみの投稿には、その子になるべき画像がない（#575 の「保存
// 済み」の印は対象だが、#363 の保存ボタンは対象外のままだ）。そのユ
// ニットは自分自身の host になり（すでに位置指定済み、すでにサイズ
// 済み）、印は画像の隅ではなく投稿自身のアバターのすぐ下に座る: X の
// その他メニューがすでに反対側の角を占めていて、操作の行はテキストの
// 列の左端を共有しているので、どちらのプラットフォームも何も描いてい
// ない唯一の帯がそこになる。語彙は同じで、寄り添うランドマークが違う
// だけだ。
//
// ページのサブツリーにとどまることは、以前はページのカスケードにも
// とどまることを意味していた: `button { all: unset !important }` の
// ようなありふれたホスト側のルールがインラインスタイルに勝つので、隅
// は1つのスタイルシートの差で箱を完全に失いかねなかった。#310 は何も
// 移動させずにこれを解決した＝サブツリーに挿入されるのは、自分専用の
// 小さな shadow root を持つ <hologram-corner-control> という host 要
// 素で、ディスクはその中に住む（overlay/control.ts）。ホストの CSS は
// shadow ツリーの中は選択できないので、露出したまま残る唯一の面は
// host 要素自身の箱になり、それはインライン !important で書く（作者
// のカスケードの頂点。ui-root.ts が固定レイヤーの host に使うのと同
// じ手口だ）。スクロール追従と重なり順は変わらない: host 要素は今も画
// 像の普通の絶対位置指定された子要素のままだ。
//
// #399 は、以前は1つのクロージャだったものを、変わる理由ごとにモ
// ジュールへ分割した: overlay/tracker.ts（どの投稿が存在し画面上にあ
// るか）、overlay/saved-state.ts（「これは保存済みか」をまとめて問い
// 合わせ答えをキャッシュする）、overlay/positioning.ts（隅の host が
// どこに mount され、ポインタがまだその上にあるか）、
// overlay/control.ts（host＋ディスク＋どの面を描くか）。このファイル
// はコントローラだ: それらを組み立て、設定と保存フローを持ち、複数の
// モジュールに同時に手を伸ばす唯一の場所になっている。
import { newSaveId, reportSaveTimeout } from './capture-log.ts';
import { makePostLink } from '../../app/src/shared/post-link.ts';
import { extensionAlive, noteExtensionGone, onExtensionGone } from './extension-context.ts';
import { startSaveDeadline } from './save-deadline.ts';
import { getContentSite, getMediaIdentitySite, getOverlaySite, mediaKeysOf } from './extractor/index.ts';
import { readDomMeta } from './extractor/dom-meta.ts';
import type { ContentSite, OverlaySite } from './extractor/types.ts';
import { SaveToasts } from './save-toasts.ts';
import { saveResultText } from './save-result-text.ts';
import { ensureTokens, motion, prefersReducedMotion } from './tokens.ts';
import { createI18n } from './i18n.ts';
import type { SavePostMessage, SaveResponse } from './messages.ts';
import { CONTROL_SIZE } from './overlay/constants.ts';
import { celebrateSave, clearControls, drawEmptyFace, drawFace, faceFor, makeControlHost, removeControl } from './overlay/control.ts';
import * as positioning from './overlay/positioning.ts';
import { addSavedPictures, createSavedQuery, permalinkOf } from './overlay/saved-state.ts';
import { createTracker } from './overlay/tracker.ts';
import type { Anchor, MarkMode, Phase, UnitState } from './overlay/types.ts';

let overlayActive = false;
declare const __EXT_TEST__: boolean | undefined;

export async function startOverlay(): Promise<() => void> {
  const MARK_MODE_KEY = 'savedBadgeMode'; // chrome.storage.local、'always' | 'hover' | 'off'
  const HOVER_SAVE_KEY = 'hoverSaveButton'; // chrome.storage.local、真偽値
  const QUERY_DEBOUNCE_MS = 300; // 投稿ごとではなくスクロールのひと固まりごとに1バッチ
  // scrollend を持たない旧ブラウザだけで、スクロールのひと固まりを
  // 終わらせるために使う待ち時間。
  const SCROLL_HOVER_SETTLE_MS = 100;
  const supportsScrollEnd = 'onscrollend' in window;
  const SCAN_DEBOUNCE_MS = 250; // フィードの変更は洪水のように届く
  const FLASH_MS = 1400; // 押下後の「保存済み」確認
  const ERROR_MS = 2500; // 失敗を表示してから、再試行できるボタンへ戻る
  // 投稿が画面に出るよりずっと前に問い合わせ集合へ出入りさせ、ユー
  // ザーが投稿を見られる頃には印がすでに決まっているようにする。
  const OBSERVER_MARGIN = '200px';
  // フィード丸ごとのユニット数に上限を設け、暴走するページ（アンマウ
  // ントしない無限スクロール）がこのマップを無制限に増やせないように
  // する。
  const MAX_TRACKED = 600;

  const detected = getOverlaySite();
  if (!detected) return () => undefined;
  // extractor の DOM 相がパーマリンクの抽出を、その media
  // identity が「この画像はどの投稿のものか」を担う。どちらも上のオー
  // バーレイの形と同じサイトモジュールから来る。投稿ごとではなく一度
  // だけ解決する。
  const detectedContent = getContentSite();
  if (!detectedContent) return () => undefined;
  // すでに絞り込まれた const として束縛し直す: TS は下のクロージャま
  // で null 絞り込みを運ばない（drag.ts の DropZone が回避しているの
  // と同じ制約）。
  const site: OverlaySite = detected;
  const content: ContentSite = detectedContent;
  // media-identity がルールを持たないページでは null になりうる: 印
  // はそれでも動く（パーマリンクさえあればよい）が、保存ボタンは単純
  // に一度も現れない。
  const media = getMediaIdentitySite();
  if (overlayActive) return () => undefined;
  overlayActive = true;

  // パレットはアプリのデザイントークンから生成され、ブラウザの
  // ライト/ダーク設定に従う（#270 — tokens.ts を参照）。
  ensureTokens();

  let markMode: MarkMode = 'always';
  let hoverSave = true;
  let repositionQueued = false;
  let repositionFrame: number | null = null;
  let repositionFull = false;
  let hovered: Anchor | null = null;
  let pointerPosition: { x: number; y: number } | null = null;
  let scrollHoverTimer: ReturnType<typeof setTimeout> | null = null;
  const activeScrollTargets = new Set<EventTarget>();
  // ひと固まりのスクロールの最初のイベントから、それが落ち着くまで
  // true。これが立っている間、静止したポインタの下でレイアウトが動く
  // とホバーをクリアすることはあっても、それを別の画像へ渡すことは絶
  // 対にない。だから静止したポインタは、その下をスクロールしていく画
  // 像をすべて拾ってしまうことがない（#347）。
  let inScrollBurst = false;
  // 静止したポインタの下の画像をレイアウト起因で選べるのは、スクロールが
  // 停止した直後の一度だけ。Intersection Observer の遅れた通知まで許すと、
  // スクロールが終わった後も画像ごとにコントロールが付け替わる。
  let layoutMayAdoptHovered = true;

  const { getMessage: t, saveFailureText, skewSaveText } = await createI18n();
  const toasts = new SaveToasts(t);

  // closed shadow を open に戻さず実ブラウザで検証するための test build 専用
  // RPC。ページ world には公開せず、release build では define の false に
  // よって分岐全体が除去される。
  const onTestMessage = (message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => {
    if (!message || typeof message !== 'object' || (message as { type?: string }).type !== 'overlayTestSnapshot') return false;
    const controls: Array<Record<string, unknown>> = [];
    for (const [unit, state] of tracker.tracked) {
      for (const anchor of state.anchors.values()) {
        if (!anchor.el || !anchor.control) continue;
        const rect = anchor.control.getBoundingClientRect();
        const style = getComputedStyle(anchor.control);
        controls.push({
          face: anchor.face,
          hostShadowRootExposed: anchor.el.shadowRoot !== null,
          hostFaceExposed: anchor.el.hasAttribute('data-hologram-face'),
          tag: anchor.control.tagName,
          label: anchor.control.getAttribute('aria-label'),
          tabIndex: anchor.control.tabIndex,
          role: anchor.control.getAttribute('role'),
          display: style.display,
          radius: style.borderRadius,
          background: style.backgroundColor,
          border: style.borderTopWidth,
          shadow: style.boxShadow,
          glyphs: anchor.control.querySelectorAll('svg').length,
          titled: anchor.el.hasAttribute('title') || anchor.control.hasAttribute('title'),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          hostRect: (() => {
            const value = anchor.el?.getBoundingClientRect();
            return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
          })(),
          unitId: unit.id || null,
        });
      }
    }
    sendResponse({ controls });
    return false;
  };
  if (typeof __EXT_TEST__ !== 'undefined' && __EXT_TEST__) chrome.runtime.onMessage.addListener(onTestMessage);

  // === 設定 ===

  // 包んでいるのは、無効化された context で chrome.storage が
  // lastError で報告するのではなく例外を投げるからだ（#594）。content
  // script は死んだ context では起動できないが、上の createI18n を
  // await している最中に拡張機能がリロードされることはありうる。それ
  // でオーバーレイ全体を失うのは、既定値で動くよりも悪い結果になる。
  try {
    chrome.storage.local.get([MARK_MODE_KEY, HOVER_SAVE_KEY], (got) => {
      if (chrome.runtime.lastError) return; // storage が使えない＝既定値のままにする
      applySettings(got[MARK_MODE_KEY], got[HOVER_SAVE_KEY]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!changes[MARK_MODE_KEY] && !changes[HOVER_SAVE_KEY]) return;
      applySettings(changes[MARK_MODE_KEY] ? changes[MARK_MODE_KEY].newValue : markMode, changes[HOVER_SAVE_KEY] ? changes[HOVER_SAVE_KEY].newValue : hoverSave);
    });
  } catch {
    noteExtensionGone();
  }

  function applySettings(mode: unknown, save: unknown) {
    const wantedMode: MarkMode = mode === 'hover' || mode === 'off' ? mode : 'always';
    const wantedSave = save !== false;
    if (wantedMode === markMode && wantedSave === hoverSave) return;
    const wasAsking = queriesWanted();
    markMode = wantedMode;
    hoverSave = wantedSave;
    paintAll();
    // 両方の面がオフということは答えるべきものが何もないということな
    // ので、オーバーレイは host への問い合わせを完全にやめる。どちら
    // かを再びオンにすると、今画面にあるものについて再度尋ねる。
    if (!wasAsking && queriesWanted()) {
      for (const unit of tracker.visible) savedQuery.add(unit);
      savedQuery.scheduleQuery();
    }
  }

  function queriesWanted(): boolean {
    return markMode !== 'off' || hoverSave;
  }

  // === 発見と問い合わせ ===
  //
  // どのユニットが存在し画面上にあるかは tracker.ts が持ち、「これは
  // 保存済みか」のまとめと問い合わせのキャッシュは saved-state.ts が
  // 持つ。ここで配線しているのは、intersection の変化が「分かってい
  // ることを描く」と「分かっていないことを調べに行く」の両方を決める
  // からで（#334）、どちらのモジュールも、それを言うためだけに互いを
  // import する必要はない。

  const tracker = createTracker(
    site,
    { maxTracked: MAX_TRACKED, scanDebounceMs: SCAN_DEBOUNCE_MS, observerMargin: OBSERVER_MARGIN },
    {
      onAnchorRemoved(anchor) {
        removeControl(anchor);
        if (hovered === anchor) hovered = null;
      },
      onEnter(unit, state) {
        // 答えがまだ分からない間も描く: それによって投稿の画像がホ
        // バーの対象として登録され、保存済みだと分かっていないものす
        // べてに保存ボタンが提示される。
        paint(unit, state);
        if (!state.saved) savedQuery.add(unit);
      },
      onLeave(unit, state) {
        // 画面外の投稿は答えを保持する（戻ってきたときのスクロールは
        // 無料だ）が操作は落とす。だからこの層は常に画面上にあるもの
        // だけを持つ。
        savedQuery.forget(unit);
        // Intersection Observer は観測時の幾何をタスク経由で届ける。
        // スクロール停止後にポインタ直下の操作を戻した後で、通知が
        // 遅れて届いても、現在の幾何を古い離脱通知で上書きしない。
        // 実際に画面外へ出たなら pointerStillOn() が false になる。
        const hoveredStillOnUnit = [...state.anchors.values()].some((anchor) => anchor === hovered && positioning.pointerStillOn(anchor, pointerPosition, site.pointerOverlayInMedia));
        if (!hoveredStillOnUnit) clearControls(state);
      },
      onIntersectionSettled() {
        // intersection の変化はポインタ入力ではなくレイアウトだ: ス
        // クロールの最中はホバーを別の画像へ渡さないことがある。これ
        // が、静止したポインタがその下を通り過ぎるすべての画像を拾っ
        // てしまっていた原因だ（#347）。
        updateHoveredAtPointer(!inScrollBurst && layoutMayAdoptHovered);
        savedQuery.scheduleQuery();
      },
      onMutation(contentChanged, modalChanged, records) {
        if (hovered && (contentChanged || modalChanged)) {
          if (!hovered.box.isConnected) rehomeHover(hovered);
          else if (!positioning.pointerStillOn(hovered, pointerPosition, site.pointerOverlayInMedia)) setHovered(null);
        }
        // 投稿ユニット自身が残ったまま、その中の media だけが差し替わる
        // ことがある。ホバー中なら上の rehomeHover が拾うが、別タブへ移
        // った後のように hovered が null なら、明示して読み直さない限り
        // 切断済みの古い箱が Anchor に残り続ける。変更を含む画面上のユ
        // ニットだけを再描画し、新しい箱と投稿 identity を同期する。
        if (contentChanged) repaintMutatedVisible(records);
      },
    },
  );

  const savedQuery = createSavedQuery({
    debounceMs: QUERY_DEBOUNCE_MS,
    tracked: tracker.tracked,
    isVisible: (unit) => tracker.visible.has(unit),
    isWanted: queriesWanted,
    isAlive: extensionAlive,
    getPermalink: (unit) => permalinkOf(content, unit),
    getMedia: () => media,
    onResolved: (unit, state) => paint(unit, state),
  });

  // === ホバー ===

  // 画像ごとのハンドラではなく1つの委譲された listener にしている: フィー
  // ドは絶えずノードを置き換えるので、画像に取り付けた listener は再
  // 描画のたびに付け直さなければならなくなる（それにホストの DOM への
  // 変更にもなる）。`pointerover` はユーザー入力ではない: ブラウザは
  // レイアウトが（スクロール中も含めて）静止したポインタの下に新しい
  // 要素を動かしたときにもこれを発行し、その境界イベントを遅らせるこ
  // ともある。`pointermove` はユーザーが実際にポインティングデバイス
  // を動かしたときにしか発火しないので、操作がスクロールする画像を追
  // いかけてしまうことはない。
  //
  // 問い合わせの flush とは違い、意図して生存確認（#594）にはしていな
  // い: 保存ボタンはポインタが画像の上にある間しか存在しないので、こ
  // こで後始末すると、それを見せるのと同じジェスチャーでボタンを消し
  // てしまい、ユーザーの押下（ユーザーに何かを伝えられる唯一のイベン
  // ト）が起きようがなくなる。
  const onPointerMove = (e: Event) => {
    const pe = e as PointerEvent;
    pointerPosition = { x: pe.clientX, y: pe.clientY };
    layoutMayAdoptHovered = true;
    updateHoveredAtPointer(true);
  };
  const onPointerOut = (e: Event) => {
    if (!(e as PointerEvent).relatedTarget) {
      pointerPosition = null;
      setHovered(null); // ポインタが document を離れた
    }
  };
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerout', onPointerOut, true);

  // 画面上のすべてのユニットのアンカーを平坦化したもの＝
  // anchorAtPoint が読む範囲（追跡中の全部ではなく画面上のものだけ）。
  function* visibleAnchors(): Generator<Anchor> {
    for (const unit of tracker.visible) {
      const state = tracker.tracked.get(unit);
      if (!state) continue;
      yield* state.anchors.values();
    }
  }

  function setHovered(next: Anchor | null) {
    if (next === hovered) return;
    const previous = hovered;
    hovered = next;
    if (previous) repaintAnchor(previous);
    if (next) repaintAnchor(next);
  }

  // `adopt` が false = ポインタの下の画像が、ユーザーではなくレイアウ
  // トの移動（スクロール、intersection、遅れた画像の読み込み）によっ
  // て変わった場合。そのときはすでにホバーされている画像が、ポインタ
  // がその上にある限り操作を保持し、別の画像がそれを奪うことはできな
  // い。
  function updateHoveredAtPointer(adopt: boolean) {
    if (!pointerPosition) {
      setHovered(null);
      return;
    }
    const next = positioning.anchorAtPoint(visibleAnchors(), pointerPosition.x, pointerPosition.y);
    if (next && positioning.modalCovers(next)) {
      setHovered(null);
      return;
    }
    if (!adopt && next !== hovered) {
      if (!positioning.pointerStillOn(hovered, pointerPosition, site.pointerOverlayInMedia)) setHovered(null);
      return;
    }
    setHovered(next);
    if (hovered && positioning.pointerIsOccluded(hovered, pointerPosition, site.pointerOverlayInMedia)) setHovered(null);
  }

  // ページがホバー中の画像の要素を、動かすのではなく置き換えた＝仮想
  // 化されたタイムラインはスクロールに応じて投稿を再描画し、x.com は
  // これを静止したポインタの下でも行う。画像はまだ画面上にあり、まだ
  // ポインタの下にある。新しいのはノードだけだ。ユニットのメディアの
  // 箱を読み直し、ホバーをそのまま新しい要素へ持っていく。ここで落と
  // すと、ユーザーがマウスを揺らすまでポインタがボタンのない画像の上
  // に座ったままになっていたからだ（#347）。
  function rehomeHover(anchor: Anchor) {
    const found = tracker.anchorOf.get(anchor.box);
    setHovered(null);
    // 投稿自体も消えていた（フィードが再描画ではなくリサイクルしてい
    // た）: 今ポインタの下にあるのは別の投稿の画像であり、それにボタ
    // ンを渡すことは、まさにスクロールのルールが禁じていることにな
    // る。次のポインタの動きに任せる。
    if (!found || !found.unit.isConnected) return;
    const state = tracker.tracked.get(found.unit);
    if (state) paint(found.unit, state); // syncAnchors が新しい箱を拾う
    updateHoveredAtPointer(true);
  }

  function repaintAnchor(anchor: Anchor) {
    const found = tracker.anchorOf.get(anchor.box);
    if (!found) return;
    const state = tracker.tracked.get(found.unit);
    if (state) paint(found.unit, state);
  }

  // === 保存 ===

  // ホバー保存が言葉で何かを言う唯一の場所。隅そのものは何も言わない
  // （#310）: 24pxの円には「拡張機能の設定から診断ページを開いてくだ
  // さい」は収まらないし、`title` に入れても、キーボードやスマート
  // フォンで来た人には決して届かない場所にその文が存在するだけのこと
  // になる。だからその文はここ、一括取り込みも使うバナー（すでに幅
  // も、状態の色も、`alert` の role も備えている）へ来る。
  //
  // ユーザーが予測できなかった結果だけが1つの文を得る。素の成功は沈
  // 黙したままにする（印が現れることこそが答えだ）。一方で `partial`
  // （保存はしたが投稿自身のテキストと投稿者が欠けている）は、この保
  // 存についての、それ以外に画面のどこも述べない事実だ（#367）。同じ
  // バナーは #205 のプロトコルのバージョンずれの通知も運ぶ（drag.ts
  // と capture.ts はすでにそうしていたが、ホバー保存はそれについて
  // 唯一まだ沈黙している保存経路だった、#576）＝保存自体は成功してい
  // るので、それは専用の4つ目の面ではなく琥珀色の `partial` 状態に乗
  // る。
  function showSaveBanner(state: 'error' | 'partial', text: string) {
    toasts.notice(state, '', text, undefined, state);
  }

  // 保存の失敗をボタンとページのバナーの両方に出す。報告された失敗と
  // デッドラインが共有するので、この2つが違う見え方をすることはあり
  // えない。
  function failSave(unit: Element, state: UnitState, anchor: Anchor) {
    setPhase(anchor, 'error', ERROR_MS);
    paint(unit, state);
  }

  // #594 の能動的な半分: ユーザーが保存を求め、このタブはそれを行え
  // ない。飲み込まれるのではなくバナーの上で言われる。これが存在する
  // 前は、押下はキャッチされない「Extension context invalidated.」を
  // 生み、スピナーが出て、それから10秒後、throw を生き延びたデッドラ
  // インだけから「保存が終わらなかったので中止しました（繰り返す場合
  // は Chrome を再起動してください）」が出ていた。これは健全な拡張機
  // 能に責めを負わせ、実際に効く唯一の直し方（このページをリロードす
  // ること）には一切触れていない。1回だけ表示する: それと一緒に動く
  // 後始末がボタンを取り去るので、2回目に押すものはもう何も残らな
  // い。
  function reportOrphaned() {
    noteExtensionGone();
    showSaveBanner('error', t('bannerExtensionReloaded'));
  }

  function startSave(unit: Element, state: UnitState, anchor: Anchor, previous?: SavePostMessage) {
    if (anchor.phase !== 'idle') return; // すでに進行中＝1回の押下に1回の保存
    if (!extensionAlive()) {
      reportOrphaned();
      return;
    }
    const postUrl = previous?.postUrl ?? permalinkOf(content, unit);
    if (!postUrl) return;
    const element = anchor.kind === 'media' ? positioning.postMediaIn(anchor.box) : null;
    const individual = anchor.kind === 'media' && (site.mediaIn(unit).length > 1 || (content.platform === 'x' && unit.getAttribute('data-testid') === 'swipe-to-dismiss'));
    const mediaKeys = individual && element ? mediaKeysOf(element, content.platform) : undefined;
    const saveId = newSaveId();
    const message: SavePostMessage = previous ? { ...previous, saveId } : { ...(individual ? { mediaKeys: mediaKeys ?? [] } : {}), type: 'savePost', platform: content.platform, postUrl, saveId, domMeta: readDomMeta(content, unit) };
    const target = [message.domMeta?.displayName || message.domMeta?.screenName, message.domMeta?.text?.slice(0, 60)].filter(Boolean).join(' · ') || postUrl;
    toasts.clearFailure(postUrl + JSON.stringify(message.mediaKeys ?? []));
    const failed = (text: string, queued = false, savedNothing = false) => {
      toasts.end(saveId, false);
      toasts.notice(
        postUrl + JSON.stringify(message.mediaKeys ?? []),
        target,
        text,
        queued
          ? undefined
          : () => {
              setPhase(anchor, 'idle', 0);
              startSave(unit, state, anchor, message);
            },
        queued ? 'idle' : 'error',
        { url: postUrl, savedSummary: savedNothing ? t('saveNothingSaved') : undefined },
      );
      if (queued) {
        setPhase(anchor, 'idle', 0);
        paint(unit, state);
      } else failSave(unit, state, anchor);
    };
    toasts.begin(saveId);
    setPhase(anchor, 'saving', 0);
    paint(unit, state);
    // サムネイルや拡大ビューアは選択画像を保存する。表示枚数から投稿全体の枚数は判断しない。
    // ボタンはこれが答えるまで「保存中」のスピナーを保持し、ユーザー
    // が得られるのは1回の押下だけ（保存が進行中の間 startSave は早期
    // リターンする）なので、答えが一度も来なければ、そのページが生き
    // ている限りその画像は保存できないままになってしまう（#507）。
    // デッドラインはボタンを解放し、報告された失敗とまったく同じよう
    // に理由を言う。
    // この押下の行を3つのプロセスにわたってまとめる（#519）。
    const deadline = startSaveDeadline(saveId, (error) => {
      // 表示するだけでなく記録もする。これは #507 のハングが実際に報
      // 告された画面であり、フォールバックにできる service-worker の
      // 行を持たない唯一のものだ: 常駐スクリプトは自分では何もログに
      // 残さないので、これがなければタイムアウトは capture.log を、
      // 沈黙するスピナーと同じくらい空のままにしてしまう。
      reportSaveTimeout('hover-save', content.platform, postUrl, error, saveId);
      failed(saveFailureText('timeout'));
    });
    // 呼び出しの場でインラインに書くのではなく名前を付ける。それに
    // よって呼び出し自体が、下の try/catch の中でただ1つの文になる。
    const onAnswer = (res?: SaveResponse) => {
      if (!deadline.settle()) return; // すでに諦めた押下への遅れた答え
      if (chrome.runtime.lastError || !res || !res.ok) {
        failed(saveFailureText(res && !res.ok ? res.errorKind : undefined, res && !res.ok ? res.metaReason : undefined, res && !res.ok ? res.queued : undefined), !!(res && !res.ok && res.queued), !!(res && !res.ok && res.savedNothing));
        return;
      }
      const complete = res.metaOk !== false && !res.mediaMissing && !res.acquisitionIssues?.length;
      toasts.end(saveId, complete);
      // background.js の通知を待たず、今回保存できた画像を反映する。
      state.saved = addSavedPictures(state.saved, Array.isArray(res.media) ? res.media : [], media, res.imageCount ?? null, res.post, res.individualMedia);
      setPhase(anchor, 'flash', FLASH_MS);
      // 「保存はしたが投稿自身の情報が欠けている」は一文の価値があ
      // り、隅にはそれを置く場所がない。以前は印の `title`、つまり
      // 24pxの円への1秒のホバーの裏に住んでいた。今はバナーの琥珀色
      // の状態で、それが真になった瞬間に一度だけ言われる（#310、
      // #367）。
      //
      // バージョンずれと一部欠けの両方になったとき、ずれの通知が一部欠け
      // の通知に優先する。ずれは次の保存についてのものであり（#205）、
      // これは今回の保存についての事実より優先するからだ。両者が一致
      // している、またはまだどの host も答えていないときは null
      // （#576）。
      const skewText = skewSaveText(res.hostSkew);
      if (skewText) showSaveBanner('partial', skewText);
      if (!complete) {
        const resultText = saveResultText(res, t);
        toasts.notice(
          postUrl + JSON.stringify(message.mediaKeys ?? []),
          target,
          resultText.failure,
          () => {
            setPhase(anchor, 'idle', 0);
            startSave(unit, state, anchor, { ...message, retryOf: message.retryOf || res.captureId });
          },
          'partial',
          { url: postUrl, savedSummary: resultText.savedSummary },
        );
      }
      paint(unit, state);
      // このコールバックだけが、本人が押した保存の成功を指す。保存済み
      // の問い合わせや他経路からの更新で印が出るときまで動かさない。
      if (complete) celebrateSave(anchor.control);
    };
    // 上の probe に加えて try/catch も（#594）: sendMessage はこちら
    // 側で無効化された context に対して例外を投げる唯一の呼び出しで、
    // その時点でデッドラインはすでに起動している＝無防備な throw は
    // タイマーだけを動かし続けたまま残してしまい、これがまさに、死ん
    // だタブが更新ではなくタイムアウトを報告していた経緯だ。probe と
    // この行の間の窓は小さいがゼロではない。
    try {
      chrome.runtime.sendMessage(message, onAnswer);
    } catch {
      deadline.settle();
      toasts.end(saveId, false);
      setPhase(anchor, 'idle', 0);
      reportOrphaned();
    }
  }

  function setPhase(anchor: Anchor, phase: Phase, ms: number) {
    if (anchor.timer) clearTimeout(anchor.timer);
    anchor.timer = null;
    anchor.phase = phase;
    if (!ms) return;
    anchor.timer = setTimeout(() => {
      anchor.timer = null;
      anchor.phase = 'idle';
      repaintAnchor(anchor);
    }, ms);
  }

  // === 描画 ===

  function paintAll() {
    for (const unit of tracker.visible) {
      const state = tracker.tracked.get(unit);
      if (state) paint(unit, state);
    }
  }

  function repaintMutatedVisible(records: MutationRecord[]) {
    for (const unit of tracker.visible) {
      const touched = records.some((record) => record.target === unit || unit.contains(record.target));
      if (!touched) continue;
      const state = tracker.tracked.get(unit);
      if (state) paint(unit, state);
    }
  }

  function refreshUnitIdentity(unit: Element, state: UnitState) {
    if (state.url === null) return;
    const currentUrl = permalinkOf(content, unit);
    if (!currentUrl || currentUrl === state.url) return;
    state.url = currentUrl;
    state.saved = null;
    savedQuery.add(unit);
    savedQuery.scheduleQuery();
  }

  function paint(unit: Element, state: UnitState) {
    if (!unit.isConnected) return;
    refreshUnitIdentity(unit, state);
    tracker.syncAnchors(unit, state);
    // ユニット内でのその箱の位置＝ライブラリがそれのために記録した
    // media 行の seq。どの URL も名指せない画像のためのフォールバッ
    // クのアイデンティティだ。
    let index = -1;
    for (const [, anchor] of state.anchors) {
      index += 1;
      const rect = anchor.box.getBoundingClientRect() as DOMRect;
      // サイズを持たないメディアの箱は、潰れたプレースホルダーかまだ
      // レイアウトされていない画像で、そこに操作を置く場所がない。テ
      // キストアンカーでは箱は投稿全体（常にサイズがある）であり、印
      // が対して配置されるのはアバターなので、レイアウトされていなけ
      // ればならないのはそちら側だ＝そうしないと、遅延読み込みで
      // 0x0のアバターがディスクを投稿の外に置いてしまう。
      const placedOn = anchor.kind === 'text' ? (site.textAnchorIn?.(anchor.box)?.getBoundingClientRect() ?? null) : rect;
      const tooSmall = !placedOn || placedOn.width < CONTROL_SIZE || placedOn.height < CONTROL_SIZE || (anchor.kind === 'media' && (rect.width < CONTROL_SIZE * 2 || rect.height < CONTROL_SIZE * 2));
      if (tooSmall) {
        removeControl(anchor);
        continue;
      }
      const face = faceFor({ state, anchor, index, rect, markMode, hoverSave, hoveredAnchor: hovered, media });
      // host 要素は面の変化より長生きする: それ自身の見た目を一切持
      // たず箱だけなので、これを保持することで、面が変わるたびに隅が
      // ページの DOM を出入りしなくて済む（ちらつきの記録に残るもの
      // が1つ減り、何かを報告しているまさにその瞬間に隅が動く理由も
      // 1つ減る）。
      // ページ側の再描画でボタンだけが除去されても、古い参照を再利用しない。
      if (anchor.el && !anchor.el.isConnected) {
        removeControl(anchor);
      }
      const born = !anchor.el;
      if (born) {
        const made = makeControlHost();
        if (!positioning.mountControl(anchor, made.el)) continue;
        anchor.el = made.el;
        anchor.root = made.root;
      }
      const el = anchor.el;
      if (!el) continue;
      const multiple = site.mediaIn(unit).length > 1 || (content.platform === 'x' && unit.getAttribute('data-testid') === 'swipe-to-dismiss');
      const accessibleName = multiple ? t(anchor.kind === 'text' ? 'cornerSaveAll' : 'cornerSaveImage') : t('cornerSave');
      if (face && (born || anchor.face !== face || anchor.accessibleName !== accessibleName)) {
        drawFace(anchor, face, t, {
          onOpen: () => {
            if (!state.url) return;
            const item = anchor.kind === 'media' ? positioning.postMediaIn(anchor.box) : null;
            const key = item && media ? mediaKeysOf(item, media.platform).find((value) => state.saved?.individualKeys?.has(value) && state.saved?.urlsByKey?.has(value)) : undefined;
            const mediaUrl = key ? state.saved?.urlsByKey?.get(key) : undefined;
            window.open(makePostLink({ url: state.url, mediaUrl }), '_self');
          },
          names: { save: accessibleName },
          onSave: () => startSave(unit, state, anchor),
          onRetry: () => {
            setPhase(anchor, 'idle', 0);
            startSave(unit, state, anchor);
          },
        });
        anchor.face = face;
        anchor.accessibleName = accessibleName;
        // テストのために名前を付けている。テストはローカライズされ
        // た名前を読めない（隅はブラウザのロケールに従う）＝重複警告
        // のボタンに対して data-hologram-choice が果たすのと同じ役割
        // だ。
      } else if (!face && (born || anchor.face !== null)) {
        drawEmptyFace(anchor);
        anchor.face = null;
        anchor.accessibleName = null;
      }
      positioning.positionControl(anchor, el, site);
      // ホバー保存の操作は、スクロール中に新しくポインタの下に入って
      // きた画像に対して日常的に作られる。普通のスクロールが繰り返し
      // ポップのアニメーションにならないよう、静止させておく。
      if (born && face && face !== 'save' && anchor.phase !== 'flash' && !prefersReducedMotion())
        anchor.control?.animate(
          [
            { opacity: 0, transform: 'scale(0.6)' },
            { opacity: 1, transform: 'scale(1.08)', offset: 0.6 },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: motion.durationBase, easing: motion.easeOut },
        );
    }
  }

  function reposition() {
    repositionFrame = null;
    repositionQueued = false;
    const full = repositionFull;
    repositionFull = false;
    updateHoveredAtPointer(!inScrollBurst && layoutMayAdoptHovered);
    if (!full) return;
    let detached = false;
    for (const unit of tracker.visible) {
      const state = tracker.tracked.get(unit);
      if (!state) continue;
      if (!unit.isConnected) {
        detached = true;
        continue;
      }
      paint(unit, state);
    }
    if (detached) tracker.forgetDetached();
  }

  // 全体の再描画はリサイズや画像読み込みのようなレイアウト変化のためのもの。
  function scheduleReposition(full: boolean) {
    if (full) repositionFull = true;
    if (repositionQueued) return;
    repositionQueued = true;
    repositionFrame = requestAnimationFrame(reposition);
  }

  // ひと固まりを終わらせる＝レイアウトが再びホバーを別の画像へ渡して
  // よくなる時点。scrollend は、保留中のスクロール位置更新がなく、操
  // 作も完了した時点をブラウザ自身が通知する。最後の scroll からの固
  // 定時間では、この条件を負荷下で判定できない。
  function finishHoverAfterScroll() {
    if (!inScrollBurst) return;
    if (scrollHoverTimer !== null) {
      clearTimeout(scrollHoverTimer);
      scrollHoverTimer = null;
    }
    activeScrollTargets.clear();
    inScrollBurst = false;
    // 追跡上限に達したページでは、画面外に残る古いユニットの代わりに、
    // 今スクロールしてきたユニットを監視へ入れる。通常のページでは DOM
    // 全体の再走査を増やさない。
    if (tracker.tracked.size >= MAX_TRACKED) tracker.scan();
    // スクロールが止まれば、ポインタの下へ来た画像をホバー対象にしてよい。
    // ここで再評価しないと、スクロールで前の画像から外れた後は、ポインタを
    // 動かすまで保存ボタンが戻らない。
    updateHoveredAtPointer(true);
  }

  function scheduleScrollEndFallback() {
    if (supportsScrollEnd) return;
    if (scrollHoverTimer !== null) clearTimeout(scrollHoverTimer);
    scrollHoverTimer = setTimeout(finishHoverAfterScroll, SCROLL_HOVER_SETTLE_MS);
  }

  // 操作はメディアの子要素なので、JavaScript なしでそれと一緒にスク
  // ロールする。スクロールそのものはホバーについて何も決めない: 画像
  // を動かすだけで、ポインタがまだその上にあるかは幾何が言う。ポイン
  // タの下から画像をスクロールで出すとここで操作をクリアする。1枚の
  // 中でのスクロール（長い投稿を読むホイールの揺れ）はそのままにす
  // る。
  const onScroll = (event: Event) => {
    inScrollBurst = true;
    activeScrollTargets.add(event.target ?? window);
    layoutMayAdoptHovered = false;
    if (repositionFrame !== null) cancelAnimationFrame(repositionFrame);
    repositionFrame = null;
    repositionQueued = false;
    if (hovered && !positioning.pointerStillOn(hovered, pointerPosition, site.pointerOverlayInMedia)) setHovered(null);
    scheduleScrollEndFallback();
  };
  const onScrollEnd = (event: Event) => {
    activeScrollTargets.delete(event.target ?? window);
    if (activeScrollTargets.size === 0) finishHoverAfterScroll();
  };
  const onResize = () => scheduleReposition(true);
  const onPageRestore = (event: Event) => {
    if (event.type === 'visibilitychange' && document.hidden) return;
    // 履歴復帰で scrollend を受け取れなかった状態を引き継がない。
    finishHoverAfterScroll();
    layoutMayAdoptHovered = true;
    tracker.forgetDetached();
    tracker.scan();
    scheduleReposition(true);
  };
  addEventListener('pageshow', onPageRestore);
  addEventListener('popstate', onPageRestore);
  document.addEventListener('visibilitychange', onPageRestore);
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  addEventListener('scrollend', onScrollEnd, { capture: true, passive: true });
  addEventListener('resize', onResize, { passive: true });
  // 投稿は、その画像がサイズを持つ前に答えを得られることがある: この
  // observer のマージンは意図してビューポートより先まで届いていて、
  // フィードの画像は遅延読み込みだ。そのようなメディアの箱は0x0と測ら
  // れ paint はそれをスキップする（実際の x.com のタイムラインで確認
  // 済み）ので、操作は次のスクロールまで待たされてしまう。画像自身の
  // load イベントこそが、箱がサイズを得るまさにその瞬間だ＝load はバ
  // ブルしないので、キャプチャ相で `document` に付ける。
  const onMediaLoad = () => scheduleReposition(true);
  document.addEventListener('load', onMediaLoad, { capture: true, passive: true });

  // === このタブの下で拡張機能が消えた（#594） ===

  // このスクリプトに関する限り、ページを見つけたときの状態へ戻す: す
  // べての隅の操作を取り除き（removeControl はページ自身の要素から借
  // りていたインラインの `position` を復元する）、すべての observer
  // を切断し、このモジュールが取り付けたすべての listener とタイマー
  // を外す。
  //
  // 意図して残すもの: 共有の <hologram-extension-ui> host 要素。これ
  // は空で不活性な pointer-events:none の固定レイヤーで（ui-root.ts
  // がその理由ですでに起動をまたいで残し続けている）、右クリックからの
  // 一括取り込みも同じ層を使う。それが描いているかもしれない層を空にすると、
  // 生きているスクリプトのバナーを奪うことになってしまう。このモ
  // ジュールがそこに置いたかもしれない失敗バナーも同じ理由でそのまま
  // にする: それは自分の滞留時間で自分からフェードアウトする。
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('load', onMediaLoad, { capture: true });
    removeEventListener('scroll', onScroll, { capture: true });
    removeEventListener('scrollend', onScrollEnd, { capture: true });
    removeEventListener('resize', onResize);
    removeEventListener('pageshow', onPageRestore);
    removeEventListener('popstate', onPageRestore);
    document.removeEventListener('visibilitychange', onPageRestore);
    if (scrollHoverTimer !== null) clearTimeout(scrollHoverTimer);
    if (repositionFrame !== null) cancelAnimationFrame(repositionFrame);
    scrollHoverTimer = null;
    activeScrollTargets.clear();
    repositionFrame = null;
    repositionQueued = false;
    hovered = null;
    for (const [, state] of tracker.tracked) {
      for (const [, anchor] of state.anchors) {
        // removeControl の中ではなくここでクリアする: 他の場所では、
        // 操作より長生きする phase のタイマーこそが flash の後に隅を
        // 元へ戻すもので、これを完全に消し去りたいのはこの経路だけ
        // だ。
        if (anchor.timer) clearTimeout(anchor.timer);
        anchor.timer = null;
      }
      clearControls(state);
      state.anchors.clear();
    }
    tracker.dispose();
    savedQuery.dispose();
    if (typeof __EXT_TEST__ !== 'undefined' && __EXT_TEST__) chrome.runtime.onMessage.removeListener(onTestMessage);
    overlayActive = false;
  };
  const stopWatchingContext = onExtensionGone(cleanup);
  return () => {
    stopWatchingContext();
    cleanup();
  };
}

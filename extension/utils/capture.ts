import { startBulkCapture } from './bulk-capture.ts';
import { cropScreenshot } from './crop.ts';
import { buildChoiceRow, checkDuplicate, formatDeletedAt, pagePictureUrls } from './duplicate-guard.ts';
import { logSaveEvent, newSaveId, reportSaveTimeout, type SaveStage } from './capture-log.ts';
import { noteExtensionGone } from './extension-context.ts';
import { type SaveDeadline, startSaveDeadline } from './save-deadline.ts';
import { normalizeRect } from './extractor/dom.ts';
import { readDomMeta } from './extractor/dom-meta.ts';
import { getCaptureSite } from './extractor/index.ts';
import type { CaptureSite, DomMeta, PostRect } from './extractor/types.ts';
import { ICONS } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { createI18n } from './i18n.ts';
import { userOnly } from './user-gesture.ts';
import type { BackgroundToContentMessage, CaptureAndSendMessage, CaptureAndSendResponse, CropImageResponse } from './messages.ts';

export async function startCapture(): Promise<void> {
  // --- i18n ---
  const i18n = await createI18n();
  const { getMessage, partialSaveText, saveFailureText, skewSaveText } = i18n;
  const MSG = {
    select: getMessage('bannerSelect'),
    saving: getMessage('bannerSaving'),
    saved: getMessage('bannerSaved'),
    extensionReloaded: getMessage('bannerExtensionReloaded'),
  };

  const siteConfig = getCaptureSite();
  if (!siteConfig) {
    return;
  }
  // 素の（再代入されない）const へ束縛し直す: 上のガードによる
  // `siteConfig` の null 絞り込みは、下のネストした `function` 宣言
  // （findPostElement、capturePost、onMouseMove、…）の中までは及ばな
  // い＝外側の `let` を読むクロージャと同じ落とし穴だ。`site` は絞り
  // 込まれた（null でない）型をそれらすべてへ運ぶ。
  const site: CaptureSite = siteConfig;

  // 何かが早期リターンできるようになる前に、自動キャプチャの要求を読
  // んでクリアする。それによって、キャンセルされた起動から残ったフラ
  // グが、後の素の Alt+S を自動モードにしてしまうことは絶対にない。
  const wantsAuto = window.__hologramAutoCapture === true;
  window.__hologramAutoCapture = undefined;

  // 二重注入を防ぐ＝この単発モードと下の自動キャプチャモードが共有す
  // るトグル（どちらが動いていても、どちらか一方の次の起動がそれを終
  // わらせる）。
  if (typeof window.__snsPostSaveCleanup === 'function') {
    window.__snsPostSaveCleanup();
    return;
  }

  // #362: 自動キャプチャは、特定のページで Alt+S が切り替わるモードで
  // はなく別のジェスチャー（Alt+Shift+S）だ＝Alt+S は、ブックマーク一
  // 覧を含むどこでも「これからクリックする投稿を保存する」という意味
  // を保ち続ける。今のところブックマーク一覧に限定していて、それ以外
  // の場所では要求は単に無視され、下の単発フローが動く。
  // await している（#280）: サイトの所有権チェックがネットワークの往
  // 復を必要とする場合（pixiv のブックマーク一覧）、ここは Promise を
  // 返し、Promise は常に truthy だ＝await せずにチェックすると、無条
  // 件に一括モードへ入ってしまう。
  if (wantsAuto && (await site.isBulkCapturePage?.())) {
    startBulkCapture(site, i18n);
    return;
  }

  window.__snsPostSaveActive = true;

  let isCleanedUp = false;
  let restoreCaptureState: (() => void) | null = null;
  let restoreOverlayState: (() => void) | null = null;
  let savedScrollPosition: { x: number; y: number } | null = null;
  let lastCapturedPost: Element | null = null; // crop の時点で測り直す（スクロール/レイアウトのずれ対策）
  let chosenUrl: string | null = null; // cancel の行のための、保存対象の投稿
  // 重複警告に「replace」と答えた（#34）。ack から読み返すのではなく
  // ここで保持する: background が報告するのは何を保存したかであり、
  // 古いキャプチャを引退させるのはアプリ側の後の仕事だ＝この保存が置
  // き換えだったと知っているのは、それを尋ねた側だけになる。
  let replacing = false;
  // 選ばれた投稿についてページが表示していたもの（#202）で、選ばれた
  // 瞬間に一度だけ読む。送信時に読み直すのではなくここで保持するの
  // は、その2つの間に scroll-into-view・スクリーンショット・2フレー
  // ムのアニメーションが挟まり、X の仮想リストはその間ずっと行をリサ
  // イクルし続けるからだ＝`post` の下にある要素は、その頃には別の投稿
  // の行になっているかもしれない。
  let domMeta: DomMeta | null = null;
  // 保存の結果を待つデッドラインと、タイムアウトの後に遅れた答えが来
  // たときにバナーが二重に書かれないようにするラッチ（#507）。
  let saveDeadline: SaveDeadline | null = null;
  let saveSettled = false;

  // --- capture.log のための、この起動がここまで何をしたか（#519） ----------
  //
  // このセッションがどこまで進んだか。それによって、閉じるときに単に
  // 止まったのではなく何が放棄されたかを言える。`null` は、ログとして
  // はセッションが終わっている（すでに自分の終わりを書き終えてい
  // る）ことを意味し、これによって cleanup() は、成功・失敗・「保存し
  // ない」と答えた保存の後に cancel の行を追加しないようにできる。
  let openStage: Extract<SaveStage, 'select' | 'duplicate' | 'save'> | null = 'select';
  // 投稿が選ばれたときに発行され、それ以降この保存が3つのプロセスのど
  // こで書くどの行にも運ばれる。
  let saveId: string | null = null;
  // service worker が完了を報告した段階（SaveProgressMessage）。ここ
  // に保持する理由は1つだけだ: その後 worker が殺されたら、行を書ける
  // のはこちら側だけになり、これがその行が保存がどこまで進んでいたか
  // を言える唯一の方法だ。
  let reached: SaveStage[] = [];

  // === UI 要素 ===

  // 上部バナー＝ページ上のすべての保存経路が描画に使う画面の `banner`
  // の面（#44 — status-surface.ts）。このファイルは以前、状態→色→絵
  // 文字の対応表の専用コピーを持っていたが、今決めるのはどの状態にい
  // るかだけだ。
  const banner = new StatusSurface({ variant: 'banner', resting: ICONS.target });
  // テストハーネスのために名前を付けている。ハーネスはローカライズさ
  // れたラベルを読めない（バナーはブラウザのロケールに従う）＝重複警
  // 告の答えに対して data-hologram-choice が果たすのと同じ役割だ。状
  // 態はコンポーネント自身の data-state に乗るので、テストは文言と照
  // 合しなくても「この保存は終わった」と主張できる。
  banner.el.setAttribute('data-hologram-capture-banner', '');

  banner.setState('active', MSG.select);
  banner.mount();
  banner.enter();

  // 選択枠: これからキャプチャする投稿の上の幾何で、バナーと同じ
  // root に描く。その root の中の `position: fixed` は、これがビュー
  // ポート座標であることを意味する＝古い要素はページの中に住んでい
  // て、スクロールオフセットを自分で持っていた。
  const highlight = document.createElement('div');
  highlight.className = 'highlight';
  highlight.style.display = 'none';
  (banner.el.parentNode || document.body).appendChild(highlight);
  // ポインタが最後にいた場所。スクロールが枠を再度狙い直せるように。
  // 枠はもう document に乗っていないので、これがなければ、次のマウス
  // 移動まで、投稿がその下から動いても枠は静止したままになってしま
  // う。
  let lastPointer: { x: number; y: number } | null = null;

  let captureStyle: HTMLStyleElement | null = null;
  if (site.captureStyleText) {
    captureStyle = document.createElement('style');
    captureStyle.textContent = site.captureStyleText;
    document.head.appendChild(captureStyle);
  }

  // === 投稿の検出 ===

  function findPostElement(target: EventTarget | null): Element | null {
    if (typeof site.findPostElement === 'function') {
      return site.findPostElement(target);
    }

    let el: Element | null = target instanceof Element ? target : ((target as Node | null)?.parentElement ?? null);
    while (el) {
      if (site.postSelector && el.matches?.(site.postSelector)) {
        if (!site.isPostElement || site.isPostElement(el)) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function getPostRect(post: Element): PostRect {
    return normalizeRect(site.getCaptureRect?.(post) || post.getBoundingClientRect());
  }

  // === 診断ログ ===

  // クリックされた要素の小さな、個人情報を抑えたスナップショット。壊
  // れたセレクタを再現手順なしに capture.log から診断できるようにする
  // ため。outerHTML は切り詰める（タグ / data-testid / 最も近いアン
  // カーの href が、セレクタが壊れた箇所を特定する手がかりになる）。
  function snapEl(el: unknown) {
    if (!(el instanceof Element)) return null;
    const anchor = el.closest('a[href]') || (el.querySelector ? el.querySelector('a[href]') : null);
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : null,
      testid: el.getAttribute ? el.getAttribute('data-testid') : null,
      role: el.getAttribute ? el.getAttribute('role') : null,
      closestAnchorHref: anchor ? anchor.getAttribute('href') : null,
      outerHTML: (el.outerHTML || '').slice(0, 400),
    };
  }

  // ブリッジより手前の失敗（投稿要素なし/パーマリンクなし）を
  // background へ報告し、host の capture.log へ中継してもらう。でき
  // る範囲で。
  function logCaptureFailure(stage: SaveStage, el: unknown) {
    logSaveEvent({ stage, phase: 'fail', saveId, platform: site.platform, locationHref: location.href, clickedSnap: snapEl(el) });
  }

  // ユーザーが止めた: Esc、右クリック、または2回目の起動。保存を放棄
  // することが、ハングした保存と同じ沈黙にならないよう書く＝これが、
  // このログを2回読み違えさせた混同だ（#519）。`openStage` が何が放棄
  // されたかを言い、これをクリアすることで、セッションにつき最大1回
  // になる。
  function logCancel() {
    if (!openStage) return;
    const stage = openStage;
    openStage = null;
    logSaveEvent({ stage, phase: 'cancel', saveId, reached, platform: site.platform, url: chosenUrl });
  }

  // === イベントハンドラ ===

  // ポインタがどこにあるかではなく、ユーザーが決めたこと（この投稿、
  // またはこのセッションはやめる）。この3つだけがページのイベント経
  // 路を越えて保存へ入るか、セッションから抜けるので、この3つだけが
  // 信頼されたイベントを必要とする（#323 — utils/user-gesture.ts）。
  // 各 addEventListener の呼び出しごとにではなくここで一度だけ包んで
  // いるのは、removeEventListener がまさにこの参照を必要とするから
  // だ。ハンドラ自体は下の巻き上げられた宣言。
  const onUserClick = userOnly(onClick);
  const onUserContextMenu = userOnly(onContextMenu);
  const onUserKeyDown = userOnly(onKeyDown);

  function onMouseMove(e: MouseEvent) {
    lastPointer = { x: e.clientX, y: e.clientY };
    aimHighlight(findPostElement(e.target));
  }

  // ビューポート座標: 枠は今固定のオーバーレイ root の中に住んでいる
  // ので、以前加えていたスクロールオフセットを足すと画面1枚分ずれてし
  // まう。
  function aimHighlight(post: Element | null) {
    if (!post) {
      highlight.style.display = 'none';
      return;
    }
    const rect = getPostRect(post);
    highlight.style.display = 'block';
    highlight.style.top = rect.top - 4 + 'px';
    highlight.style.left = rect.left - 4 + 'px';
    highlight.style.width = rect.width + 8 + 'px';
    highlight.style.height = rect.height + 8 + 'px';
  }

  // ホイールやキーボードでのスクロールはポインタを動かさずに投稿を動
  // かし、mousemove は後に続かない。ポインタの下にある投稿を尋ね直す
  // ことで、枠はユーザーが実際に狙っている投稿の上に留まる＝以前の
  // document に紐付いた枠は、ページと一緒にスクロールすることでこれ
  // を無料で手に入れていた。
  function onScroll() {
    if (!lastPointer) return;
    aimHighlight(findPostElement(document.elementFromPoint(lastPointer.x, lastPointer.y)));
  }

  function capturePost(post: Element) {
    // 投稿が選ばれたので、ここから先は識別すべき保存の試みがある＝今
    // 後、3つのプロセスのどこで書かれる行も、この id を運ぶ（#519）。
    saveId = newSaveId();

    // メタデータは background がこの URL からプラットフォーム API 経
    // 由で取得する。ページはクリックされた投稿とそのパーマリンクを特
    // 定し、#202 以降は、API が答えられない欄（非公開または年齢制限の
    // X の投稿、シンジケーションが欄を持たないカウント数）のための第
    // 2の情報源としても読まれる。readDomMeta は絶対に例外を投げない:
    // 壊れたセレクタが犠牲にすべきは追加のメタデータであって、保存で
    // はない。
    const postUrl = site.getPermalink(post);
    domMeta = readDomMeta(site, post);

    // パーマリンクがなければ API のメタデータも取得できない＝保存は
    // 表示側が絶対に表示しない platform:null のレコードを生んでしま
    // う。ここで中止し、理由をバナーに出し、原因を素早く特定できるよ
    // う掴んだ要素をログに残す。
    if (!postUrl) {
      openStage = null; // この行がセッションの終わりそのもの＝この後 cancel はない
      logCaptureFailure('permalink', post);
      banner.setState('error', getMessage('bannerFailedReason', [getMessage('reasonNoPermalink')]));
      setTimeout(cleanup, 2800);
      return;
    }

    // イベントリスナーを外す（キャプチャは単発）。重複チェックより前
    // に行う。それによって質問が画面にある間に2回目のクリックで別の
    // 投稿を選べないようにする。Esc は今もキャンセルする
    // （onKeyDown は登録されたまま）。
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onUserClick, true);
    document.removeEventListener('contextmenu', onUserContextMenu, true);
    removeEventListener('scroll', onScroll, true);
    highlight.style.display = 'none';

    // #34: 何かを撮る前にライブラリへ尋ねる。checkDuplicate は、質問
    // を未解決のままにするすべてのケース（設定オフ、host に届かな
    // い、投稿が未保存）で null を返し、その場合キャプチャはそのまま
    // 変わらず動く。
    chosenUrl = postUrl;
    openStage = 'duplicate';
    checkDuplicate(site.platform, postUrl, pagePictureUrls(post))
      .catch(() => null)
      .then((hit) => {
        if (isCleanedUp) return; // 尋ねている間に Esc
        if (!hit) {
          shoot(post, postUrl, null);
          return;
        }
        // #158: 同じ問いを、ライブラリではなくゴミ箱にある投稿につい
        // て行う。レコードが日付を言えば日付付き、言わなければ日付な
        // し。
        const deletedOn = hit.trashed ? formatDeletedAt(hit.trashed.deletedAt) : '';
        banner.setState('ask', hit.trashed ? (deletedOn ? getMessage('trashedTitleOn', [deletedOn]) : getMessage('trashedTitle')) : getMessage('dupTitle'));
        banner.slot(
          buildChoiceRow(
            getMessage,
            (choice) => {
              if (isCleanedUp) return;
              if (choice === 'skip') {
                // 「保存しない」と答えるのはハングではなく決定だ。
                // `cancel` ではなく `skip` として記録する。何も放棄さ
                // れていないからだ＝投稿はすでにライブラリにあり、そ
                // れこそが尋ねた理由だ（#519）。
                openStage = null;
                logSaveEvent({ stage: 'duplicate', phase: 'skip', saveId, platform: site.platform, url: postUrl });
                banner.setState('success', getMessage('dupSkipped'));
                setTimeout(cleanup, 1500);
                return;
              }
              replacing = choice === 'replace';
              shoot(post, postUrl, replacing ? hit.captureId : null);
            },
            hit.trashed ? 'trashed' : 'duplicate',
          ),
        );
      });
  }

  // 「投稿が決まった」以降のすべて: 自分たちのオーバーレイを隠し、投
  // 稿を完全に画面内へ持ってきて、撮影し、crop の矩形を background へ
  // 渡す。
  function shoot(post: Element, postUrl: string, replaces: string | null) {
    // キャプチャの前にハイライトとバナーを隠す
    highlight.style.display = 'none';
    banner.hide();
    restoreCaptureState = site.prepareForCapture?.(post) || null;
    // #311: 常駐オーバーレイの保存済みマーク/ホバー保存ボタンの操作も
    // 隠す＝それらはハイライトと同じように投稿の上に描かれ、そうしな
    // ければ保存されるスクリーンショットに焼き込まれてしまう。
    restoreOverlayState = window.__hologramPrepareOverlayForCapture?.() || null;

    // 投稿が切れていたら、ビューポートへ完全にスクロールする
    const preRect = getPostRect(post);
    if (preRect.top < 0 || preRect.bottom > window.innerHeight) {
      savedScrollPosition = { x: window.scrollX, y: window.scrollY };
      post.scrollIntoView({ block: 'start', behavior: 'instant' });
      // X/Bluesky はカラムの上端に sticky ヘッダー（約50px）を重ねて
      // いる＝block:'start' だと投稿者の行がその下に固定されてしま
      // う。
      window.scrollBy(0, -64);
    }

    // 撮影前に再描画を待つ
    lastCapturedPost = post;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const rect = getPostRect(post);

        // スクリーンショットから除外するために隠していたのを戻す。戻
        // る先の display は今やスタイルシートのものなので、インライン
        // の `none` を消すだけでよい＝旧コードは `flex` を名指す必要
        // があった。その値が要素自身の cssText の中に住んでいたから
        // だ。
        banner.show();
        banner.setState('busy', MSG.saving);

        // ここから先、バナーは他の誰かを待っているので、ここからデッ
        // ドラインを持つ（#507）。抜け方は2つあり、先に来た方で保存
        // は終わる:
        //
        //   応答なしにチャンネルが閉じる — Chrome 自身の合図で、
        //     service worker が保存の途中で消えたことを示す（MV3 は
        //     どのアイドル時点でもそれを止める）。速く、よくあるケー
        //     ス。
        //   worker が何も言わなくなる — 保存をそもそも受け取らなかっ
        //     たか、区間の間で止まった（save-deadline.ts）。遅い保存
        //     も段階を報告し続けるので、それが失敗と呼ばれることは絶
        //     対にない。
        saveDeadline = startSaveDeadline(saveId, (error) => endSaveUnanswered(postUrl, error));

        // 保存が今進行中になったので、ここからの Esc は選択ではなく保
        // 存を放棄する＝ログはどちらかを言うべきだ（#519）。
        openStage = 'save';

        // #594: このスクリプトは起動のたびに新しく注入されるので、常
        // 駐のものとは違って孤児にはならない。しかし Alt+S から投稿を
        // 選ぶクリックまでの数秒の間に拡張機能が更新されることはあり
        // うる。その場合この呼び出しは例外を投げる。catch がなけれ
        // ば、直前に起動したデッドラインだけが動き続けたままになり、
        // バナーは単にこのスクリプトより新しいだけの拡張機能をタイム
        // アウトのせいにしてしまう。
        try {
          chrome.runtime.sendMessage(
            {
              type: 'captureAndSend',
              rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              postUrl,
              platform: site.platform,
              saveId: saveId as string,
              replaces,
              domMeta,
            } satisfies CaptureAndSendMessage,
            (res?: CaptureAndSendResponse) => {
              // 結果は notify の push として別に届く＝このコールバッ
              // クは、応答がないことだけを読み取るために使う。どちら
              // の形の応答でも、background は生きていて言うべきこと
              // を言ったということ（失敗も notify を送る）なので、バ
              // ナーはそのハンドラに任せる。
              if (res) return;
              const error = `save timed out — ${chrome.runtime.lastError?.message || 'the background closed the channel without answering'}`;
              endSaveUnanswered(postUrl, error);
            },
          );
        } catch {
          endSaveOrphaned();
        }
      });
    });
  }

  // このキャプチャの下で拡張機能が入れ替わった（#594）。報告する先は
  // ない＝ログ行は同じ切断された接続を通ることになる。だからバナーが
  // すべてであり、効く唯一の直し方を名指しする。endSaveUnanswered の
  // 帳簿付けを共有し、遅れて届く答えが、すでに閉じたこの保存を再び開
  // いてしまわないようにする。
  function endSaveOrphaned() {
    if (isCleanedUp || saveSettled) return;
    saveSettled = true;
    openStage = null;
    clearSaveDeadline();
    noteExtensionGone();
    banner.setState('error', MSG.extensionReloaded);
    setTimeout(cleanup, 2800);
  }

  // 結果はもう来ない。それを言い、次に何をすべきか言い、行を1つ残
  // す: これは以前、あらゆる方向で同時に沈黙していた失敗だ＝バナーは
  // 回り続け、capture.log は空のまま。
  function endSaveUnanswered(postUrl: string, error: string) {
    if (isCleanedUp || saveSettled) return;
    saveSettled = true;
    openStage = null; // 下のタイムアウトの行がこのセッションの終わり
    clearSaveDeadline();
    reportSaveTimeout('capture', site.platform, postUrl, error, saveId, reached);
    banner.setState('error', saveFailureText('timeout'));
    setTimeout(cleanup, 2800);
  }

  function clearSaveDeadline() {
    saveDeadline?.settle();
    saveDeadline = null;
  }

  function onClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const post = findPostElement(e.target);
    if (!post) {
      // 待ち続ける（再試行に優しく＝場違いなクリックがセッションを終
      // わらせるべきではない）が、何がクリックされたかは記録し、壊れ
      // た postSelector を再現手順なしに capture.log から診断できるよ
      // うにする。
      logCaptureFailure('select', e.target);
      return;
    }
    capturePost(post);
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    cleanup();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') cleanup();
  }

  // === 後始末 ===

  // スクロール位置を復元する（冪等: 成功・失敗・キャンセルのどの経路
  // が先にここへ来ても一度だけ実行し、2回目の呼び出しは何もしな
  // い）。
  function restoreScroll() {
    if (savedScrollPosition) {
      window.scrollTo({ left: savedScrollPosition.x, top: savedScrollPosition.y, behavior: 'instant' });
      savedScrollPosition = null;
    }
  }

  // ピルは入ってきたときと同じやり方で去る（せり上がって落ち着く、
  // pop の階層）＝いきなりの remove() は、アプリのトーストの隣では不
  // 具合のように見えてしまう。これが動く頃には listener はすでに外れ
  // ているので、居残る要素は不活性だ。スクリーンショットのために隠れ
  // ているバナーには再生すべきものが何もないので、単に消える。
  function dismissBanner() {
    if (banner.hidden) banner.remove();
    else banner.exit();
  }

  function cleanup() {
    if (isCleanedUp) return;
    isCleanedUp = true;
    // listener が外れる前に: このセッションにまだ開いたままのものが
    // あれば、それを終わらせたのはユーザーだ。セッションがすでに自分
    // の終わりを書いていれば（保存済み、失敗、タイムアウト、「保存し
    // ない」と回答）何もしない。
    logCancel();
    clearSaveDeadline(); // 保存中の Esc: バナーが消えるなら、タイマーも消えなければならない

    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onUserClick, true);
    document.removeEventListener('contextmenu', onUserContextMenu, true);
    document.removeEventListener('keydown', onUserKeyDown, true);
    removeEventListener('scroll', onScroll, true);
    chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    restoreCaptureState?.();
    restoreCaptureState = null;
    restoreOverlayState?.();
    restoreOverlayState = null;
    restoreScroll();
    dismissBanner();
    highlight.remove();
    captureStyle?.remove();
    window.__snsPostSaveActive = false;

    if (window.__snsPostSaveCleanup === cleanup) {
      delete window.__snsPostSaveCleanup;
    }
  }

  window.__snsPostSaveCleanup = cleanup;

  // === メッセージリスナー ===

  function onRuntimeMessage(msg: BackgroundToContentMessage, _sender: chrome.runtime.MessageSender, sendResponse: (response?: CropImageResponse) => void) {
    // 切り抜き要求
    if (msg.type === 'cropImage') {
      void cropScreenshot(msg.dataUrl, msg.rect, () => (lastCapturedPost?.isConnected ? getPostRect(lastCapturedPost) : null)).then((croppedDataUrl) => {
        restoreScroll();
        sendResponse(croppedDataUrl ? { croppedDataUrl } : null);
      });
      return true; // 非同期の応答
    }

    // 保存がどこまで進んだか。覚えるだけで、届いた時点では描画もログ
    // にも残さない: その唯一の読み手は、その後 service worker が静か
    // になった場合にこちら側が書くタイムアウトの行だ（#519。
    // SaveProgressMessage を参照）。
    if (msg.type === 'saveProgress') {
      if (msg.saveId === saveId) reached = msg.reached;
      return undefined;
    }

    // 結果の通知
    if (msg.type === 'notify') {
      // 答えが来た: 監視を下ろす。デッドラインの後に届いた notify は
      // 無視する＝ユーザーにはすでにこの保存は失敗したと伝えてある
      // し、バナーを今さら書き戻すのは、遅れることより悪い。
      if (saveSettled) return undefined;
      saveSettled = true;
      openStage = null; // background/host の行がこの保存の終わり
      clearSaveDeadline();
      // 保存はしたが投稿情報の API が何も返さなかった → 素の緑の成功
      // ではなく琥珀色の「一部欠けた」状態にしてユーザーが気付けるよ
      // うにする。表示も長めに保つ。
      const partial = msg.success && msg.metaOk === false;
      // 拡張機能と native host が、共有する契約の異なるバージョンから
      // ビルドされている（#205）。成功した保存の上で言い、他のあらゆ
      // る成功時の文言より優先して言う: 他の文言はこの保存（うまく
      // いった）を説明するが、これはツールそのものが半端に更新され
      // ていて、次の保存はそうならないとは限らないと言っている。同じ
      // 理由で緑ではなく琥珀色の「要注意」状態で示し、一部欠けた保存
      // と同じだけ長く保持する。
      const skewText = msg.success ? skewSaveText(msg.hostSkew) : null;
      const attention = partial || !!skewText;
      let text: string;
      if (!msg.success) {
        // background は生の診断詳細をページの外に留め、ローカライズ
        // された復旧の助言に適した、分類済みの理由だけを渡す。
        text = saveFailureText(msg.errorKind, undefined, msg.queued);
      } else {
        // grouped > 0: この投稿はこのセッションですでに保存されてい
        // た＝アプリは同じ投稿の保存を1枚の重なったカードに折りたた
        // むので、素の成功ではなくそう言う（そうしないと、保存はグ
        // リッドの中で黙って何もしなかったように見えてしまう）。置き
        // 換えは「grouped」の代わりにそう言う: 古いレコードはゴミ箱
        // へ向かう途中なので、それを統合と呼ぶのは誤りになる。
        text = skewText ?? (partial ? partialSaveText(msg.metaReason, msg.domFilled) : replacing ? getMessage('dupReplaced') : msg.grouped > 0 ? getMessage('bannerSavedGrouped', [msg.grouped + 1]) : MSG.saved);
      }
      banner.setState(attention ? 'partial' : msg.success ? 'success' : 'error', text);
      // 状態の切り替わりが視界の端でも分かるよう、小さなバッジのポッ
      // プを入れる（アプリの hologramBadgePop: 共有の ease-out カーブ
      // で0.3秒）。
      if (msg.success && !attention) banner.pop();
      // 失敗（と要注意なもの全般）は読めるよう長めに保持する。
      setTimeout(cleanup, attention || !msg.success ? 2800 : 1500);
    }
    return undefined;
  }

  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // === リスナーの登録 ===
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onUserClick, true);
  document.addEventListener('contextmenu', onUserContextMenu, true);
  document.addEventListener('keydown', onUserKeyDown, true);
  addEventListener('scroll', onScroll, { capture: true, passive: true });
}

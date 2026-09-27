// ブックマーク/一覧ページの自動キャプチャ（X 向けが #362、#280 が
// ContentSite の isBulkCapturePage を実装する任意のサイトへ一般化し
// た。pixiv が2つ目）。
//
// 機械は絶対にスクロールもページ送りもしない。ユーザーが自分のペース
// で一覧を動かし（X ではスクロール、pixiv ではページャのクリック）、
// これはそれについていって、まだライブラリにない投稿を保存する。機械
// 駆動のナビゲーションは X について特に却下した: X は自動化された振る
// 舞いを見せるアカウントをロックし（スクロールの速さや入力のタイミン
// グがそれが読む信号のひとつだ）、そこで危険にさらされるのはユーザー
// 自身のアカウントだ。ここでサイトが目にするすべての要求は、ユーザー
// 自身のスクロール/ページ送りがすでに引き起こしたものだ。pixiv には
// そうした文書化されたリスクはないが、#280 はサイトごとに議論し直す
// のではなく同じルールを保った＝「機械が駆動することがあるかどうか」
// をサイトごとのつまみにして凍結すると、次のサイトがそっと違う答えを
// 出すことを招いてしまう。
//
// 各投稿のパーマリンクを、その行が現れた瞬間に読み、
// すでに保存済みかどうかをライブラリへ尋ね（その答えは native host の
// 索引から来て、サイトには一切触れない＝すでに済んだ範囲を再実行して
// も無料である理由がこれだ）、残りを1件ずつ保存する。パーマリンクは行
// が mount された瞬間に読むので、速いスクロールで何かを取りこぼすこ
// とはない＝行自身の到着がイベントであって、その位置ではない。
// これが正しいページかどうか、そしてその保存がどの印の下に記録される
// かは、各サイト自身のページ知識の残り
// （ContentSite.isBulkCapturePage / capturedVia、#212）と一緒に住んで
// いる。このモジュールはそれに繋ぎ込むすべてのサイトが共有する取り込
// みのフローだけを持つ。
import { logSaveEvent, newSaveId, reportSaveTimeout } from './capture-log.ts';
import { SAVED_QUERY_TIMEOUT_MS } from './deadline.ts';
import { extensionAlive, noteExtensionGone, onExtensionGone } from './extension-context.ts';
import { startSaveDeadline } from './save-deadline.ts';
import type { ContentSite } from './extractor/types.ts';
import { ICONS } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { SaveToasts, SAVE_TOAST_DURATION_MS } from './save-toasts.ts';
import { saveResultText } from './save-result-text.ts';
import { userOnly } from './user-gesture.ts';
import type { HologramI18nApi } from './i18n.ts';
import type { CheckSavedMessage, CheckSavedResponse, SavePostMessage, SaveResponse } from './messages.ts';

type EntryState = 'unknown' | 'queued' | 'saving' | 'saved' | 'skipped' | 'unavailable' | 'ageRestricted' | 'failed';

// 保存は1度に1件、これより速くはしない。メタデータの取得とメディアの
// ダウンロードだけがサイトから見えるもので、これらを人間並みの速さに
// 保つ（Issue #280 の「同時1接続・1件/秒級」というスロットリング要件
// は、X だけでなくすべてのサイトに対してこの同じ定数を適用する）。
const MIN_SAVE_PERIOD_MS = 1000;
const END_QUIET_MS = 4000;

export function startBulkCapture(site: ContentSite, i18n: HologramI18nApi): void {
  const t = i18n.getMessage;
  const toasts = new SaveToasts(t);
  const retryTargets = new Map<string, string>();
  const complete = (response: Extract<SaveResponse, { ok: true }>) => response.metaOk !== false && !response.mediaMissing && !response.acquisitionIssues?.length;

  // 再試行は保存済みのURLを使う。投稿が画面外へ出ても、取り込み終了後でも実行できる。
  function showFailure(url: string, response?: SaveResponse) {
    if (response?.ok) {
      if (response.captureId && !retryTargets.has(url)) retryTargets.set(url, response.captureId);
      const text = saveResultText(response, t);
      toasts.notice(url, '', text.failure, () => retryPost(url), 'partial', { url, savedSummary: text.savedSummary });
      return;
    }
    const failure = response && !response.ok ? response : null;
    toasts.notice(url, url, i18n.saveFailureText(failure?.errorKind, failure?.metaReason, failure?.queued), failure?.queued ? undefined : () => retryPost(url), failure?.queued ? 'idle' : 'error', { url, savedSummary: failure?.savedNothing ? t('saveNothingSaved') : undefined });
  }
  function retryPost(url: string) {
    if (!extensionAlive()) {
      toasts.notice(url, url, t('bannerExtensionReloaded'));
      return;
    }
    const saveId = newSaveId();
    toasts.begin(saveId);
    const deadline = startSaveDeadline(saveId, (error) => {
      reportSaveTimeout('bulk-intake', site.platform, url, error, saveId);
      toasts.end(saveId, false);
      showFailure(url);
    });
    try {
      chrome.runtime.sendMessage({ type: 'savePost', postUrl: url, platform: site.platform, saveId, retryOf: retryTargets.get(url), capturedVia: site.capturedVia ?? null } satisfies SavePostMessage, (response?: SaveResponse) => {
        if (!deadline.settle()) return;
        const ok = !chrome.runtime.lastError && response?.ok === true && complete(response);
        toasts.end(saveId, ok);
        if (!ok) showFailure(url, response);
      });
    } catch {
      deadline.settle();
      toasts.end(saveId, false);
      toasts.notice(url, url, t('bannerExtensionReloaded'));
    }
  }

  // url -> 状態。要素は絶対に保持しない: パーマリンクさえ読めば投稿は
  // URL だけで保存できるので、実行の途中で行がリサイクルされてもこれ
  // が反応すべきイベントにはならない。
  const entries = new Map<string, EntryState>();
  let savedCount = 0;
  let skippedCount = 0;
  let unavailableCount = 0;
  let ageRestrictedCount = 0;
  let failedCount = 0;

  let stopped = false;
  let busy = false;
  let lastSaveStartedAt = 0;
  let lastGrowthAt = Date.now();
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;

  // === UI ===
  //
  // 一括取り込みの進捗と停止操作を持つバナー（#44 — status-surface.ts）。
  const banner = new StatusSurface({ resting: ICONS.drop });
  banner.el.setAttribute('data-hologram-bulk-banner', '');
  banner.label.setAttribute('data-hologram-bulk-label', '');
  banner.setState('busy', '');

  // これらの画面の中で唯一の操作: ユーザーが始めた実行には止める手段
  // が必要なので、このバナーだけが入力を受け取る。
  const stopButton = document.createElement('button');
  stopButton.type = 'button';
  stopButton.className = 'action';
  stopButton.textContent = t('bulkStop');
  // 信頼されたイベントのみ（#323）: 停止は自分の実行についてのユー
  // ザー自身の決定であり、このボタンはページが手を伸ばせる共有 shadow
  // root の中にある。
  stopButton.onclick = userOnly<MouseEvent>((e) => {
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  });
  banner.el.style.pointerEvents = 'auto';
  banner.slot(stopButton);

  banner.mount();
  banner.enter();

  // 終端の状態だけを数える＝'unknown'/'queued'/'saving' はまだ進行中。
  function processedCount(): number {
    let n = 0;
    for (const state of entries.values()) if (state !== 'unknown' && state !== 'queued' && state !== 'saving') n++;
    return n;
  }

  function paint() {
    if (stopped) return;
    // 合計が意味を持つのは、一覧が最初から DOM に全件揃っているサイト
    // だけだ（#280）＝X の仮想リストは常に増えうるので、そこで「M件
    // 中N件」と出すと、さらにスクロールすれば増えるはずの M を確定値
    // と誤って伝えてしまう。
    const text = site.bulkKnowsTotal ? t('bulkProgressTotal', [entries.size, processedCount(), savedCount, skippedCount]) : t('bulkProgress', [savedCount, skippedCount]);
    banner.setState('busy', text);
    banner.slot(stopButton);
  }
  paint();

  // === 収集 ===

  // パーマリンクだけを、しかも行が mount された瞬間からしか読まな
  // い。仮想リストはユーザーがスクロールして通り過ぎた行を捨てるが、
  // 行は追加される前に捨てられることはありえないので、到着時に読めば
  // ページがどれだけ速く動いても取りこぼしはない。
  function harvestFrom(root: ParentNode) {
    const selector = site.postSelector || 'article';
    const posts: Element[] = [];
    if (root instanceof Element && root.matches?.(selector)) posts.push(root);
    for (const el of root.querySelectorAll?.(selector) || []) posts.push(el);

    let grew = false;
    for (const el of posts) {
      let url = '';
      try {
        url = site.getPermalink(el);
      } catch {
        url = '';
      }
      // 描画途中の行にはまだパーマリンクのアンカーがない。それはさら
      // なる変更としてアンカーを mount し、それがここへ戻ってこさせ
      // る。
      if (!url || entries.has(url)) continue;
      entries.set(url, 'unknown');
      grew = true;
    }
    if (!grew) return;
    lastGrowthAt = Date.now();
    askSaved();
  }

  // === 「すでに保存済みか」 ===

  // background.js を通して native host の索引が答える（#54 の経路）
  // ので、これは X には絶対に届かない。それが、すでに取り込んだ投稿の
  // 上でこのモードを再実行しても安上がりである理由であり、設計が前回
  // の実行がどこで止まったかの記録を必要としない理由でもある: 済んだ
  // 範囲は単純に素通りする。
  let asking = false;
  function askSaved() {
    if (asking || stopped) return;
    const urls = [...entries].filter(([, state]) => state === 'unknown').map(([url]) => url);
    if (!urls.length) return;
    // #594: この実行の下で拡張機能が入れ替わっているかもしれない。実
    // 行は数分続くので、Chrome が自分で拡張機能を更新したときにここに
    // 居合わせている可能性が最も高い経路がこれだ。しかもこの呼び出し
    // はユーザーがスクロールして表示させる行のバッチごとに到達するの
    // で、これが気付く役目を果たす。probe が知らせ、下で登録されるハ
    // ンドラが実行を終わらせる。
    if (!extensionAlive()) return;
    asking = true;
    // 一度も答えられない問い合わせがあると `asking` が true のまま固
    // まってしまい、それ以降どのバッチも送られなくなる＝実行は生きて
    // いるように見えながら何も取り込まなくなる（#507）。タイムアウト
    // はフラグを消すだけ: 次に mount される行がここへ戻ってきて再度
    // 尋ねる。
    let answered = false;
    const askTimer = setTimeout(() => {
      if (answered) return;
      answered = true;
      asking = false;
    }, SAVED_QUERY_TIMEOUT_MS);
    const onAnswer = (res?: CheckSavedResponse) => {
      if (answered) return;
      answered = true;
      clearTimeout(askTimer);
      asking = false;
      if (chrome.runtime.lastError || !res?.ok || !res.results) return; // host に届かない: 次の回で再度尋ねる
      for (const url of urls) {
        if (entries.get(url) !== 'unknown') continue;
        if (res.results[url] != null && res.results[url]?.post !== false) {
          entries.set(url, 'skipped');
          skippedCount++;
        } else {
          entries.set(url, 'queued');
        }
      }
      paint();
      schedulePump();
      askSaved(); // このバッチが飛んでいる間に mount された行
    };
    // 上の probe に加えて try/catch も（#594）: 尋ねてから呼ぶまでの
    // 窓は小さいがゼロではなく、ここでの無防備な throw は行を mount
    // した MutationObserver のコールバックから出てくる＝収集の残りを
    // 道連れにし、`asking` を true のまま固まらせてしまう。その結果、
    // 実行はまだ動いていると言い続けるバナーの下に居座ってしまう。
    try {
      chrome.runtime.sendMessage({ type: 'checkSaved', urls } satisfies CheckSavedMessage, onAnswer);
    } catch {
      answered = true;
      clearTimeout(askTimer);
      asking = false;
      noteExtensionGone();
    }
  }

  // === 保存キュー ===

  function nextQueued(): string | null {
    for (const [url, state] of entries) if (state === 'queued') return url;
    return null;
  }

  function schedulePump() {
    if (pumpTimer || busy || stopped) return;
    const wait = Math.max(0, MIN_SAVE_PERIOD_MS - (Date.now() - lastSaveStartedAt));
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, wait);
  }

  function pump() {
    if (busy || stopped) return;
    const url = nextQueued();
    if (!url) {
      checkEnd();
      return;
    }
    // #594。何かを進行中と印を付ける前、デッドラインを起動する前に:
    // 切断された接続へ向けて始まった保存は、そのタイマーだけを動かし
    // 続けたまま残ってしまう。これがまさに、以前これが「保存がタイム
    // アウトした」で終わっていた経緯だ＝更新されただけの健全な拡張機
    // 能がその責めを負わされていた。
    if (!extensionAlive()) return;
    busy = true;
    lastSaveStartedAt = Date.now();
    entries.set(url, 'saving');
    // 実行の中の各投稿は、それぞれ自分の id を持つ独立した保存の試み
    // なので、実行のログ行は1つの未分化のブロックとしてではなく投稿ご
    // とに読める（#519）。
    const saveId = newSaveId();
    // キューは直列なので、応答のない保存1つが取り込み全体を止める＝
    // `busy` は絶対にクリアされず、残っているブックマークはすべて、実
    // 行中だと言い続けるバナーの裏で待たされる（#507）。デッドライン
    // はその1件の投稿だけを諦め（失敗としてカウントする＝これがサマ
    // リーの存在意義だ）、キューを先へ進める。
    const deadline = startSaveDeadline(saveId, (error) => {
      // `stopped` で打ち切る前にログを書く: 見捨てられた投稿は、実行
      // がまだ画面上にあってそれを数えられるかどうかに関わらず、1行の
      // 価値がある。実行自身のサマリーは一時的なものだが、これは後の
      // 読み手が手にするものだ。
      reportSaveTimeout('bulk-intake', site.platform, url, error, saveId);
      showFailure(url);
      if (stopped) return; // 実行はすでに終わってサマリーを出力済み
      busy = false;
      entries.set(url, 'failed');
      failedCount++;
      paint();
      schedulePump();
    });
    // 呼び出しの場でインラインに書くのではなく名前を付ける。それに
    // よって呼び出し自体が、下の try/catch の中でただ1つの文になる
    // （#594）。
    const onAnswer = (res?: SaveResponse) => {
      if (!deadline.settle()) return; // すでに諦めた投稿への遅れた答え
      busy = false;
      // 下の分岐の中ではなくここで絞り込む: あの条件は選言（ポート自
      // 体が失敗しているかもしれない）なので、TypeScript に `res` に
      // ついて何も教えず、SaveResponse の成功側には読める errorKind が
      // ない。#492 と #225 は数分違いでマージされ、どちらの PR の CI
      // もこの組み合わせを見なかった。それが main を赤いままにしてい
      // た。
      const failure = res && !res.ok ? res : null;
      if (chrome.runtime.lastError || !res?.ok) {
        showFailure(url, res);
        // 投稿自体を取得できなかった（#492）＝削除・凍結・非公開・年
        // 齢制限。何も書き込まれず何も壊れていないので、本物の失敗と
        // は分けて数える: ブックマーク一覧は死んだ投稿を一握り、永遠
        // に抱え続けることがあり、そうでなければすべての実行がそれら
        // をユーザーが直しに行くべき破損として報告してしまう。
        //
        // 年齢制限の投稿はそこからさらに分けてある（#505）: それらは
        // 生きている＝X は匿名の embed リクエスト（こちらが行える唯一
        // の種類だ）に対して単に投稿情報を返さないだけだ。「削除また
        // は非公開」に折り込むと、投稿がまだそこにあるのに消えたと
        // ユーザーに伝えてしまうし、取り込みを再実行しても結果が絶対
        // に変わらないという事実も隠してしまう。
        if (failure?.errorKind === 'post-unavailable' && failure.metaReason === 'ageRestricted') {
          entries.set(url, 'ageRestricted');
          ageRestrictedCount++;
        } else if (failure?.errorKind === 'post-unavailable') {
          entries.set(url, 'unavailable');
          unavailableCount++;
        } else {
          entries.set(url, 'failed');
          failedCount++;
        }
      } else if (!complete(res)) {
        entries.set(url, 'failed');
        failedCount++;
        showFailure(url, res);
      } else {
        entries.set(url, 'saved');
        savedCount++;
      }
      paint();
      schedulePump();
    };
    try {
      chrome.runtime.sendMessage(
        {
          type: 'savePost',
          postUrl: url,
          platform: site.platform,
          saveId,
          // レコードの取り込み経路に印を付け、一括で取り込まれた投稿
          // を普通の1件ずつの保存と見分けられるようにする
          // （native-host/post-record）。ここに到達するすべてのサイト
          // は isBulkCapturePage を持ち、それと一緒にこれも設定するこ
          // とが期待されている（#280）。
          capturedVia: site.capturedVia ?? null,
        } satisfies SavePostMessage,
        onAnswer,
      );
    } catch {
      // 上の probe とこの行の間で無効化された（#594）。デッドラインは
      // すでに起動しているので、発火させるのではなくここで決着させ
      // る: この投稿は実行がカウントすべき失敗ではない。それを数える
      // 実行がもう残っていないからだ＝下のハンドラがそれを終わらせ
      // る。
      deadline.settle();
      busy = false;
      noteExtensionGone();
    }
  }

  // === 一覧の終わり ===

  function checkEnd() {
    if (stopped) return;
    // 未設定（pixiv、#280）は一覧が仮想化されていないことを意味し、
    // 存在しない fold の下にはもう何も mount されえない＝静かで空とい
    // うのがすでに話の全体だ。
    const atBottom = site.bulkAtBottom ? site.bulkAtBottom() : true;
    const quiet = Date.now() - lastGrowthAt >= END_QUIET_MS;
    const nothingLeft = ![...entries.values()].some((s) => s === 'unknown' || s === 'queued');
    if (atBottom && quiet && nothingLeft) finish(false);
  }

  // === 後始末 ===

  // この実行が動かしたままにしているものをすべて取り除く。下の孤児化
  // した終わり方とも共有する。そちらにはサマリーを出力する術も、書け
  // るログ行もない。
  function teardown() {
    stopped = true;
    observer.disconnect();
    removeEventListener('scroll', onScroll, true);
    document.removeEventListener('keydown', onUserKeyDown, true);
    if (pumpTimer) clearTimeout(pumpTimer);
    pumpTimer = null;
    if (window.__snsPostSaveCleanup === stop) delete window.__snsPostSaveCleanup;
    window.__snsPostSaveActive = false;
    banner.el.style.pointerEvents = 'none';
  }

  function finish(byUser: boolean) {
    if (stopped) return;
    // 実行がどう終わったか、何を伴って。`cancel` がその要点だ: 停止ボ
    // タン、Esc、ブックマーク一覧からの離脱は、どれもユーザーが止める
    // と決めたということであり、それを途中で死んだ実行と見分けること
    // が、このログにできなかったことだ（#519）。saveId はない＝実行は
    // 多数の保存を保持し、それぞれが自分の id を持つ。
    logSaveEvent({
      stage: 'bulk',
      phase: byUser ? 'cancel' : 'ok',
      platform: site.platform,
      seen: entries.size,
      saved: savedCount,
      skipped: skippedCount,
      unavailable: unavailableCount,
      ageRestricted: ageRestrictedCount,
      failed: failedCount,
    });
    teardown();

    // 本物の失敗に当たった実行は緑ではなく琥珀色で終わる＝サマリーは
    // それを言葉で言い、画面は今それを色でも言う（setState は、その状
    // 態を持っていたボタンと一緒に停止ボタンを落とす）。
    banner.el.dataset.variant = 'toast';
    banner.mount();
    banner.setState('success', summaryText(byUser));
    setTimeout(dismiss, SAVE_TOAST_DURATION_MS);
  }

  // この実行の下で拡張機能が入れ替わった（#594）。実行は数分続くの
  // で、拡張機能の中のどの経路よりも、Chrome が自分でそれを更新した
  // ときにここに居合わせている可能性が高い＝これが存在する前は、取り
  // 込みは切断された接続に到達したどのコールバックからであれ単純に
  // 「Extension context invalidated.」を投げ、その後も、もう何も取り
  // 込めなくなった実行の進捗バナーを表示し続けていた。
  //
  // ユーザーがこの実行を求めたのだから、それは伝えられる: 通知は、実
  // 行がずっと描いてきたバナーのエラー状態に入る。これが #594 の「失
  // 敗した要求」に対するルールだ（沈黙する方の半分は、誰も何も求めて
  // いないタブのためのものだ）。サマリーはない＝件数は終わった実行を
  // 説明するものだが、こちらは途中で断ち切られていて、代わりに読まれ
  // るべき指示を持つ。ログにも何も残さない: その行は同じ切断された接
  // 続を通ることになる。
  function finishOrphaned() {
    if (stopped) return;
    teardown();
    // 読むべきものを持って終わった実行と同じ長さの滞留: これは結果で
    // はなく指示であり、それが言われる唯一の場所だ。
    banner.remove();
    toasts.notice('extension', '', t('bannerExtensionReloaded'));
  }

  function summaryText(byUser: boolean): string {
    const head = byUser ? t('bulkStopped') : t('bulkFinished');
    const parts = [t('bulkSummarySaved', [savedCount]), t('bulkSummarySkipped', [skippedCount])];
    return `${head} — ${parts.join(' / ')}`;
  }

  function dismiss() {
    banner.exit();
  }

  function stop() {
    finish(true);
  }

  // === 待ち受け ===

  function onScroll() {
    schedulePump();
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') finish(true);
  }
  // Esc も停止ボタンと同じくユーザーのもの（#323）。
  const onUserKeyDown = userOnly(onKeyDown);

  const observer = new MutationObserver(async (records) => {
    // これが動くすべてのサイトは、関係する意味で SPA だ: 一覧から離
    // れてもコンテンツはその場で入れ替わるだけで unload は一切発火し
    // ない。だから他の何もこのモードを終わらせることはない（#212 の
    // isBulkCapturePage は、入口のゲートが使ったのと同じチェックで、
    // まさにその理由でここでも再度尋ねている）。await しているのは、
    // pixiv の答えが最初の1回だけネットワークの往復を必要とするから
    // だ＝isPixivOwnBookmarksPage のメモ化を参照。それが最初の1回以降
    // のすべての呼び出しを無料にしている。
    if (!(await site.isBulkCapturePage?.())) {
      finish(true);
      return;
    }
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) harvestFrom(node as Element);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('keydown', onUserKeyDown, true);

  // 2回目の起動でこのモードを終える。単発の経路のトグルと同じ形だ。
  window.__snsPostSaveActive = true;
  window.__snsPostSaveCleanup = stop;

  // observer と listener が存在した後に登録する。すでに消えたと分
  // かっている context はこのハンドラをその場で実行してしまい、
  // teardown() はまだ作られていない observer に手を伸ばすことになる
  // からだ。上の2つの呼び出しのうちどちらが先に気付いても、ここを通
  // して実行を終わらせるので、呼び出し箇所ごとに終わり方が1つずつある
  // のではなく、終わり方は1つになる。
  onExtensionGone(finishOrphaned);

  // 実行が始まった。finish() が書く `bulk` の行と対になっていて、ペー
  // ジが消えて実行が途中で断ち切られても、何もないのではなく、始まり
  // だけが残って終わりがないという形になる（#519）。
  logSaveEvent({ stage: 'bulk', phase: 'begin', platform: site.platform, url: location.href });

  harvestFrom(document);
}

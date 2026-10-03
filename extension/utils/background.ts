import { selectPostMedia } from './select-post-media.ts';
import { acquisitionComplete } from './acquisition-result.ts';
import { CaptureMetadataSchema } from '../../native-host/protocol.mts';
// どのサイトが存在するか、そしてそれらについてのプラットフォーム固有
// のことはすべて extractor の登録簿（utils/extractor/）から来る＝この
// ファイルは自前のプラットフォームごとの分岐を一切持たない（#212）。
// native messaging の契約は、これらのメッセージを読む host と共有し
// ている（#400 — native-host/protocol.mts）。ここで組み立てる保存要
// 求は、ブリッジのパースが生み出すのと同じ宣言なので、欄の改名や欠落
// はディスク上で失敗する保存ではなく、こちら側のコンパイルエラーにな
// る。
import { hostExtBuild, protocolSkewOf, readHostResponse, responseId } from '../../native-host/protocol.mts';
import type { CaptureMetadata, HostRequest, ProtocolSkew, SaveMediaRequest, SavedResults, TrashedEntry, TrashedResults } from '../../native-host/protocol.mts';
import { METADATA_TIMEOUT_MS, NATIVE_HOST_TIMEOUT_MS, SAVED_QUERY_TIMEOUT_MS, withDeadline } from './deadline.ts';
import { getNativeHost } from './native-host.ts';
import { verificationHost, verificationKey, showVerificationBadge } from './verification-tabs.ts';
import { EXT_BUILD_ID, LOCAL_BUILD_RELOAD_QUIET_MS, LOCAL_BUILD_RELOAD_STATE_KEY, LOCAL_BUILD_RELOAD_WORK_MS, bulkActivity, captureActivity, createLocalBuildReloadGate, shouldReloadFor } from './local-build-reload.ts';
import type { LocalBuildReloadState } from './local-build-reload.ts';
import { buildWebMeta } from './extractor/web-meta.ts';
import type { WebMetaResult } from './extractor/web-meta.ts';
import { mergeDomMeta } from './extractor/dom-meta.ts';
import { fetchPostMetadata, getHostname, isAllowedSender, RESIDENT_MATCHES } from './extractor/index.ts';
import type { DomMeta, PostRecord } from './extractor/types.ts';
import type { BridgeAck, CheckSavedResponse, ContentToBackgroundMessage, DumpLogsResponse, LogCaptureResponse, PageMetaExtractedMessage, QueueStatsResponse, ResendQueueResponse, SavedEntry, SavedUpdateMessage, SaveProgressMessage, SaveResponse } from './messages.ts';
import { classifySaveFailure, saveFailureConsoleLevel } from './native-error.ts';
import { createSaveGate, saveRequestKey } from './host-budget.ts';
import { clearInjectFailure, escalationUrl, injectFailureKind, showInjectFailure } from './inject-failure.ts';
import type { InjectFailureKind } from './inject-failure.ts';
import type { SaveLogEntry, SaveStage } from './capture-log.ts';
import { markQueuedSaveNotSent, markQueuedSaveUnknown, removeQueuedSave, saveQueueStats, stashFailedSave, sweepSaveQueue } from './save-queue.ts';
import { selectedMediaContextInPage } from './selected-media-context.ts';
import { installUncaughtReporting } from './uncaught-report.ts';

export function startBackground(): void {
  // --- キャプチャの診断 ------------------------------------------------------
  // native host の capture.log に届かなかったログのエントリのための
  // フォールバック用リングバッファ（host が起動に失敗することこそ、
  // 最も記録しておきたい失敗だ）。logCapture / stashLogLocally /
  // dumpLogs のハンドラを参照。
  const DIAG_PREFIX = 'diaglog_';
  const DIAG_KEEP = 50;

  // 同時にいくつの保存が進行中でよいか、そしてどの要求が同じ保存なの
  // か（#323 — host-budget.ts）。3つの保存経路すべてに1つのゲート＝
  // 上限は native host に対するもので、host はどの経路が尋ねたかを気
  // にしない。
  const saveGate = createSaveGate<any>();
  // 拒否された要求が受け取る答え。不具合ではなくユーザーが直せるもの
  // でもない＝人がここに到達する唯一の道は、host が終えられるより速
  // く保存することで、助言は「待つ」ことがすべてだ。
  const BUSY_ERROR = 'Too many saves in flight for this tab';

  // --- 新しいローカルビルドが出来たとき、この拡張機能をリロードする（#650） -------------
  // いつリロードするかのルール（そしてこれが存在する理由そのもの）は
  // utils/local-build-reload.ts にある。ここにあるのは配線: 何が、リロードで
  // 壊れてしまう work とみなされるか、そしてリロードが実際にどう実行
  // されるか。
  //
  // 以下はすべて、このバンドルが scripts/build-extension.cts でビルド
  // され、かつ native host がそのビルドの stamp ファイルを見つけた場
  // 合以外は不活性だ。だからリリース済みのインストールは
  // noteHostBuild の最初の行より先には絶対に進まない。
  const localBuildReloadGate = createLocalBuildReloadGate({ now: () => Date.now(), savesInFlight: () => saveGate.inFlight() });
  // host が最後に報告したビルドで、ここで動いているものと違う場合。
  let pendingBuild: string | null = null;
  // すでにリロードを1回使ってしまったビルド。どんな判断を下すよりも
  // 前に保管庫から復元する＝これが何を防ぐかは LocalBuildReloadState.attempted
  // を参照。
  let attemptedBuild: string | null = null;
  let localBuildReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let localBuildReloadStarted = false;

  // 前のインスタンスが残したメモを読み、どのトークンがすでに試された
  // か知る。即座に開始する＝応答がループを断ち切る仕組みの復元と競合
  // しないように。
  const localBuildReloadRestored: Promise<void> = EXT_BUILD_ID ? restoreLocalBuildReload() : Promise.resolve();

  async function restoreLocalBuildReload(): Promise<void> {
    let state: LocalBuildReloadState | null = null;
    try {
      const got = await chrome.storage.local.get(LOCAL_BUILD_RELOAD_STATE_KEY);
      state = (got?.[LOCAL_BUILD_RELOAD_STATE_KEY] as LocalBuildReloadState | undefined) || null;
    } catch {
      return; // 復元するものがなく、できることも何もない
    }
    if (!state) return;
    attemptedBuild = state.attempted || null;
    // 試行を覚えておくのは、それが証明されていない間だけだ。このバン
    // ドルが求められていたビルドそのものになった時点で、このメモは役
    // 目を終えていて、それを保持し続けると、たまたま同じトークンを再
    // 利用した将来のビルドをブロックしてしまう。
    try {
      if (attemptedBuild && attemptedBuild !== EXT_BUILD_ID) await chrome.storage.local.set({ [LOCAL_BUILD_RELOAD_STATE_KEY]: { attempted: attemptedBuild } satisfies LocalBuildReloadState });
      else {
        attemptedBuild = null;
        await chrome.storage.local.remove(LOCAL_BUILD_RELOAD_STATE_KEY);
      }
    } catch {
      /* できる範囲で＝判断が読むのは上のメモリ上のコピーだ */
    }
  }

  // すべての host の応答（ack、問い合わせの答え、中継されたログの
  // ack、失敗も同様）がここを通る。これこそが、成功したものだけでは
  // なくすべての応答にスタンプを押す意義だ: 運び手は次にたまたま行わ
  // れる往復ならなんでもよい。
  function noteHostBuild(build: string | null): void {
    if (!EXT_BUILD_ID || !build || build === EXT_BUILD_ID) return;
    pendingBuild = build;
    maybeLocalBuildReload();
  }

  function scheduleLocalBuildReload(ms: number): void {
    if (localBuildReloadTimer !== null) clearTimeout(localBuildReloadTimer);
    // 上限を付ける: blockedUntil は1つの work の窓より先までは絶対に
    // 見ないので、それを超えるタイマーは、それをセットした worker よ
    // り長生きするだけになる。
    localBuildReloadTimer = setTimeout(
      () => {
        localBuildReloadTimer = null;
        maybeLocalBuildReload();
      },
      Math.min(Math.max(ms, 0), LOCAL_BUILD_RELOAD_WORK_MS) + 50,
    );
  }

  function maybeLocalBuildReload(): void {
    if (!pendingBuild || localBuildReloadStarted) return;
    const wait = localBuildReloadGate.blockedUntil() - Date.now();
    if (wait > 0) {
      scheduleLocalBuildReload(wait);
      return;
    }
    localBuildReloadStarted = true;
    void localBuildReloadRestored
      .then(async () => {
        const build = pendingBuild;
        if (!build || !shouldReloadFor(build, EXT_BUILD_ID, attemptedBuild)) return;
        // await の後にもう一度尋ねる: メモを復元するのは保管庫への往
        // 復であり、その中で保存が始まっていることがありうる。
        if (localBuildReloadGate.blockedUntil() > Date.now()) {
          scheduleLocalBuildReload(LOCAL_BUILD_RELOAD_QUIET_MS);
          return;
        }
        await chrome.storage.local.set({ [LOCAL_BUILD_RELOAD_STATE_KEY]: { attempted: build } satisfies LocalBuildReloadState });
        // capture.log には書かない: その行は、この呼び出しがまさに殺
        // そうとしている native 接続を通ることになる。リロードを見て
        // いる開発者がすでに見ているのは service worker のコンソール
        // だ。
        console.info(`[hologram] a newer extension build is on disk (${build}); reloading the extension`);
        chrome.runtime.reload();
      })
      .catch(() => {})
      .finally(() => {
        localBuildReloadStarted = false;
      });
  }

  // どのみちページが worker に伝えていることを、#650 のためにもう一
  // 度読む。capture.log の中継は、ページ内の画面がすでに自分から名
  // 乗っている唯一の経路だ＝一括実行の `bulk`/`begin` とその終端の
  // 行、そして何も選ばずに閉じられたキャプチャ UI
  // （`select`/`cancel` と `select`/`fail`）。ここでそれを読むこと
  // で、リロードのゲートは自前のメッセージを必要とせず、人間が後で読
  // むログとずれてしまうこともなくなる。
  function noteLocalBuildReloadActivity(tabId: number | null, stage: unknown, phase: unknown): void {
    if (tabId == null) return;
    if (stage === 'bulk') {
      if (phase === 'begin') localBuildReloadGate.begin(bulkActivity(tabId));
      else localBuildReloadGate.end(bulkActivity(tabId));
    }
    // ユーザーがキャプチャ UI を閉じた、または投稿ではない何かをク
    // リックして UI が一緒に落ちた。どちらにせよ、中断すべき選択はも
    // う残っていない。
    if (stage === 'select' && (phase === 'cancel' || phase === 'fail')) localBuildReloadGate.end(captureActivity(tabId));
    maybeLocalBuildReload();
  }

  interface StageError extends Error {
    stage: SaveStage;
    metaReason?: string | null;
    // SaveTrace.fail が埋める。それによって各経路がただ1つ持つ catch
    // が、その経路について何も知らなくても、失敗を保存の残りに結び付
    // け、どこまで進んだかを言う行を書ける（#519）。
    saveId?: string | null;
    captureId?: string | null;
    reached?: SaveStage[];
    // #203: 未送信または結果不明になった 'bridge' の保存で、
    // save-queue.ts への退避を試みた後にセットする＝エントリが今再試
    // 行用にキューへ入っていれば true、何も保持できなければ false。
    // それ以外のすべての失敗（このキューが一切扱わない経路、host が
    // 実際に答えを返した場合、'bridge' より前の段階）では未設定。
    queued?: boolean;
  }

  // エラーに、それが失敗したパイプラインの段階の印を付ける。それに
  // よって、メッセージハンドラのただ1つの catch がどの段階が壊れたか
  // をログに残せる。select/permalink は content.js が報告し、
  // capture/crop/metadata/bridge はここで印を付ける。
  //
  // metaReason は、ユーザーが直すべきではない1つの失敗のために一緒に
  // 運ばれる: host は何も得られなかった保存を拒否し（#492）、投稿情
  // 報が欠けていた理由が「削除された、永久に消えた」と「年齢制限、生
  // きてはいるがこの経路の手が届かない」の違いになる（#505）。これが
  // なければ、バナーは種別全体しか名指せない。
  function stageError(stage: SaveStage, message: string, metaReason: string | null = null): StageError {
    const err = new Error(message) as StageError;
    err.stage = stage;
    err.metaReason = metaReason;
    return err;
  }

  interface SaveTrace {
    passed(stage: SaveStage): void;
    fail(stage: SaveStage, message: string, metaReason?: string | null): StageError;
  }

  // capture.log の中に1つの保存のスレッドを開き、そこへ書き込む2つの
  // 方法を返す（#519）。
  //
  // `save`/`begin` の行がこの要点だ: これは、下にある待機のどれかが
  // 止まるより前にディスク上にあるので、終わらない保存は、始まりもし
  // なかった保存ともう見分けがつかない、ということがなくなる。これは
  // native 接続を1つ余分に消費する＝Chrome は接続ごとに host のプロ
  // セスを起動するので、ブックマーク取り込みの実行中は、保存1件につ
  // き1つではなく2つになる。これは意図してのことだ: 取り込みこそが、
  // 1つの詰まった保存がその後ろのすべてを止めていた場所であり
  // （#507）、だからこそこの死角を残しておいてよい最後の経路だ。
  //
  // 絶対に await しない。この行はそれが作られた時点で自分の `ts` を
  // 刻むので、遅い host がそれを保存自身の終端の行より後に届けても順
  // 序が読めなくならない＝位置ではなく `ts` でソートする。
  function beginSave(type: 'savePost' | 'saveMedia', ctx: { saveId: string | null; captureId: string; platform: string | null; url: string | null; tabId: number | null }): SaveTrace {
    const reached: SaveStage[] = [];
    logCapture({ stage: 'save', phase: 'begin', saveId: ctx.saveId, captureId: ctx.captureId, type, platform: ctx.platform, url: ctx.url });
    return {
      // ある段階が終わった。終端の行のためにここへ保持し、ページへ
      // push する。この worker の方が消えたとき、行を書けるのはペー
      // ジ側だけになるからだ（SaveProgressMessage を参照）。
      passed(stage: SaveStage) {
        reached.push(stage);
        if (ctx.tabId == null || !ctx.saveId) return;
        chrome.tabs.sendMessage(ctx.tabId, { type: 'saveProgress', saveId: ctx.saveId, reached: [...reached] } satisfies SaveProgressMessage).catch(() => {});
      },
      fail(stage: SaveStage, message: string, metaReason: string | null = null) {
        const err = stageError(stage, message, metaReason);
        err.saveId = ctx.saveId;
        err.captureId = ctx.captureId;
        err.reached = [...reached];
        return err;
      },
    };
  }

  // 例外で終わった保存のための capture.log の行。各経路がただ1つ持
  // つ catch から書くので、すべての経路が同じ欄を報告する: どの段階
  // が壊れたか、どの保存だったか、すでにどの段階を通過していたか
  // （#519。これ以前は、失敗の行は段階以外何も名指さず、タイムスタン
  // プ以外の方法でその保存自身の `begin` の行と結び付けられなかっ
  // た）。
  function logSaveFailure(error: StageError | undefined, ctx: { saveId: string | null; platform: string | null; host: string | null; url: string | null }) {
    logCapture(
      {
        stage: error?.stage || 'unknown',
        phase: 'fail',
        saveId: error?.saveId ?? ctx.saveId,
        captureId: error?.captureId ?? null,
        reached: error?.reached ?? [],
        platform: ctx.platform,
        host: ctx.host,
        url: ctx.url,
        error: error?.message,
      },
      true,
    );
  }

  // 保存を始めるか、すでに実行中の同一のものへ合流するか、あるいはだ
  // めだと言うか（#323 — host-budget.ts）。3つの経路が共有するので、
  // 上限と、拒否が残す行が経路の間でずれることはない。
  //
  // 拒否は記録する。そうしなければ見えないままだからだ: 保存は単純
  // に起きず、`inFlight` だけがその理由を言う。下の合流するキューを
  // 通して書くので、拒否をループで引き起こすページが、その記録を1行
  // ごとの接続に逆戻りさせてしまうことはない。
  function admitSave(message: { type: string; saveId?: string | null; platform: string; postUrl: string; capturedVia?: string | null }, tabId: number, host: string | null, imageUrls: readonly string[], start: () => Promise<any>): Promise<any> | null {
    // 投稿保存、個別画像保存、一括取り込みはすべてここで同時実行数を
    // 制限する。同じ要求は2回実行せず、進行中の処理へ合流させる。
    const admitted = saveGate.admit(saveRequestKey(tabId, message.type, message.postUrl, imageUrls), tabId, start);
    if (admitted) {
      // このタブで保存が進行中（#650）。保存自体はすでに数えられてい
      // る（ゲートが saveGate.inFlight() を読む）。これが加えるの
      // は、このタブでの一括実行がまだ生きているという証拠だ＝それは
      // 1秒に1投稿保存するので、これがなければその保留は実行の途中で
      // タイムアウトしてしまう。保存が決着したら再度尋ねる。それがそ
      // の実行によって先送りされていたリロードが可能になる瞬間だから
      // だ。
      localBuildReloadGate.refresh(bulkActivity(tabId));
      const settled = () => {
        // ページ内のキャプチャ UI の仕事は保存が答えた時点で終わる
        // が、一括実行のものはそうではない。だからここで閉じるのはこ
        // ちらだけだ。
        localBuildReloadGate.end(captureActivity(tabId));
        maybeLocalBuildReload();
      };
      admitted.then(settled, settled);
      // 「受理された」＝ページのデッドラインは、不在ではなく沈黙を測
      // り始める前にこれを待つ（save-deadline.ts）。beginSave からで
      // はなくここで push しているのは、ここがすべての経路が通る唯一
      // の合流点だからで、加えて、すでに実行中の同一のものへ合流した
      // 保存に答えられる唯一の場所でもあるからだ: 合流は beginSave に
      // 絶対に到達せず、実行中の保存の段階の行は最初の押下の saveId
      // を運ぶ。
      if (message.saveId) chrome.tabs.sendMessage(tabId, { type: 'saveProgress', saveId: message.saveId, reached: [] } satisfies SaveProgressMessage).catch(() => {});
      return admitted;
    }
    logCapture({ stage: 'save', phase: 'fail', saveId: message.saveId ?? null, type: message.type, platform: message.platform, host, url: message.postUrl, error: BUSY_ERROR, inFlight: saveGate.inFlight(tabId) }, true);
    return null;
  }

  // --- 何もしなかったクリック（#269） ----------------------------------------
  // どのタブに対して、この worker の寿命の中ですでに「直前の押下は始
  // められなかった」と伝えたか。意図してメモリ上に置く: この状態は
  // 「たった今の押下が失敗した」ということであり、再起動した worker
  // が自分でそれを主張する筋合いはない。忘れることの結果は、次の失敗
  // がまた最初のものとして扱われることだけだ＝新しいタブではなくバッ
  // ジになる。2つの間違いの中では静かな方だ。何が描かれるかは
  // utils/inject-failure.ts を参照。
  const injectFailedTabs = new Set<number>();

  // 一括取り込みのコマンドを連続して実行しても注入できなかった場合、
  // `escalate` により修復ページを開く。
  async function alertInjectFailure(tabId: number, escalate: boolean): Promise<InjectFailureKind> {
    const kind = await injectFailureKind();
    const repeated = injectFailedTabs.has(tabId);
    injectFailedTabs.add(tabId);
    showInjectFailure(tabId, kind);
    // このタブでの連続2回目の押下: ツールバーの印は明らかに足りな
    // かったので、実際に解決できるページを開く。
    if (escalate && repeated) chrome.tabs.create({ url: escalationUrl(kind) }).catch(() => {});
    return kind;
  }

  // Chrome はタブが遷移するか閉じると、タブ単位のバッジとタイトルを
  // 自動で消す（実測済み — inject-failure.ts を参照）ので、これらの
  // listener はそれに歩調を合わせてこちら側のメモを消すために存在す
  // る。これがないと、新しく読み込まれたページでの押下が2回目として
  // 扱われ、それを説明する印が画面に何もないままタブが開いてしまう。
  // どちらのイベントも `tabs` permission を必要としない。
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    void showVerificationBadge(tabId).catch(() => {});
    if (changeInfo.status !== 'loading') return;
    injectFailedTabs.delete(tabId);
    // 遷移するタブは、ページ内 UI と実行中の取り込みを道連れにするの
    // で、そこにはリロードがまだ破壊しうる work が何も残らない
    // （#650）。
    localBuildReloadGate.dropTab(tabId);
    maybeLocalBuildReload();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void chrome.storage.local.remove(verificationKey(tabId));
    injectFailedTabs.delete(tabId);
    localBuildReloadGate.dropTab(tabId);
    maybeLocalBuildReload();
  });

  // 右クリックした一覧のタブに一括取り込み UI を出す。
  async function activateBulkOnTab(tab): Promise<void> {
    // 試みを（そして http でない場合の静かな中断も）capture.log に記
    // 録する: 反応しなかったコマンドは、そうしなければ SW の
    // DevTools コンソールからしか診断できず、それが起きたとき誰もそ
    // れを開いていない。
    //
    // 意図して saveId はない。UI の注入は保存を一切開始せず、この2つ
    // を別々に識別できることこそ、このログに欠けていた区別のすべて
    // だ: 後に `save`/`begin` が来ない `activate` の行は、ユーザーが
    // UI を開いてやめたことを意味する（#519）。
    const site = getHostname(tab.url) || 'unknown';
    if (!tab.id || !/^https?:/i.test(tab.url || '')) {
      logCapture({ stage: 'activate', phase: 'skip', site, category: 'bulk-injection', message: 'Page is not eligible for content script injection' });
      return;
    }
    // ログの行より前に置く。ログの行自体が native の往復であり、し
    // たがって「新しいビルドがディスクにある」の運び手にもなるからだ
    // （#650）。ここと下の注入の間で拡張機能がリロードされると、押下
    // は完全に何もしないままになってしまう＝まさに #269 が可視化しよ
    // うとしている失敗そのものだ。
    localBuildReloadGate.begin(captureActivity(tab.id));
    // executeScript は、注入先のコードが実行を始めてから resolve する。
    // したがって入口は await より前に記録し、ページから届く bulk/begin
    // より必ず先に並べる。begin は注入の成功を断言せず、「試みを開始した」
    // という既存の phase 契約だけを表す。
    logCapture({ stage: 'activate', phase: 'begin', site, category: 'bulk-injection', message: 'Content script injection started' });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['bulk.js'],
      });
      // UI がページ上にあるので、以前の押下がツールバーに残した警告
      // が何であれ解消される（#269）。また、これはその後殺された
      // worker が残したバッジを取り下げられる唯一の瞬間でもある。
      clearInjectFailure(tab.id);
      injectFailedTabs.delete(tab.id);
      return;
    } catch {
      // 例外文字列は Chrome が対象 URL を埋め込むことがあるため、コンソール
      // にも転記しない。永続診断と同じ固定文だけを残す。
      console.error('Failed to inject content script');
      // keepLocal: この行は、何もしなかったクリックの唯一の記録で、
      // 診断ページはローカルのリングバッファを読む＝一度も始まらな
      // かった保存には、他に読み返せる場所がない（#269）。
      // Chrome の error.message は対象 URL を引用することがあるため、その
      // 文字列自体をログへ渡さない。失敗した段階とサイトは category/site
      // で特定でき、message は秘密を含まない固定文にする。
      logCapture({ stage: 'activate', phase: 'fail', site, category: 'bulk-injection', message: 'Content script injection failed' }, true);
      localBuildReloadGate.end(captureActivity(tab.id)); // UI が一切立ち上がらなかったので、保護してやる義理もない
      await alertInjectFailure(tab.id, true);
    }
  }

  // --- 右クリックからの取り込み ---------------------------------------------
  // メディア保存は対応サイト外に、一括取り込みは対応する保存済み一覧の
  // URLだけに表示する。documentUrlPatterns は Chrome の表示ゲートで、クリック
  // 後にも各 extractor の isBulkCapturePage が現在のページを検証する。
  // メディア保存ではページの schema.org/OGP/DC/Highwire と、右クリックした画像または動画を保存する。
  // service worker の再起動時に同じ id を再登録できるよう、先に既存の
  // メニューを取り除く。
  //
  // 一貫して `?.` を使っている: これは contextMenus を持たずに
  // chrome.* をモデル化するテストダブルを守るためだ（
  // background-wiring.test.ts はそれを持つ方のテストで、理由はそちら
  // 自身のコメントを参照）。本物の Chrome は manifest の permission
  // が許可されていれば常にこれを持つ。
  const SAVE_MENU_ID = 'hologram-save';
  const IMPORT_SAVED_URLS = [
    'https://x.com/i/bookmarks*',
    'https://x.com/i/history',
    'https://x.com/i/history/',
    'https://twitter.com/i/bookmarks*',
    'https://twitter.com/i/history',
    'https://twitter.com/i/history/',
    'https://bsky.app/saved*',
    'https://www.pixiv.net/users/*/bookmarks/artworks*',
    'https://www.pixiv.net/*/users/*/bookmarks/artworks*',
    'https://pixiv.net/users/*/bookmarks/artworks*',
    'https://pixiv.net/*/users/*/bookmarks/artworks*',
  ];

  // contextMenus の documentUrlPatterns は包含条件だけで、対応サイトを「除く」指定を
  // 持たない。選択中のタブの常駐スクリプトに問い合わせ、応答があれば画像保存を隠す。
  // タブ URL の読み取り権限は使わない。
  function hoverSaveRunsOn(url: string | null | undefined): boolean {
    if (!url) return false;
    try {
      return RESIDENT_MATCHES.includes(`${new URL(url).origin}/*`);
    } catch {
      return false;
    }
  }

  let menuQueryVersion = 0;
  async function syncSaveMediaMenu(): Promise<void> {
    const version = ++menuQueryVersion;
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const resident = tab?.id == null ? null : await chrome.tabs.sendMessage(tab.id, { type: 'getHoverSaveStatus' }, { frameId: 0 }).catch(() => null);
      if (version !== menuQueryVersion) return;
      // 非表示項目も Chrome のサブメニュー化の対象になるため、登録は常に1項目にする。
      const bulk = resident?.hoverSave === true;
      const title = chrome.i18n.getMessage(bulk ? (resident.platform === 'bluesky' ? 'ctxImportSavedPosts' : 'ctxImportSaved') : 'ctxSaveMedia');
      chrome.contextMenus?.update(SAVE_MENU_ID, { title, contexts: bulk ? ['all'] : ['image', 'video'], documentUrlPatterns: bulk ? IMPORT_SAVED_URLS : ['http://*/*', 'https://*/*'] }, () => void chrome.runtime.lastError);
    } catch {
      // 次のタブ更新で再取得する。
    }
  }

  chrome.contextMenus?.removeAll(() => {
    chrome.contextMenus.create({ id: SAVE_MENU_ID, title: chrome.i18n.getMessage('ctxSaveMedia'), contexts: ['image', 'video'] }, () => void chrome.runtime.lastError);
    void syncSaveMediaMenu();
  });

  chrome.tabs.onActivated?.addListener(() => {
    void syncSaveMediaMenu();
  });
  chrome.tabs.onUpdated.addListener(() => {
    void syncSaveMediaMenu();
  });
  chrome.windows?.onFocusChanged?.addListener(() => {
    void syncSaveMediaMenu();
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'hoverSaveReady' && sender.frameId === 0 && sender.tab?.id != null) void syncSaveMediaMenu();
    return false;
  });

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (!tab?.id || !/^https?:/i.test(tab.url || '')) return;
    if (info.menuItemId !== SAVE_MENU_ID) return;
    if (hoverSaveRunsOn(tab.url)) {
      void activateBulkOnTab(tab);
      return;
    }
    if (/^https?:/i.test(info.srcUrl || '')) {
      const mediaType = info.mediaType === 'video' ? 'video' : 'image';
      saveRightClickedMedia(tab, info.srcUrl as string, mediaType).catch(() => {});
    }
  });

  // 他のすべての保存経路が使うのと同じ admitSave/beginSave の仕組みで
  // ゲートし、ログに残す（#323 の予算、#519 の capture.log のスレッド）。
  // 対応サイトにはこの入口を出さないので、メタデータは常にページの
  // schema.org/OGP/DC/Highwire から読む。
  type WebRetry = { tabId: number; pageUrl: string; srcUrl: string; mediaType: 'image' | 'video'; retryOf?: string };
  const webRetries = new Map<string, WebRetry>();
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'retryWebSave') return false;
    const target = webRetries.get(message.token);
    if (!target || sender.tab?.id !== target.tabId || sender.tab?.url !== target.pageUrl || sender.frameId !== 0) {
      sendResponse({ ok: false, errorKind: 'origin-rejected' } satisfies SaveResponse);
      return false;
    }
    void saveRightClickedMedia(sender.tab, target.srcUrl, target.mediaType, message.token)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  });

  async function saveRightClickedMedia(tab, srcUrl: string, mediaType: 'image' | 'video', token: string = crypto.randomUUID()): Promise<void> {
    const tabId = tab.id;
    if (tabId == null) return;
    const target: WebRetry = webRetries.get(token) || { tabId, pageUrl: tab.url || '', srcUrl, mediaType };
    webRetries.set(token, target);
    // 終了した古い通知の再試行情報を無制限に保持しない。
    const oldestToken = webRetries.keys().next().value;
    if (webRetries.size > 100 && oldestToken) webRetries.delete(oldestToken);
    const noticeReady = chrome.scripting
      .executeScript({ target: { tabId }, files: ['save-notice.js'] })
      .then(() => chrome.tabs.sendMessage(tabId, { type: 'webSaveNotice', token, url: target.pageUrl }))
      .catch(() => {
        showInjectFailure(tabId, 'page-refused');
      });
    const notify = async (result: SaveResponse) => {
      await noticeReady;
      await chrome.tabs.sendMessage(tabId, { type: 'webSaveNotice', token, url: target.pageUrl, result }).catch(() => {});
    };
    const admitted = admitSave({ type: 'saveMedia', platform: 'web', postUrl: tab.url || '' }, tabId, getHostname(tab.url), [srcUrl], () => doSaveRightClickedMedia(tab, srcUrl, mediaType, target.retryOf));
    if (!admitted) {
      await notify({ ok: false, errorKind: 'busy' });
      return;
    }
    try {
      const result = await admitted;
      target.retryOf = result.captureId;
      await notify({ ...result, ok: true });
      if (result.metaOk && !result.mediaMissing) webRetries.delete(token);
    } catch (error: any) {
      // 不具合ではなく結果である失敗については warn にする＝
      // console.error は拡張機能のエラーコンソールに積み上がる
      // （#580）。
      console[saveFailureConsoleLevel(classifySaveFailure(error?.message))](error);
      logSaveFailure(error, { saveId: null, platform: 'web', host: getHostname(tab.url), url: tab.url || null });
      await notify({ ok: false, errorKind: classifySaveFailure(error?.message), queued: error?.queued });
    }
  }

  // #239: extension/entrypoints/read-meta.ts の報告を待ち、
  // sender.tab.id でこの呼び出しに対応付ける（1つのタブにつき進行中
  // のこの種の読み取りは常に1つだけ＝同じタブでの2回目の画像保存は、
  // 1回目が解決するまで始まれない。他のすべての保存経路の
  // タブごとの受理と同じだ）。listener は同期的に登録され、
  // executeScript もこの関数の最初の await より前に同期的に呼ぶ＝制
  // 御が呼び出し元へ戻る時点で listener はすでに生きている。これはテ
  // ストハーネスにとって重要だ（同じ onMessage の登録を通して応答を
  // 送り込むため）。
  function readPageMeta(tab): Promise<WebMetaResult> {
    let cleanup = () => {};
    const work = new Promise<WebMetaResult>((resolve, reject) => {
      const tabId = tab.id;
      function listener(message: PageMetaExtractedMessage, sender: chrome.runtime.MessageSender) {
        if (message?.type !== 'pageMetaExtracted' || sender.tab?.id !== tabId) return undefined;
        chrome.runtime.onMessage.removeListener(listener);
        resolve(message.result);
        return undefined;
      }
      chrome.runtime.onMessage.addListener(listener);
      cleanup = () => chrome.runtime.onMessage.removeListener(listener);
      chrome.scripting.executeScript({ target: { tabId }, files: ['read-meta.js'] }).catch((err) => {
        chrome.runtime.onMessage.removeListener(listener);
        reject(err);
      });
    });
    return withDeadline(work, METADATA_TIMEOUT_MS, 'page metadata').finally(() => cleanup());
  }

  // contextMenus.onClicked は画像 URL と媒体種別を返すが、alt は返さない。
  // クリック後に activeTab で同じ要素を探し、取得できる場合だけ補う。
  // 関数は注入先だけで完結し、モジュールの変数を参照しない。
  async function readSelectedMediaContext(tabId: number, srcUrl: string): Promise<{ alt: string | null }> {
    const rows = await chrome.scripting.executeScript({
      target: { tabId },
      args: [srcUrl],
      func: selectedMediaContextInPage,
    });
    const result = rows?.[0]?.result;
    return result && typeof result === 'object' ? result : { alt: null };
  }

  async function doSaveRightClickedMedia(tab, srcUrl: string, mediaType: 'image' | 'video', retryOf?: string) {
    const targetHost = await verificationHost(tab.id);
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('saveMedia', { saveId: null, captureId, platform: 'web', url: tab.url || null, tabId: tab.id ?? null });

    const selectedContextPromise = readSelectedMediaContext(tab.id as number, srcUrl).catch(() => ({ alt: null }));
    let meta: PostRecord;
    try {
      const webMeta = await readPageMeta(tab);
      meta = buildWebMeta(webMeta, tab.url || '');
    } catch {
      // 汎用メタデータの注入・解析が失敗しても、利用者が選んだ媒体と出典ページ URL は
      // 既に分かっている。媒体保存そのものを失敗させず、最小レコードへ退避する。
      meta = buildWebMeta({ title: tab.title || null, description: null, author: null, published: null, siteName: null, image: null, url: tab.url || '', metaSource: {}, acquisitionError: 'fetchFailed' }, tab.url || '');
    }
    const selectedContext = await selectedContextPromise;
    // 対象は右クリックされたメディアだけ。ページの OGP 画像で置き換えない。
    meta.media = [];
    meta.mediaType = mediaType;
    trace.passed('metadata');

    const postUrl = meta.url || tab.url || '';
    const metaOk = acquisitionComplete(meta, []);
    const record = buildRecord(meta, { captureId, capturedAt, postUrl, sendPlatform: null, extra: { retryOf, mediaType, media: [], source: 'web', saveIncomplete: !metaOk } });
    const request: SaveMediaRequest = { type: 'saveMedia', captureId, requestNonce: generateRequestNonce(), saveId: null, mediaUrl: srcUrl, mediaReferer: tab.url || null, mediaAlt: selectedContext.alt, mediaType, metadata: record, metaOk, metaReason: meta.metaError };

    // service worker が送信中に終了しても要求そのものを失わないよう、host
    // へ渡す前に耐久化する。削除するのは ack または明示拒否の後だけ。
    // 送信前から結果不明として記録する。postMessage直後にworkerが終了して
    // catchへ到達しない窓でも、旧hostへ無条件再送されないためである。
    const staged = await stashFailedSave(request, logCapture, targetHost, true, true);
    if (!staged) throw trace.fail('queue', 'Save queue is full; request was not sent');
    let ack: BridgeAck;
    try {
      ack = await bridgeSend(request, targetHost);
    } catch (err: any) {
      const failure = trace.fail('bridge', err?.message || 'bridge save failed');
      if (err?.delivery === 'rejected' && staged) await removeQueuedSave(request, targetHost).catch((cleanupError) => logCapture({ stage: 'queue', phase: 'fail', reason: 'cleanup', captureId, error: cleanupError?.message }, true));
      if (err?.delivery === 'unknown' && staged) await markQueuedSaveUnknown(request, targetHost).catch((cleanupError) => logCapture({ stage: 'queue', phase: 'fail', reason: 'cleanup', captureId, error: cleanupError?.message }, true));
      if (err?.delivery === 'not-sent' && staged) await markQueuedSaveNotSent(request, targetHost).catch((cleanupError) => logCapture({ stage: 'queue', phase: 'fail', reason: 'cleanup', captureId, error: cleanupError?.message }, true));
      failure.queued = err?.delivery === 'rejected' ? undefined : staged;
      throw failure;
    }
    if (staged) await removeQueuedSave(request, targetHost).catch((cleanupError) => logCapture({ stage: 'queue', phase: 'fail', reason: 'cleanup', captureId, error: cleanupError?.message }, true));
    trace.passed('bridge');
    if (!targetHost) markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id, 1, false);
    triggerQueueSweep();
    const savedCount = savedMediaUrls(ack).length;
    return { ...ack, captureId: ack?.captureId || captureId, metaOk, metaReason: meta.metaError || null, acquisitionIssues: meta.acquisitionIssues, mediaMissing: missingMediaCount(1, savedCount), savedContent: { text: !!meta.text, profile: !!meta.displayName, media: savedCount } };
  }

  // 一括取り込み（#362）: 投稿をパーマリンクだけから保存する。
  // プラットフォーム API が原本を持っているので、ページはどの投稿かを言うだけでよく、
  // host がメディアをダウンロードして最初の1枚をレコードの画像にす
  // る。キャプチャの経路のように notify を push するのではなく、結果
  // で答える（呼び出し元はそれに合わせて自分のペースを取る）。
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'savePost') return false;
    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' } satisfies SaveResponse);
      return false;
    }
    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' } satisfies SaveResponse);
      return false;
    }
    const senderHost = getHostname(sender.tab.url);
    const tabId = sender.tab.id;
    const tab = sender.tab;
    const admitted = admitSave(message, tabId, senderHost, message.mediaKeys ?? [], () => savePostByUrl(tab, message.platform, message.postUrl, message.capturedVia || null, message.saveId, message.domMeta || null, message.mediaKeys, message.retryOf));
    if (!admitted) {
      sendResponse({ ok: false, errorKind: 'busy', error: BUSY_ERROR } satisfies SaveResponse);
      return false;
    }
    admitted
      .then((result) => sendResponse({ ok: true, ...result } satisfies SaveResponse))
      .catch((error) => {
        const errorKind = classifySaveFailure(error?.message);
        // 不具合ではなく結果である失敗については warn にする＝
        // console.error は拡張機能のエラーコンソールに積み上がる
        // （#580）。
        console[saveFailureConsoleLevel(errorKind)](error);
        logSaveFailure(error, { saveId: message.saveId, platform: message.platform, host: senderHost, url: message.postUrl });
        sendResponse({ ok: false, errorKind, metaReason: error?.metaReason || null, error: error?.message, savedNothing: !message.retryOf && (error?.stage === 'metadata' || errorKind === 'post-unavailable') } satisfies SaveResponse);
      });
    return true; // 非同期の応答
  });

  async function savePostByUrl(tab, sendPlatform, postUrl, capturedVia, saveId: string | null = null, domMeta: DomMeta | null = null, mediaKeys?: string[], retryOf?: string) {
    const targetHost = await verificationHost(tab.id);
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('savePost', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');

    // API が扱わない項目と、埋め込み対象外の投稿を検証済みの DOM 情報で補う。
    const domFilled = mergeDomMeta(meta, domMeta);
    const metaOk = acquisitionComplete(meta, domFilled);

    // メディアを持たない投稿もそれでも保存する＝host はそのサイド
    // カーを書き込み、ライブラリは #365 が乗った時点でそれを表示する
    // （handleSavePost を参照）。代わりに失うと、それは取り返しがつ
    // かない: X にはブックマークのエクスポート機能がなく、後から戻っ
    // て取り直すことができない。
    const selectedMedia = selectPostMedia(meta.media || [], sendPlatform, mediaKeys);
    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      extra: { retryOf, saveScope: mediaKeys === undefined ? 'post' : 'media', saveIncomplete: !metaOk, mediaType: meta.mediaType, media: selectedMedia, imageCount: (meta.media || []).length > 1 ? meta.media.length : null, capturedVia, domFilled },
    });

    let ack: BridgeAck;
    try {
      ack = await sendPostToBridge(captureId, record, metaOk, meta.metaError || null, saveId, targetHost);
    } catch (err) {
      throw trace.fail('bridge', err?.message || 'bridge save failed', meta.metaError || null);
    }
    trace.passed('bridge');
    const imageCount = (meta.media || []).length || null;
    const savedCount = typeof ack?.mediaCount === 'number' ? ack.mediaCount : savedMediaUrls(ack).length;
    const mediaMissing = missingMediaCount(selectedMedia.length, savedCount);
    const postComplete = mediaKeys === undefined && mediaMissing === 0 && metaOk;
    if (!targetHost) markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id, imageCount, postComplete, mediaKeys === undefined ? [] : savedMediaUrls(ack).filter((url): url is string => !!url));
    // ついで掃き出し (#203).
    triggerQueueSweep();
    return {
      ...ack,
      captureId: ack?.captureId || captureId,
      metaOk,
      metaReason: meta.metaError || null,
      domFilled,
      acquisitionIssues: meta.acquisitionIssues,
      savedContent: { text: !!meta.text, profile: !!meta.displayName, media: savedCount },
      hostSkew: await skewNoteForBanner(),
      mediaMissing,
      imageCount,
      post: postComplete,
      individualMedia: mediaKeys === undefined ? [] : savedMediaUrls(ack).filter((url): url is string => !!url),
    };
  }

  // --- プロトコルバージョンの取り決め（#205） ----------------------------------------
  // 両側が同じ世代であることは前提であって保証ではない: 拡張機能は
  // Chrome Web Store を通して更新され、host はデスクトップアプリ自身
  // のアップデータを通して更新される。だからリリース後は「どちらかが
  // 遅れている」のが偶発事故ではなく通常の状態だ。すべての host の応
  // 答は、それがビルドされたときの契約バージョン
  // （native-host/protocol.mts）を運び、ここでそれをこのバンドルがビ
  // ルドされたバージョンと比較する。
  //
  // この結果に何もゲートされていない。ずれは保存を拒否せず、再試行も
  // せず、送る欄を変えることもなく、以下のどのコードもどのバージョン
  // が答えたか尋ねない＝保存は常にそうしてきたとおりに試み、結果には
  // どちら側を更新すべきかという注記が乗るだけだ。番号が一致しなかっ
  // たせいで投稿を失うこと。このチェックが防ごうとしているのはそれで
  // あって、それを引き起こすことではない。
  //
  // 保管するのではなく worker 上で覚える: 欄1つ分のコストで済み、再
  // 起動した worker はまさに次の応答からそれを学び直す。古くなった答
  // えは、答えがないよりも悪い（ユーザーがたった今行った更新をまだし
  // ろと言い続けることになる）。
  let hostSkew: ProtocolSkew | null = null; // まだどの host も答えていない間は null

  function noteHostProtocol(version: number | null): void {
    hostSkew = protocolSkewOf(version);
  }

  // 保存の結果が、両側の組み合わせについて何を言うべきか。言うことが
  // 何もなければ null。`null` は両側が一致している場合とまだどの
  // host も答えていない場合の両方をカバーする＝host に一度も届かな
  // かった保存には、それ自身のもっと良いメッセージがある。
  function skewNote(): ProtocolSkew | null {
    return hostSkew && hostSkew !== 'match' ? hostSkew : null;
  }

  // 同じ注記だが、ブラウザのセッションにつき1回だけ（#124）。ずれは
  // 保存ごとの失敗ではなくインストール状態なので、毎回繰り返さない。
  //
  // chrome.storage.session ＝上のグルーピングのヒントと同じ寿命
  // （と同じストア）だ: ブラウザが閉じるまで残り、ずれを直した更新よ
  // り長生きしてはいけない。
  const SKEW_NOTIFIED_KEY = 'skewNotified';

  async function skewNoteForBanner(): Promise<ProtocolSkew | null> {
    const skew = skewNote();
    if (!skew) return null;
    try {
      const got = await chrome.storage.session.get(SKEW_NOTIFIED_KEY);
      if (got?.[SKEW_NOTIFIED_KEY]) return null;
      await chrome.storage.session.set({ [SKEW_NOTIFIED_KEY]: true });
    } catch {
      // storage に届かない: それでも言う。この注記を繰り返してしまう
      // のは回復可能な間違いだが、飲み込んでしまうと不一致な組み合わ
      // せを沈黙させたままにしてしまう。
    }
    return skew;
  }

  // native messaging host（ユーザーの保存フォルダへサイドカー＋画像
  // を書き込む）へメッセージを送り、その ack で解決する。host は短命
  // だ: Chrome は接続ごとにそれを起動するので、デスクトップアプリが
  // 動いていなくてもこれは動く。
  // save-queue.ts が「未送信」「送信後の結果不明」「host の明示拒否」を
  // 区別できるよう、エラーに印を付ける（#203）。これは文
  // 字列の一致ではなく機構の印だ＝意図してこうしている。再試行の対象
  // にするかどうかの判定が、native-error.ts 自身の狭く Chrome の文言
  // 変更に対して壊れやすい分類を絶対に引き継がないように。
  function deliveryError(message: string, delivery: 'not-sent' | 'unknown' | 'rejected'): Error {
    return Object.assign(new Error(message), { delivery });
  }

  async function bridgeSend(message: HostRequest, targetHost?: string): Promise<BridgeAck> {
    const nativeHost = targetHost ?? (await getNativeHost());
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let port: chrome.runtime.Port | null = null;

      function finish(error: Error | null, result?: any) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        try {
          port?.disconnect();
        } catch {
          /* すでに切断済み */
        }
        if (error) reject(error);
        else resolve(result);
      }

      try {
        port = chrome.runtime.connectNative(nativeHost);
      } catch (error: any) {
        reject(deliveryError(`Native host unavailable: ${error?.message || error}`, 'not-sent'));
        return;
      }

      timer = setTimeout(() => finish(deliveryError('Native host timed out', 'unknown')), NATIVE_HOST_TIMEOUT_MS);

      // 呼び出し元それぞれが持つ「応答とはどういうものか」という考え
      // ではなく、共有された契約を通して読む（#400）: これ以前は、
      // 「うまくいったか」と「これは誰への答えか」は、ここと下の問い
      // 合わせ用ポートの両方で、それぞれ少しずつ違う言葉で2回答えら
      // れていた。
      port.onMessage.addListener((msg) => {
        const res = readHostResponse(msg);
        // 失敗も含めて、すべての応答から読み取る（#205）: 保存を拒否
        // するほど遅れている host こそ、そのバージョンが最も重要にな
        // る相手だ。
        noteHostProtocol(res.protocolVersion);
        // 同じ理由で、違うスタンプ: ディスク上にあるローカルビルドが
        // どれか（#650）。
        noteHostBuild(res.extBuild);
        // 結果不明にはしない: host は実際に答えた。た
        // だ拒否しただけだ（#492 の post-unavailable など）＝
        // save-queue.ts は、繰り返すだけになる答えを絶対に再試行して
        // はいけない（#203）。
        if (res.ok) finish(null, res.ack);
        else finish(deliveryError(res.error, res.code === 'request-in-progress' ? 'unknown' : 'rejected'));
      });

      port.onDisconnect.addListener(() => {
        finish(deliveryError(chrome.runtime.lastError?.message || 'Native host disconnected (is it installed?)', 'unknown'));
      });

      try {
        port.postMessage(message);
      } catch (error: any) {
        finish(deliveryError(`Native host post failed: ${error?.message || error}`, 'not-sent'));
      }
    });
  }

  // 投稿単位の保存要求。host が投稿の全メディアをダウンロードする。
  // この要求は一覧取り込みにもホバーボタンにも使い、再試行キューには
  // 入れない。
  function sendPostToBridge(captureId: string, record: CaptureMetadata, metaOk: boolean, metaReason: string | null, saveId: string | null, targetHost?: string) {
    return bridgeSend({ type: 'savePost', captureId, requestNonce: generateRequestNonce(), saveId, metadata: record, metaOk, metaReason }, targetHost);
  }

  // host が実際にその保存のために記録したと言う画像（位置ベース。
  // markSaved を参照）。告知されたがダウンロードされなかったメディア
  // は意図して数えない: バッジは後の問い合わせが答えるものと一致しな
  // ければならず、host は自分が書いたものから答える。
  function savedMediaUrls(ack: BridgeAck | undefined): Array<string | null> {
    return Array.isArray(ack?.media) ? ack.media.map((u: unknown) => (typeof u === 'string' && u ? u : null)) : [];
  }

  // --- 「すでに保存済みか」の問い合わせ（タイムラインバッジ、#54） ---------------------------------
  // badge.js は、見えているパーマリンクがすでにライブラリにあるか尋
  // ねる。答えは native host（ライブラリの索引を読む＝デスクトップア
  // プリを閉じていても動く）から、開いたままのポートを通して来る:
  // タイムラインのスクロールは1秒に数回尋ねるし、connectNative は接
  // 続ごとに新しい host のプロセスを生むので、保存1件ごとの単発の形
  // だと問い合わせのたびにプロセスをフォークしてしまう。
  //
  // ポートは1つ、進行中の要求は多数: それぞれが host がそのまま返す
  // id を運ぶ。service worker はどのアイドル時点でも殺されうるし、
  // ポートも道連れになる＝それでよい、次の問い合わせが再接続する
  // （そして殺された SW には、どのみち最新に保つべきバッジがない）。
  let queryPort: chrome.runtime.Port | null = null;
  let queryPortHost: string | null = null;
  let nextQueryId = 1;
  const pendingQueries = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  function failAllPending(message: string) {
    for (const [, p] of pendingQueries) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pendingQueries.clear();
  }

  async function getQueryPort(): Promise<chrome.runtime.Port> {
    const nativeHost = await getNativeHost();
    if (queryPort && queryPortHost === nativeHost) return queryPort;
    if (queryPort) {
      try {
        queryPort.disconnect();
      } catch {
        /* すでに切断済み */
      }
      queryPort = null;
    }
    const port = chrome.runtime.connectNative(nativeHost);
    queryPort = port;
    queryPortHost = nativeHost;
    port.onMessage.addListener((msg: unknown) => {
      const id = responseId(msg);
      const p = id == null ? null : pendingQueries.get(id);
      if (p == null || id == null) return; // タイムアウトした要求への遅れた返信＝決着させるものは何もない
      pendingQueries.delete(id);
      clearTimeout(p.timer);
      p.resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      if (queryPort === port) {
        queryPort = null;
        queryPortHost = null;
      }
      failAllPending(chrome.runtime.lastError?.message || 'Native host disconnected');
    });
    return port;
  }

  // host へ URL のバッチについて尋ねる。host に届かないときは
  // （「未保存」と答えるのではなく）reject する。それによって、host
  // がいないとき、保存済みの投稿を未保存だと主張するのではなく、バッ
  // ジを一切表示しないようにする。
  //
  // host の応答の両半分に答える（#158）: 何が保存済みか、そして何が
  // ライブラリのゴミ箱にあるか。`trashed` はまばら（該当する url だ
  // け）で、それが存在する前にビルドされた host からは空になる。
  async function queryBridge(urls: string[], requestIds: string[] = []): Promise<{ results: SavedResults; trashed: TrashedResults; requests: Record<string, import('../../native-host/protocol.mts').RequestReceipt>; receiptCapable: boolean }> {
    let port: chrome.runtime.Port;
    try {
      port = await getQueryPort();
    } catch (error: any) {
      throw new Error(`Native host unavailable: ${error?.message || error}`);
    }
    return new Promise((resolve, reject) => {
      const id = nextQueryId++;
      const timer = setTimeout(() => {
        pendingQueries.delete(id);
        reject(new Error('Native host timed out'));
      }, SAVED_QUERY_TIMEOUT_MS);
      // ok:false と答えた host は、reject ではなく「何も分からな
      // い」でバッジに答える: この問い合わせは任意で、呼び出し元はす
      // でに空の結果を「これらの投稿には印を付けない」として扱ってい
      // る。
      pendingQueries.set(id, {
        resolve: (msg) => {
          const res = readHostResponse(msg);
          // バッジのポートは、しばしば host に届く最初のもの（タイム
          // ラインは何かが保存される前に尋ねる）なので、通常はここで
          // ずれに気付く＝最初の保存のバナーがそれを言えるだけの余裕
          // を持って。
          noteHostProtocol(res.protocolVersion);
          // …そして同じ理由で、新しいローカルビルドの最速の運び手で
          // もある（#650）: このポートはブラウジングのセッション全体
          // にわたって開いたままだ。
          noteHostBuild(res.extBuild);
          resolve(res.ok ? { results: res.ack.results || {}, trashed: res.ack.trashed || {}, requests: res.ack.requests || {}, receiptCapable: (res.protocolVersion || 0) >= 5 } : { results: {}, trashed: {}, requests: {}, receiptCapable: false });
        },
        reject,
        timer,
      });
      try {
        port.postMessage({ type: 'query', id, urls, requestIds } satisfies HostRequest);
      } catch (error: any) {
        pendingQueries.delete(id);
        clearTimeout(timer);
        queryPort = null;
        queryPortHost = null;
        reject(new Error(`Native host unavailable: ${error?.message || error}`));
      }
    });
  }

  // --- 再試行キュー（#203 — 保管庫の形式と退避/追い出し/degrade の
  // ルールは save-queue.ts が持つ。ここは配線だけ） ---------------
  //
  // queryBridge の上に組み立てた単一 URL の問い合わせ。
  // save-queue.ts のべき等性チェック（#34 はすでに乗っている）のた
  // め: バッジのキャッシュではなく新しい読み取り＝キューに座っている
  // エントリこそ、1分前のネガティブな答えが間違っている可能性がある
  // ケースそのものだ。
  function queryForResend(url: string, requestId: string) {
    return queryBridge([url], [requestId]).then((r) => ({ saved: r.results[url] ?? null, receipt: r.requests[requestId] ?? null, receiptCapable: r.receiptCapable }));
  }

  // 以下のすべての引き金から fire-and-forget で呼ぶ: sweep 自身のエ
  // ラーは sweepSaveQueue の中ですでに処理されている（失敗した送信は
  // `tries` を更新してその回を止める＝ここで反応すべきことは何もな
  // い）ので、これはすべての呼び出し箇所から `.catch(() => {})` を締
  // め出すためだけに存在する。
  function triggerQueueSweep(): void {
    void sweepSaveQueue({ send: bridgeSend, query: queryForResend, log: logCapture }).catch(() => {});
  }

  // 拡張機能の更新・ブラウザの復元より前に開かれていた対応ページへ、現行世代の
  // 常駐スクリプトを戻す。manifest の content_scripts はページを開く時点でしか
  // 注入されないため、ここが無いと更新後の既存タブではホバー保存だけが消え、
  // activeTab で都度注入する右クリックからの一括取り込みだけが動く。
  //
  // resident.content.ts の owner は再注入を世代交代として扱うので、ページ読込と
  // 競合しても二重のオーバーレイや listener を残さない。
  async function rehydrateResidentTabs(): Promise<void> {
    let tabs: chrome.tabs.Tab[];
    try {
      tabs = await chrome.tabs.query({ url: RESIDENT_MATCHES });
    } catch (error) {
      console.warn('[hologram] failed to find tabs that need resident rehydration:', error);
      return;
    }

    await Promise.all(
      tabs.flatMap((tab) =>
        tab.id == null
          ? []
          : [
              chrome.scripting
                .executeScript({
                  target: { tabId: tab.id },
                  files: ['content-scripts/resident.js'],
                })
                .catch((error) => {
                  // タブは query と executeScript の間にも遷移・終了できる。個々のタブの
                  // 競合で、残りの既存タブを復旧し損ねてはいけない。
                  console.warn(`[hologram] failed to rehydrate resident script in tab ${tab.id}:`, error);
                }),
            ],
      ),
    );
  }

  // 引き金（#203 設計コメント #4）: Chrome の再起動、インストール・
  // 更新、保存が成功した直後、そして保存済みバッジの問い合わせポート
  // が答えた直後の瞬間（下の checkSaved ハンドラ）＝service worker が
  // 単に起動しただけでは絶対に引き金にならない。バッジの問い合わせは
  // それ自体、数秒おきに起動を引き起こすから。
  //
  // `?.`: onStartup/onInstalled は本物の Chrome ではマニフェストの
  // permission を必要とせず、そこでは常に存在する。このガードは、ど
  // ちらもモデル化していないこのテストスイート自身の chrome のスタブ
  // のためだけにある（background-wiring.test.ts）。
  chrome.runtime.onStartup?.addListener(() => {
    triggerQueueSweep();
    void rehydrateResidentTabs();
  });
  chrome.runtime.onInstalled?.addListener(() => {
    triggerQueueSweep();
    void rehydrateResidentTabs();
  });

  // すでに分かっている答え＝だから投稿の上をスクロールで戻ってもコス
  // トはかからない。どちらの答えも期限切れになる。「未保存」は、ユー
  // ザーがその投稿を保存した瞬間に古くなり（ここで行われた保存はエン
  // トリを直接更新する。markSaved を参照）、「保存済み」は、デスク
  // トップアプリでそれを削除したときに古くなるが、こちら側はそれを
  // 一切見ない。以前は肯定的な答えを worker の寿命の間ずっと保持して
  // いたので、削除された投稿は service worker が再起動するまでバッジ
  // を保ち続けていた＝さらに悪いことに、一括取り込みも同じキャッシュ
  // を通して尋ねるので、ユーザーがたった今削除してもう一度取り込むつ
  // もりだった投稿をスキップしてしまっていた。尋ね直すのは安上がり
  // だ: host はメモリ上に保つ索引から答え、それは保存フォルダ自身の
  // mtime によって無効化されるので、host はすでに削除を見ている。
  // host の答えの両半分を一緒にキャッシュする（#158）: それらは1回の
  // 往復から来るし、ゴミ箱の通知は「保存済み」が古くなるのとまさに同
  // じ出来事（投稿が復元される、ゴミ箱が空になる、レコードの期限が切
  // れる）で古くなる。
  const SAVED_TTL_MS = 60_000;
  const SAVED_CACHE_MAX = 2000;
  interface CachedAnswer {
    entry: SavedEntry | null;
    trashed: TrashedEntry | null;
  }
  const savedCache = new Map<string, CachedAnswer & { until: number }>();

  function cacheGet(url: string): CachedAnswer | undefined {
    const hit = savedCache.get(url);
    if (!hit) return undefined;
    if (hit.until && hit.until < Date.now()) {
      savedCache.delete(url);
      return undefined;
    }
    return hit;
  }

  function cacheSet(url: string, entry: SavedEntry | null, trashed: TrashedEntry | null = null) {
    savedCache.delete(url); // Map の反復順が LRU に近づくよう入れ直す
    savedCache.set(url, { entry, trashed, until: Date.now() + SAVED_TTL_MS });
    if (savedCache.size > SAVED_CACHE_MAX) {
      for (const k of [...savedCache.keys()].slice(0, savedCache.size - SAVED_CACHE_MAX)) savedCache.delete(k);
    }
  }

  // 保存がたった今着地した: その投稿のバッジは、ネガティブなエントリ
  // が期限切れになるのを待たず今表示されなければならない。保存した
  // タブには直接伝える＝他のタブは自分のネガティブなエントリが期限切
  // れになったときに追いつく。
  //
  // `media` は host が「記録した」と報告するものであって、告知された
  // ものではない: 複数画像の投稿の1枚を保存した後も、他の画像は保存
  // ボタンを提示し続けなければならない（#334）。「投稿全体」として
  // （すべてのボタンを隠す形として）キャッシュすると、それを1分間だ
  // け元に戻してしまう。すでにキャッシュされているエントリとマージす
  // る。同じ投稿の以前の保存が別の画像を記録しているかもしれないから
  // だ。
  //
  // 両方の url の形に印を付ける: レコードの url はプラットフォーム
  // API から、ページのパーマリンクは DOM から来て、同じ投稿でもこの
  // 2つの綴りが違うことがある（host はそれらを1つのキーへ正規化する
  // が、こちら側は意図してそうしない。native-host/post-key.mts を参
  // 照）。片方の形だけキャッシュすると、もう片方のネガティブなエント
  // リは自然に期限切れになるまで残り、バッジはユーザーの目の前で起き
  // たばかりの保存に1分遅れることになる。
  // ack の `file` ではなく captureId: この2つは異なり（一括取り込み
  // の経路の file は id を一切運ばないメディアのファイル名だ）、
  // #34 以降この値は識別子として読まれる＝「replace」の答えは、引退
  // させるキャプチャをこれで名指しする。
  function markSaved(urls: Array<string | null | undefined>, captureId: string | null, media: Array<string | null>, tabId?: number, total: number | null = null, post = true, individualMedia = post ? [] : media.filter((url): url is string => !!url)) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const known = cacheGet(url)?.entry;
      const merged: SavedEntry = known
        ? { id: known.id || captureId || '', media: known.media.slice(), owners: (known.owners || known.media.map(() => known.id || null)).slice(), total: Math.max(known.total || 0, total || 0) || null }
        : { id: captureId || '', media: [] as Array<string | null>, owners: [] as Array<string | null>, total };
      merged.post = known?.post === true || post;
      merged.individualMedia = [...new Set([...(known?.individualMedia ?? []), ...individualMedia])];
      // すでに「投稿全体」と答えたエントリはそのままにする: 空の一覧
      // に画像を1枚加えると、残りは未保存だと主張してしまうことにな
      // る。
      if (!known || known.media.length) {
        for (const u of media) {
          if (!u || merged.media.includes(u)) continue;
          merged.media.push(u);
          merged.owners?.push(captureId || null); // この保存がこの画像を書いた
        }
      }
      // ゴミ箱の通知は同じ投稿の保存を生き延びない（#158）: ゴミ箱に
      // 何があろうと、この投稿は今やライブラリにあり、答えは「保存済
      // み」だ。
      cacheSet(url, merged, null);
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'savedUpdate', url, media, total, post, individualMedia } satisfies SavedUpdateMessage).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, _sender, sendResponse) => {
    if (message.type !== 'checkSaved') return false;
    // 検証タブは通常ライブラリのキャッシュと常駐ポートを共有しない。
    void verificationHost(_sender.tab?.id)
      .then(async (targetHost) => {
        if (targetHost) {
          const ack = await bridgeSend({ type: 'query', id: 1, urls: message.urls }, targetHost);
          sendResponse({ ok: true, results: ack.results || {} });
          void sweepSaveQueue(
            {
              send: (request) => bridgeSend(request, targetHost),
              query: async (url, requestId) => {
                const ack = await bridgeSend({ type: 'query', id: 1, urls: [url], requestIds: [requestId] }, targetHost);
                return { saved: ack.results?.[url] ?? null, receipt: ack.requests?.[requestId] ?? null, receiptCapable: typeof ack.protocolVersion === 'number' && ack.protocolVersion >= 5 };
              },
              log: logCapture,
            },
            targetHost,
          ).catch(() => {});
          return;
        }
        const urls: string[] = Array.isArray(message.urls) ? message.urls.filter((u) => typeof u === 'string' && u) : [];
        const results: SavedResults = {};
        const ask: string[] = [];
        for (const u of urls) {
          const hit = cacheGet(u);
          if (hit) results[u] = hit.entry;
          else ask.push(u);
        }
        if (!ask.length) {
          sendResponse({ ok: true, results } satisfies CheckSavedResponse);
          return false;
        }
        queryBridge(ask)
          .then((fresh) => {
            for (const u of ask) {
              const entry = (Object.hasOwn(fresh.results, u) ? fresh.results[u] : null) || null;
              // バッジはゴミ箱の通知を描かない（「これは保存済みか」を尋
              // ねるだけだ）が、答えはキャッシュしておくので、重複チェッ
              // クはタイムラインがたった今見た投稿についてもう一度尋ねな
              // くて済む。
              cacheSet(u, entry, (Object.hasOwn(fresh.trashed, u) ? fresh.trashed[u] : null) || null);
              results[u] = entry;
            }
            sendResponse({ ok: true, results } satisfies CheckSavedResponse);
            // 引き金4（#203 設計コメント #4）: この問い合わせポートは、
            // 自前の接続コストなしに host が今まさに答えることを証明し
            // た＝このポートはすでに開いていて、タイムラインが画面にある
            // 間、独自のスケジュールで尋ね続けている。sweepSaveQueue 自
            // 体は、現在の host 向けにキューに入ったものが何もないと分か
            // れば即座に何もしない。
            triggerQueueSweep();
          })
          // host に届かない → 「未保存」だらけのページの代わりに失敗を報
          // 告する: badge.js はそれらの投稿に印を付けないままにし、後で
          // 再試行する。
          .catch((error) => sendResponse({ ok: false, error: error?.message, results } satisfies CheckSavedResponse));
      })
      .catch((error) => sendResponse({ ok: false, error: error.message, results: {} }));
    return true; // 非同期の応答
  });

  // できる範囲での診断: native host の capture.log にキャプチャの出
  // 来事を1行追加し、壊れた保存を後でディスクから診断できるようにす
  // る。自前の短命な native 接続を使う＝保存に相乗りはしない
  // （bridgeSend は最初の応答で終わるが、ブリッジより手前の失敗には
  // 保存用の接続がそもそもない）。絶対に例外を投げず保存を絶対にブ
  // ロックしない: host に届かない場合（例えば未登録＝それ自体記録す
  // る価値がある）、エントリは {type:'dumpLogs'} が読み返せる
  // chrome.storage のリングバッファへフォールバックする。
  //
  // 同時に接続は1つだけ、しかもクールダウンにつき1回まで（#323）。
  // Chrome は接続ごとに host のプロセスを起動するので、接続1回につき
  // 1行のログは、繰り返し行を生むあらゆる原因をプロセスを生む原因に
  // 変えてしまう＝これが #323 の合成クリックが、何も保存しないままプ
  // ロセスを生み出していた仕組みだ。flush が開いている間に書かれた行
  // は次の flush に乗って出ていき、キューには上限がある: それを超え
  // ると、行はローカルのリングバッファだけへ行く。だからログはエント
  // リを落とすことはあっても、詰まった worker のメモリやプロセス数を
  // 増やすことは絶対にない。
  //
  // このクールダウンが、flush を立ち上がりエッジにしている理由だ＝静
  // かな期間の後の最初の行は即座に出ていく。#519 の `save`/`begin` の
  // 行は、それに続く待機が止まる前にディスクへ届かなければならず、そ
  // れを抑えるデバウンスは、ループでしか到達しないケースを遅くするた
  // めに、すべての保存からそれを奪ってしまう。
  const LOG_COOLDOWN_MS = 1000;
  const LOG_HOST_TIMEOUT_MS = 4000;
  const LOG_QUEUE_MAX = 100;
  interface QueuedLog {
    entry: SaveLogEntry & { ts: string };
    // すでにリングバッファにある（`fail` の行は、何かを試みる前に退
    // 避される）ので、失敗した flush はそれを2回目退避してはいけな
    // い。
    stashed: boolean;
  }
  let logQueue: QueuedLog[] = [];
  let logFlushing = false;
  let logFlushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastLogFlushAt = Number.NEGATIVE_INFINITY;

  function logCapture(entry: SaveLogEntry, keepLocal = false): void {
    const full = Object.assign({ ts: new Date().toISOString() }, entry);
    if (keepLocal) stashLogLocally(full);
    if (logQueue.length >= LOG_QUEUE_MAX) {
      if (!keepLocal) stashLogLocally(full); // ログからは落ちるが、ディスク上には保つ
      return;
    }
    // 同期的な push が診断の順序そのもの。flush 中でも activate/begin と、
    // executeScript 内から届く bulk/begin はこの FIFO にその順で入り、先行
    // host の ack/timeout を待たずに利用者の注入処理を開始できる。
    logQueue.push({ entry: full, stashed: keepLocal });
    scheduleLogFlush();
  }

  function scheduleLogFlush() {
    if (logFlushing || logFlushTimer !== null || !logQueue.length) return;
    const wait = Math.max(0, lastLogFlushAt + LOG_COOLDOWN_MS - Date.now());
    if (!wait) {
      flushLog();
      return;
    }
    logFlushTimer = setTimeout(() => {
      logFlushTimer = null;
      flushLog();
    }, wait);
  }

  async function flushLog() {
    if (logFlushing || !logQueue.length) return;
    const batch = logQueue;
    logQueue = [];
    logFlushing = true;
    lastLogFlushAt = Date.now();

    let settled = false;
    let acked = 0; // 受け取った応答の数 = この host が受理した行数
    let port: chrome.runtime.Port | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        port?.disconnect();
      } catch {
        /* すでに消えている */
      }
      // host が受理しなかったものは、capture.log に一切届いていない。
      for (const queued of batch.slice(acked)) {
        if (!queued.stashed) stashLogLocally(queued.entry);
      }
      logFlushing = false;
      // クールダウンは flush の終わりから数える: 応答に4秒かかった
      // host に、答えたその瞬間に再度尋ねてはいけない。
      lastLogFlushAt = Date.now();
      scheduleLogFlush(); // この接続が開いている間に書かれたもの
    };

    timer = setTimeout(done, LOG_HOST_TIMEOUT_MS);
    try {
      port = chrome.runtime.connectNative(await getNativeHost());
    } catch {
      done();
      return;
    }
    port.onMessage.addListener((msg: unknown) => {
      acked++;
      // これらの ack もローカルビルドのスタンプを運んでいて（#650）、
      // 誰も保存していないページで起きる唯一の往復だ＝`activate` の
      // 行は UI が求められた瞬間に出ていく。
      noteHostBuild(hostExtBuild(msg));
      if (acked >= batch.length) done();
    });
    port.onDisconnect.addListener(done);
    try {
      // host は自分の stdin をループで読み、区切られたメッセージそれ
      // ぞれに答えるので、1つの接続でバッチ全体を運べる
      // （native-host/bridge.mts）。
      for (const queued of batch) port.postMessage({ type: 'log', entry: queued.entry } satisfies HostRequest);
    } catch {
      done();
    }
  }

  // host に届かなかったエントリのためのリングバッファ。エントリごと
  // に1キー（追記専用＝同時に走るキャプチャの間で read-modify-write
  // が競合することはない）。キーの中の ISO 形式の ts によって、文字
  // 列としてのソートがそのまま時系列順になるので、切り詰めは常に一番
  // 古いものを落とす。
  function stashLogLocally(entry) {
    try {
      const key = `${DIAG_PREFIX}${entry.ts}_${Math.floor(Math.random() * 1e6)}`;
      chrome.storage.local.set({ [key]: entry }, () => {
        void chrome.runtime.lastError; // クォータなど set のエラーは無視する
        chrome.storage.local.get(null, (all) => {
          if (chrome.runtime.lastError) return;
          const keys = Object.keys(all)
            .filter((k) => k.startsWith(DIAG_PREFIX))
            .sort();
          if (keys.length > DIAG_KEEP) chrome.storage.local.remove(keys.slice(0, keys.length - DIAG_KEEP));
        });
      });
    } catch {
      /* 無視する＝診断情報は必須ではない */
    }
  }

  // そうしなければ chrome://extensions のエラーコンソールだけが持つ
  // ことになるもの（#727）。keepLocal: キャッチされない例外は、まさ
  // に host こそが壊れているものかもしれない状況だ。オリジンでの絞り
  // 込みはない＝この worker で動くものはすべて拡張機能自身のものだ。
  // テストは service worker のグローバルが存在しない場所でこのクロー
  // ジャを実行するので、ガードしてある。
  if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
    installUncaughtReporting(self, (entry) => logCapture(entry, true), { context: 'background' });
  }

  // 診断の中継。content.js はブリッジより手前の段階の失敗
  // （select / permalink）をここへ報告する。{type:'dumpLogs'} は
  // ローカルのフォールバック用リングバッファ（host の capture.log に
  // 一度も届かなかったエントリ）を読み返す。
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type === 'logCapture') {
      const entry = Object.assign({ host: getHostname(sender.tab?.url) }, message.entry || {});
      noteLocalBuildReloadActivity(sender.tab?.id ?? null, entry.stage, entry.phase);
      logCapture(entry, entry.phase === 'fail');
      sendResponse({ ok: true } satisfies LogCaptureResponse);
      return false;
    }
    if (message.type === 'dumpLogs') {
      chrome.storage.local.get(null, (all) => {
        const entries = Object.keys(all)
          .filter((k) => k.startsWith(DIAG_PREFIX))
          .sort()
          .map((k) => all[k]);
        sendResponse({ ok: true, entries } satisfies DumpLogsResponse);
      });
      return true; // async
    }
    // #203: 診断ページの、再試行キューの読み取り専用の棚卸し＝掃除は
    // しないので、ページを読み込むこと自体が connectNative の試行を
    // 引き起こすことは絶対にない（それを行う方は下の resendQueue を
    // 参照）。
    if (message.type === 'queueStats') {
      saveQueueStats().then((stats) => sendResponse({ ok: true, stats } satisfies QueueStatsResponse));
      return true; // 非同期
    }
    // #203: 診断ページの「今すぐ再送」ボタン＝今すぐ掃除を1回実行し
    // （自身のエラーは triggerQueueSweep の呼び出し元が受け入れるの
    // と同じやり方で飲み込む）、その後のキューの見た目で答える。
    if (message.type === 'resendQueue') {
      sweepSaveQueue({ send: bridgeSend, query: queryForResend, log: logCapture })
        .catch(() => {})
        .then(() => saveQueueStats())
        .then((stats) => sendResponse({ ok: true, stats } satisfies ResendQueueResponse));
      return true; // 非同期
    }
    return false;
  });
}

// 保存経路が共有するレコードを組み立てる。
function buildRecord(meta, { capturedAt, postUrl, sendPlatform, replaces, extra }: { captureId: string; capturedAt: string; postUrl: string; sendPlatform: string | null; replaces?: string | null; extra: Record<string, unknown> }): CaptureMetadata {
  return CaptureMetadataSchema.parse({
    ...meta,
    url: meta.url ?? postUrl,
    platform: meta.platform ?? sendPlatform ?? null,
    capturedAt,
    updatedAt: capturedAt,
    replaces: replaces ?? null,
    ...extra,
  });
}

function generateCaptureId() {
  // v4 host のcaptureId上限（8 hex）を保つ。要求の高entropy identityは
  // 別欄requestNonceが担い、hostはpayload hashと併せて衝突を拒否する。
  return `${Date.now()}-${generateRequestNonce().slice(0, 8)}`;
}

function generateRequestNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function missingMediaCount(requestedCount: number, savedCount: number): number {
  return Math.max(0, requestedCount - savedCount);
}

// chrome.* / DOM への依存を持たない純粋なヘルパーで、直接のユニット
// テスト（extension/utils/background-unit.test.ts）のために export してあ
// る＝このファイルの残りは startBackground() を通して拡張機能の
// service worker の中でしか動かない。
export { isAllowedSender, missingMediaCount, buildRecord, generateCaptureId };

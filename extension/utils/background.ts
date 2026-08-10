// どのサイトが存在するか、そしてそれらについてのプラットフォーム固有
// のことはすべて extractor の登録簿（utils/extractor/）から来る＝この
// ファイルは自前のプラットフォームごとの分岐を一切持たない（#212）。
// native messaging の契約は、これらのメッセージを読む host と共有し
// ている（#400 — native-host/protocol.mts）。ここで組み立てる保存要
// 求は、ブリッジのパースが生み出すのと同じ宣言なので、欄の改名や欠落
// はディスク上で失敗する保存ではなく、こちら側のコンパイルエラーにな
// る。
import { hostExtBuild, protocolSkewOf, readHostResponse, responseId } from '../../native-host/protocol.mts';
import type { CaptureMetadata, HostRequest, ProtocolSkew, SaveDraggedRequest, SaveRequest, SavedResults, TrashedEntry, TrashedResults } from '../../native-host/protocol.mts';
import { CROP_TIMEOUT_MS, METADATA_TIMEOUT_MS, NATIVE_HOST_TIMEOUT_MS, SAVED_QUERY_TIMEOUT_MS, withDeadline } from './deadline.ts';
import { NATIVE_HOST } from './native-host.ts';
import { DEV_RELOAD_QUIET_MS, DEV_RELOAD_STATE_KEY, DEV_RELOAD_WORK_MS, EXT_BUILD_ID, bulkActivity, captureActivity, createDevReloadGate, shouldReloadFor } from './dev-reload.ts';
import type { DevReloadState } from './dev-reload.ts';
import { buildWebMeta } from './extractor/web-meta.ts';
import type { WebMetaResult } from './extractor/web-meta.ts';
import { mergeDomMeta } from './extractor/dom-meta.ts';
import { extractorFor, fetchPostMetadata, getHostname, highResUrlOf, isAllowedSender, mediaKeyOf, RESIDENT_MATCHES } from './extractor/index.ts';
import type { DomMeta, PostRecord } from './extractor/types.ts';
import type {
  BridgeAck,
  CaptureAndSendResponse,
  CheckBulkCapturePageMessage,
  CheckSavedResponse,
  ContentToBackgroundMessage,
  CropImageMessage,
  CropImageResponse,
  DumpLogsResponse,
  LogCaptureResponse,
  NotifyMessage,
  PageMetaExtractedMessage,
  PopupActivateResponse,
  PopupCheckBulkResponse,
  QueueStatsResponse,
  ResendQueueResponse,
  SavedEntry,
  SavedUpdateMessage,
  SaveProgressMessage,
  SaveResponse,
} from './messages.ts';
import { classifySaveFailure, saveFailureConsoleLevel } from './native-error.ts';
import { createSaveGate, saveRequestKey } from './host-budget.ts';
import { clearInjectFailure, escalationUrl, injectFailureKind, showInjectFailure } from './inject-failure.ts';
import type { InjectFailureKind } from './inject-failure.ts';
import { recordSave } from './save-history.ts';
import type { SaveLogEntry, SaveStage } from './capture-log.ts';
import { saveQueueStats, stashFailedSave, sweepSaveQueue } from './save-queue.ts';
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
  // utils/dev-reload.ts にある。ここにあるのは配線: 何が、リロードで
  // 壊れてしまう work とみなされるか、そしてリロードが実際にどう実行
  // されるか。
  //
  // 以下はすべて、このバンドルが scripts/build-extension.cts でビルド
  // され、かつ native host がそのビルドの stamp ファイルを見つけた場
  // 合以外は不活性だ。だからリリース済みのインストールは
  // noteHostBuild の最初の行より先には絶対に進まない。
  const devReloadGate = createDevReloadGate({ now: () => Date.now(), savesInFlight: () => saveGate.inFlight() });
  // host が最後に報告したビルドで、ここで動いているものと違う場合。
  let pendingBuild: string | null = null;
  // すでにリロードを1回使ってしまったビルド。どんな判断を下すよりも
  // 前に保管庫から復元する＝これが何を防ぐかは DevReloadState.attempted
  // を参照。
  let attemptedBuild: string | null = null;
  let devReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let devReloadStarted = false;

  // 前のインスタンスが残したメモを読み、どのトークンがすでに試された
  // か知る。即座に開始する＝応答がループを断ち切る仕組みの復元と競合
  // しないように。
  const devReloadRestored: Promise<void> = EXT_BUILD_ID ? restoreDevReload() : Promise.resolve();

  async function restoreDevReload(): Promise<void> {
    let state: DevReloadState | null = null;
    try {
      const got = await chrome.storage.local.get(DEV_RELOAD_STATE_KEY);
      state = (got?.[DEV_RELOAD_STATE_KEY] as DevReloadState | undefined) || null;
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
      if (attemptedBuild && attemptedBuild !== EXT_BUILD_ID) await chrome.storage.local.set({ [DEV_RELOAD_STATE_KEY]: { attempted: attemptedBuild } satisfies DevReloadState });
      else {
        attemptedBuild = null;
        await chrome.storage.local.remove(DEV_RELOAD_STATE_KEY);
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
    maybeDevReload();
  }

  function scheduleDevReload(ms: number): void {
    if (devReloadTimer !== null) clearTimeout(devReloadTimer);
    // 上限を付ける: blockedUntil は1つの work の窓より先までは絶対に
    // 見ないので、それを超えるタイマーは、それをセットした worker よ
    // り長生きするだけになる。
    devReloadTimer = setTimeout(
      () => {
        devReloadTimer = null;
        maybeDevReload();
      },
      Math.min(Math.max(ms, 0), DEV_RELOAD_WORK_MS) + 50,
    );
  }

  function maybeDevReload(): void {
    if (!pendingBuild || devReloadStarted) return;
    const wait = devReloadGate.blockedUntil() - Date.now();
    if (wait > 0) {
      scheduleDevReload(wait);
      return;
    }
    devReloadStarted = true;
    void devReloadRestored
      .then(async () => {
        const build = pendingBuild;
        if (!build || !shouldReloadFor(build, EXT_BUILD_ID, attemptedBuild)) return;
        // await の後にもう一度尋ねる: メモを復元するのは保管庫への往
        // 復であり、その中で保存が始まっていることがありうる。
        if (devReloadGate.blockedUntil() > Date.now()) {
          scheduleDevReload(DEV_RELOAD_QUIET_MS);
          return;
        }
        await chrome.storage.local.set({ [DEV_RELOAD_STATE_KEY]: { attempted: build } satisfies DevReloadState });
        // capture.log には書かない: その行は、この呼び出しがまさに殺
        // そうとしている native 接続を通ることになる。リロードを見て
        // いる開発者がすでに見ているのは service worker のコンソール
        // だ。
        console.info(`[hologram] a newer extension build is on disk (${build}); reloading the extension`);
        chrome.runtime.reload();
      })
      .catch(() => {})
      .finally(() => {
        devReloadStarted = false;
      });
  }

  // どのみちページが worker に伝えていることを、#650 のためにもう一
  // 度読む。capture.log の中継は、ページ内の画面がすでに自分から名
  // 乗っている唯一の経路だ＝一括実行の `bulk`/`begin` とその終端の
  // 行、そして何も選ばずに閉じられたキャプチャ UI
  // （`select`/`cancel` と `select`/`fail`）。ここでそれを読むこと
  // で、リロードのゲートは自前のメッセージを必要とせず、人間が後で読
  // むログとずれてしまうこともなくなる。
  function noteDevReloadActivity(tabId: number | null, stage: unknown, phase: unknown): void {
    if (tabId == null) return;
    if (stage === 'bulk') {
      if (phase === 'begin') devReloadGate.begin(bulkActivity(tabId));
      else devReloadGate.end(bulkActivity(tabId));
    }
    // ユーザーがキャプチャ UI を閉じた、または投稿ではない何かをク
    // リックして UI が一緒に落ちた。どちらにせよ、中断すべき選択はも
    // う残っていない。
    if (stage === 'select' && (phase === 'cancel' || phase === 'fail')) devReloadGate.end(captureActivity(tabId));
    maybeDevReload();
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
    // #203: 送信に unreachable の印が付いた 'bridge' の失敗で、
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
  function beginSave(type: 'save' | 'savePost' | 'saveDragged', ctx: { saveId: string | null; captureId: string; platform: string | null; url: string | null; tabId: number | null }): SaveTrace {
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
    // ポップアップの最近の保存の一覧は、`start` を包む形でここで書
    // く。ここが4つの経路すべてが通る唯一の合流点であり、ゲートは同
    // 一の要求を2回実行するのではなく合流させるからだ＝合流した要求
    // は `start` へ絶対に到達しないので、これを包むことによって、1行
    // が実際に実行された1件の保存を意味するようになる（#124 —
    // save-history.ts）。
    const admitted = saveGate.admit(saveRequestKey(tabId, message.type, message.postUrl, imageUrls), tabId, () => {
      const running = start();
      // 保存が開始したときではなく決着したときに刻む: この一覧は「何
      // が着地したか、最新から順に」として読まれるもので、同時進行の
      // 2つの保存は逆の順序で終わることがありうる。
      const row = { type: message.type, platform: message.platform || null, url: message.postUrl || null, tabId, capturedVia: message.capturedVia || null };
      running.then(
        (result: any) => void recordSave({ ...row, ts: Date.now(), ok: true, captureId: result?.captureId || null }),
        (error: any) => void recordSave({ ...row, ts: Date.now(), ok: false, error: error?.message || String(error) }),
      );
      return running;
    });
    if (admitted) {
      // このタブで保存が進行中（#650）。保存自体はすでに数えられてい
      // る（ゲートが saveGate.inFlight() を読む）。これが加えるの
      // は、このタブでの一括実行がまだ生きているという証拠だ＝それは
      // 1秒に1投稿保存するので、これがなければその保留は実行の途中で
      // タイムアウトしてしまう。保存が決着したら再度尋ねる。それがそ
      // の実行によって先送りされていたリロードが可能になる瞬間だから
      // だ。
      devReloadGate.refresh(bulkActivity(tabId));
      const settled = () => {
        // ページ内のキャプチャ UI の仕事は保存が答えた時点で終わる
        // が、一括実行のものはそうではない。だからここで閉じるのはこ
        // ちらだけだ。
        devReloadGate.end(captureActivity(tabId));
        maybeDevReload();
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

  // `escalate` は #124 がこれについて変えたものだ。#269 の「連続2回
  // 目の押下で修復ページを開く」は、押下に報告する画面が一切なかった
  // から存在する＝バッジが語彙の全体で、2回目の無反応な押下は、バッ
  // ジだけでは足りなかったということだった。ポップアップからの押下に
  // は画面がある: ポップアップは開いていて、見られていて、理由を名指
  // しし同じページをボタンとして提示する。その裏でタブを開くと、画面
  // と選択の両方を同時に奪ってしまう。だからキーボードの経路は自動エ
  // スカレーションを保ち、ポップアップの経路はそうしない＝タブごとの
  // カウントはどちらでも共有するので、Alt+S の意味は変わらない。
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
    if (changeInfo.status !== 'loading') return;
    injectFailedTabs.delete(tabId);
    // 遷移するタブは、ページ内 UI と実行中の取り込みを道連れにするの
    // で、そこにはリロードがまだ破壊しうる work が何も残らない
    // （#650）。
    devReloadGate.dropTab(tabId);
    maybeDevReload();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    injectFailedTabs.delete(tabId);
    devReloadGate.dropTab(tabId);
    maybeDevReload();
  });

  // タブにキャプチャ UI を出す。それが立ち上がったかどうか、立ち上が
  // らなかった場合はなぜかに答える（#124）: ポップアップはそれをユー
  // ザーに伝えられる最初の画面なので、結果はツールバーに描くだけでな
  // く戻ってこなければならない。キーボードの経路は答えを無視する＝そ
  // れを読むために開いているものが何もない。
  async function activateOnTab(tab, auto = false, escalate = true): Promise<PopupActivateResponse> {
    // 試みを（そして http でない場合の静かな中断も）capture.log に記
    // 録する: 「何もしない」アイコンクリックは、そうしなければ SW の
    // DevTools コンソールからしか診断できず、それが起きたとき誰もそ
    // れを開いていない。
    //
    // 意図して saveId はない。UI の注入は保存を一切開始せず、この2つ
    // を別々に識別できることこそ、このログに欠けていた区別のすべて
    // だ: 後に `save`/`begin` が来ない `activate` の行は、ユーザーが
    // UI を開いてやめたことを意味する（#519）。
    if (!tab.id || !/^https?:/i.test(tab.url || '')) {
      logCapture({ stage: 'activate', phase: 'skip', url: tab.url || '(no url)' });
      return { ok: false, reason: 'not-http' };
    }
    // ログの行より前に置く。ログの行自体が native の往復であり、し
    // たがって「新しいビルドがディスクにある」の運び手にもなるからだ
    // （#650）。ここと下の注入の間で拡張機能がリロードされると、押下
    // は完全に何もしないままになってしまう＝まさに #269 が可視化しよ
    // うとしている失敗そのものだ。
    devReloadGate.begin(captureActivity(tab.id));
    logCapture({ stage: 'activate', phase: 'ok', host: getHostname(tab.url), url: tab.url, auto });
    try {
      // 自動キャプチャ（#362）は専用のジェスチャーで求められるので、
      // その選択は URL から推測するのではなくページ側のフラグとして
      // 乗ってくる＝Alt+S は、ブックマーク一覧を含むどのページでも単
      // 発キャプチャという意味を保ち続けなければならない。別の注入と
      // してセットしているのは、unlisted のキャプチャエントリポイン
      // トが関数ではなくファイルだからだ: 両方とも同じ activeTab の
      // 許可の下で、順番に動く。
      if (auto) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            window.__hologramAutoCapture = true;
          },
        });
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        // WXT はこの安定したファイル名で unlisted のキャプチャエント
        // リポイントを出力する。ESM の依存関係をバンドルするので、
        // activeTab の注入は、グローバルファイル間の実行順序に頼らず
        // 1本のスクリプトのままでいられる。
        files: ['capture.js'],
      });
      // UI がページ上にあるので、以前の押下がツールバーに残した警告
      // が何であれ解消される（#269）。また、これはその後殺された
      // worker が残したバッジを取り下げられる唯一の瞬間でもある。
      clearInjectFailure(tab.id);
      injectFailedTabs.delete(tab.id);
      return { ok: true };
    } catch (error) {
      console.error('Failed to inject content script:', error);
      // keepLocal: この行は、何もしなかったクリックの唯一の記録で、
      // 診断ページはローカルのリングバッファを読む＝一度も始まらな
      // かった保存には、他に読み返せる場所がない（#269）。
      logCapture({ stage: 'activate', phase: 'fail', host: getHostname(tab.url), url: tab.url, error: (error as Error)?.message }, true);
      devReloadGate.end(captureActivity(tab.id)); // UI が一切立ち上がらなかったので、保護してやる義理もない
      return { ok: false, reason: await alertInjectFailure(tab.id, escalate) };
    }
  }

  // chrome.action.onClicked のリスナーはない。これは省略ではなく意
  // 図してのことだ（#124）。action は今 default_popup を持ち、
  // Chrome はポップアップを持つ action に対して onClicked を発火しな
  // い（chrome.action のリファレンス曰く「the action has a popup な
  // らこのイベントは発火しない」）。ここにリスナーを残すと、次に読む
  // 人には「アイコンは今もクリックで保存を始める」と読める死んだコー
  // ドになる。ポップアップのボタンがその経路で、下の
  // {type:'popupActivate'} を通る。

  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'activate' && command !== 'activate-auto') return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    // ポップアップによって変わらない（#124）: コマンドは一度も
    // onClicked を通ったことがないので、Alt+S は今も1回の押下で起動
    // し、連続2回目の失敗でも今もエスカレーションする＝それを別の方
    // 法で言うために開いている画面がない。await しているのは listener
    // 自身の promise が始めた work とともに決着するようにするためだ
    // けで、この経路では答えを誰も読まない。
    if (tab) await activateOnTab(tab, command === 'activate-auto');
  });

  // ポップアップの保存ボタン（#124）。worker は、送信元が名指すタブ
  // を信頼するのではなく、アクティブなタブを自分で見つける: ポップ
  // アップは自分のタブを持たず、「このポップアップが開いた上のタブ」
  // こそがこの問い合わせが返すものだ。activeTab はポップアップを開い
  // たジェスチャーによって許可されている＝Chromium は
  // ExtensionActionRunner::RunAction の中で、action がポップアップを
  // 表示すると判断するより前にそれを許可する（ソースから読んだ、
  // 2026-08-03）ので、下の注入は Alt+S が行うものと同じだけ許可され
  // ている。
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, _sender, sendResponse) => {
    if (message.type !== 'popupActivate') return false;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => (tab ? activateOnTab(tab, message.auto === true, false) : ({ ok: false, reason: 'no-tab' } satisfies PopupActivateResponse)))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, reason: 'no-tab' } satisfies PopupActivateResponse));
    return true; // 非同期の応答
  });

  // ポップアップの「この一覧を取り込む」項目（#793）: アクティブなタ
  // ブに、このモードが辿れる一覧があるか。注入するのではなく、常駐の
  // content script（manifest の content_scripts を通じて、対象の各サ
  // イトですでにページ上にある）に尋ねる＝単なる質問に activeTab は
  // 要らない。常駐スクリプトは startCapture の auto 分岐がチェックす
  // るのと同じ extractor のゲート（site.isBulkCapturePage）へ委譲す
  // るので、#790 が後で追加するサイトはここに変更を必要としない。何
  // も listen していないタブ（chrome://、常駐スクリプトのないサイ
  // ト）は chrome.tabs.sendMessage を「Receiving end does not exist」
  // で reject させる＝これは以下でサイト自身が「いいえ」と言うのと同
  // じ「非対応」の答えとして読む。
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, _sender, sendResponse) => {
    if (message.type !== 'popupCheckBulk') return false;
    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]): Promise<PopupCheckBulkResponse> => {
        if (!tab?.id || !/^https?:/i.test(tab.url || '')) return { supported: false };
        try {
          const res = await chrome.tabs.sendMessage(tab.id, { type: 'checkBulkCapturePage' } satisfies CheckBulkCapturePageMessage);
          return { supported: res?.supported === true };
        } catch {
          return { supported: false };
        }
      })
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ supported: false } satisfies PopupCheckBulkResponse));
    return true; // 非同期の応答
  });

  // --- URL ブックマーク取り込み（#195、メタデータ抽出は #239 に吸収） ----
  // ページの右クリック -> ブラウザがすでに描画した DOM
  // （schema.org/OGP/DC/Highwire）から組み立てたブックマークレコー
  // ド。fetch はしない＝extension/utils/extractor/web-meta.ts のヘッ
  // ダーコメントと #239 の 2026-08-03 の「設計クローズ」コメント（現
  // 時点の設計記録）を参照。startBackground() の呼び出しごとに登録す
  // る。service worker の再起動は同じ id を再登録するので、まず
  // removeAll() することで、再起動が「duplicate id」を投げて2つを黙っ
  // て残すのを防ぐ。
  //
  // contexts（#195 2026-08-02 コメント #1）: 'page' + 'selection' +
  // 'video' + 'audio' ＝'link' は含めない（そのリンク先は一度も開か
  // れないページなので OGP を読む DOM がなく、そこへ到達するには
  // #195 の 2026-07-19 のコメントが却下したメインプロセスの fetch が
  // 必要になる）。'image' も含めない（それは #122 の項目だ）。
  // documentUrlPatterns もない＝これはすべてのサイトに表示され、
  // （#122 と同様）それに追加の permission は要らない。contextMenus
  // だけがこの機能が追加する permission だ。
  //
  // 一貫して `?.` を使っている: これは contextMenus を持たずに
  // chrome.* をモデル化するテストダブルを守るためだ（
  // background-wiring.test.ts はそれを持つ方のテストで、理由はそちら
  // 自身のコメントを参照）。本物の Chrome は manifest の permission
  // が許可されていれば常にこれを持つ。
  const BOOKMARK_MENU_ID = 'hologram-bookmark';
  chrome.contextMenus?.removeAll(() => {
    chrome.contextMenus.create({ id: BOOKMARK_MENU_ID, title: chrome.i18n.getMessage('ctxBookmark'), contexts: ['page', 'selection', 'video', 'audio'] }, () => void chrome.runtime.lastError);
  });

  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== BOOKMARK_MENU_ID || !tab?.id || !/^https?:/i.test(tab.url || '')) return;
    saveBookmarkForTab(tab).catch(() => {}); // saveBookmarkForTab 自身が失敗をログに残す＝ここでの reject にすることは何も残っていない
  });

  // 他のすべての保存経路が使うのと同じ admitSave/beginSave の仕組み
  // でゲートし、ログに残す（#323 の予算、#519 の capture.log のス
  // レッド）＝コンテキストメニューのクリックも、メタデータの作り方
  // （プラットフォーム API やスクリーンショットではなく DOM の
  // OGP）が違うだけで、他の3つとまったく同じ保存だ。
  async function saveBookmarkForTab(tab): Promise<void> {
    const tabId = tab.id;
    if (tabId == null) return;
    const admitted = admitSave({ type: 'saveBookmark', platform: 'bookmark', postUrl: tab.url || '' }, tabId, getHostname(tab.url), [], () => doSaveBookmark(tab));
    if (!admitted) return; // busy＝他の経路の busy 経路と同じ、静かに何もしない UX
    try {
      await admitted;
    } catch (error: any) {
      // 不具合ではなく結果である失敗については warn にする＝
      // console.error は拡張機能のエラーコンソールに積み上がる
      // （#580）。
      console[saveFailureConsoleLevel(classifySaveFailure(error?.message))](error);
      logSaveFailure(error, { saveId: null, platform: 'bookmark', host: getHostname(tab.url), url: tab.url || null });
    }
  }

  // #239: extension/entrypoints/read-meta.ts の報告を待ち、
  // sender.tab.id でこの呼び出しに対応付ける（1つのタブにつき進行中
  // のこの種の読み取りは常に1つだけ＝同じタブでの2回目のブックマー
  // ク保存は、1回目が解決するまで始まれない。他のすべての保存経路の
  // タブごとの受理と同じだ）。listener は同期的に登録され、
  // executeScript もこの関数の最初の await より前に同期的に呼ぶ＝制
  // 御が呼び出し元へ戻る時点で listener はすでに生きている。これはテ
  // ストハーネスにとって重要だ（同じ onMessage の登録を通して応答を
  // 送り込むため）。
  function readPageMeta(tab): Promise<WebMetaResult> {
    return new Promise((resolve, reject) => {
      const tabId = tab.id;
      function listener(message: PageMetaExtractedMessage, sender: chrome.runtime.MessageSender) {
        if (message?.type !== 'pageMetaExtracted' || sender.tab?.id !== tabId) return undefined;
        chrome.runtime.onMessage.removeListener(listener);
        resolve(message.result);
        return undefined;
      }
      chrome.runtime.onMessage.addListener(listener);
      chrome.scripting.executeScript({ target: { tabId }, files: ['read-meta.js'] }).catch((err) => {
        chrome.runtime.onMessage.removeListener(listener);
        reject(err);
      });
    });
  }

  async function doSaveBookmark(tab): Promise<BridgeAck> {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('savePost', { saveId: null, captureId, platform: 'bookmark', url: tab.url || null, tabId: tab.id ?? null });

    let webMeta: WebMetaResult;
    try {
      // #759: read-meta.js は `files:` の unlisted スクリプト注入で
      // あって `func:` ではない＝その結果は #195 の OGP 専用の読み取
      // りがかつてそうしていたように executeScript() 自身の戻り値に
      // は乗せられないので、代わりにそれが報告するメッセージ上で沈黙
      // を区切る（上の crop の区間が使うのと同じ withDeadline の慣用
      // 句）。
      webMeta = await withDeadline(readPageMeta(tab), METADATA_TIMEOUT_MS, 'page metadata');
    } catch (err: any) {
      throw trace.fail('metadata', err?.message || 'page metadata extraction failed');
    }
    trace.passed('metadata');

    // meta.platform はずっと null のまま（buildWebMeta / 下で組み立
    // てるレコード）＝sendPlatform もここでは null なので、
    // buildRecord の `meta.platform || sendPlatform || null` という
    // フォールバックの連鎖は、#195 の 2026-08-02 設計コメント #2 が確
    // 認しているとおり、まさに null に落ち着く。
    const meta = buildWebMeta(webMeta, tab.url || '');
    const record = buildRecord(meta, { captureId, capturedAt, postUrl: meta.url || tab.url || '', sendPlatform: null, extra: { mediaType: meta.mediaType, media: meta.media, source: 'bookmark' } });

    let ack: BridgeAck;
    try {
      ack = await sendPostToBridge(captureId, record, true, null, null);
    } catch (err: any) {
      throw trace.fail('bridge', err?.message || 'bridge save failed');
    }
    trace.passed('bridge');
    markSaved([record.url, tab.url], ack?.captureId || captureId, savedMediaUrls(ack), tab.id);
    // ついで掃き出し (#203): この保存が host に届いたことが、今まさに届くという証拠になる。
    triggerQueueSweep();
    await bumpRecentSave(record.url);
    return { ...ack, captureId: ack?.captureId || captureId };
  }

  // 一括取り込み（#362）: 投稿をパーマリンクだけから保存する＝スク
  // リーンショットも DOM の画像も要らない。プラットフォーム API がす
  // でに原本を持っているので、ページはどの投稿かを言うだけでよく、
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
    const admitted = admitSave(message, tabId, senderHost, [], () => savePostByUrl(tab, message.platform, message.postUrl, message.capturedVia || null, message.saveId));
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
        sendResponse({ ok: false, errorKind, metaReason: error?.metaReason || null, error: error?.message } satisfies SaveResponse);
      });
    return true; // 非同期の応答
  });

  async function savePostByUrl(tab, sendPlatform, postUrl, capturedVia, saveId: string | null = null) {
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

    // メディアを持たない投稿もそれでも保存する＝host はそのサイド
    // カーを書き込み、ライブラリは #365 が乗った時点でそれを表示する
    // （handleSavePost を参照）。代わりに失うと、それは取り返しがつ
    // かない: X にはブックマークのエクスポート機能がなく、後から戻っ
    // て取り直すことができない。
    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      extra: { mediaType: meta.mediaType, media: meta.media, capturedVia },
    });

    const metaOk = metaFetched(meta);
    let ack: BridgeAck;
    try {
      ack = await sendPostToBridge(captureId, record, metaOk, meta.metaError || null, saveId);
    } catch (err) {
      throw trace.fail('bridge', err?.message || 'bridge save failed', meta.metaError || null);
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id);
    // ついで掃き出し (#203).
    triggerQueueSweep();
    const grouped = await bumpRecentSave(record.url);
    return { ...ack, captureId: ack?.captureId || captureId, metaOk, metaReason: meta.metaError || null, grouped, hostSkew: await skewNoteForBanner() };
  }

  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'captureAndSend') return false;

    if (!sender.tab?.id) {
      sendResponse({ ok: false, error: 'Missing tab context' } satisfies CaptureAndSendResponse);
      return false;
    }

    if (!isAllowedSender(sender.tab.url, message.platform)) {
      sendResponse({ ok: false, error: 'Sender origin does not match platform' } satisfies CaptureAndSendResponse);
      return false;
    }

    const tabId = sender.tab.id;
    const senderHost = getHostname(sender.tab.url);
    const tab = sender.tab;
    // captureAndSend は capturedVia を絶対に運ばない（それを運ぶのは
    // 取り込み経路の savePost / imageDragged だけだ）: captureAndSave
    // は既定値（null）のままにする。
    const admitted = admitSave(message, tabId, senderHost, [], () => captureAndSave(tab, message.rect, message.postUrl, message.platform, null, message.replaces || null, message.saveId, message.domMeta || null));
    if (!admitted) {
      chrome.tabs.sendMessage(tabId, { type: 'notify', success: false, errorKind: 'busy' } satisfies NotifyMessage).catch(() => {});
      sendResponse({ ok: false, errorKind: 'busy', error: BUSY_ERROR } satisfies CaptureAndSendResponse);
      return false;
    }
    admitted
      // captureAndSave には戻り値がない（代わりに notify() で
      // content script へ直接通知する）＝content.js の capturePost()
      // もこの sendResponse を読まないので、`ok:true` がペイロードの
      // すべてだ。
      .then(() => sendResponse({ ok: true } satisfies CaptureAndSendResponse))
      .catch((error) => {
        const errorKind = classifySaveFailure(error?.message);
        // 不具合ではなく結果である失敗については warn にする＝
        // console.error は拡張機能のエラーコンソールに積み上がる
        // （#580）。
        console[saveFailureConsoleLevel(errorKind)](error);
        logSaveFailure(error, { saveId: message.saveId, platform: message.platform, host: senderHost, url: message.postUrl });
        // queued（#203）: ブリッジの送信に unreachable の印が付き、
        // この保存の save-queue.ts への退避を試みたときだけ存在す
        // る。
        chrome.tabs.sendMessage(tabId, { type: 'notify', success: false, errorKind, queued: error?.queued } satisfies NotifyMessage).catch(() => {});
        sendResponse({ ok: false, errorKind } satisfies CaptureAndSendResponse);
      });

    return true;
  });

  async function captureAndSave(tab, rect, postUrl, sendPlatform, capturedVia: string | null = null, replaces: string | null = null, saveId: string | null = null, domMeta: DomMeta | null = null) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('save', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    // captureVisibleTab は送信元ではなくウィンドウのアクティブなタブ
    // を撮る＝クリックからキャプチャまでの間にユーザーがタブを切り替
    // えていたら、この投稿のメタデータの下に別のページが保存されてし
    // まう。代わりに検証して中断する。
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (!active || active.id !== tab.id) throw trace.fail('capture', 'Tab changed before capture');

    let dataUrl: string;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 92 });
    } catch (err) {
      throw trace.fail('capture', err?.message || 'captureVisibleTab failed');
    }
    trace.passed('capture');

    // 区切りを付ける（#507）: 答えはページから来るが、キャプチャの途
    // 中で別のページへ遷移した、フリーズした、listener を外したペー
    // ジは絶対にそれを送らない＝この await には終わりがなく、向こう
    // で回り続けるバナーにも終わりがなかった。
    let response: CropImageResponse;
    try {
      response = await withDeadline<CropImageResponse>(chrome.tabs.sendMessage(tab.id, { type: 'cropImage', dataUrl, rect } satisfies CropImageMessage), CROP_TIMEOUT_MS, 'crop');
    } catch (err) {
      throw trace.fail('crop', err?.message || 'cropImage failed');
    }
    if (!response?.croppedDataUrl) throw trace.fail('crop', 'Cropping failed');
    trace.passed('crop');
    // カンマのないデータ URL のための `?? ''`＝host は空の画像に対し
    // て 'Missing image data' と答える。これは `undefined` を送って
    // いた頃とまったく同じだ。
    const jpegBase64 = response.croppedDataUrl.split(',')[1] ?? '';

    // メタデータはプラットフォームの API から来る（DOM スクレイピン
    // グはしない）。fetchPostMetadata は metadata.js で定義されてい
    // る（先頭で import）。expectedHost は Misskey/Mastodon インスタ
    // ンスへの fetch を送信元タブの host に固定する（SSRF の番人＝悪
    // 意あるページが fetch を別の host へ向けさせることはできない）。
    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');

    // 第2の情報源（#202）で、この2つが組み合わさる唯一の場所: ペー
    // ジが表示していたものが、API が null のままにした欄を埋める。そ
    // れ以外は何もしない。下の metaFetched より前に実行するが、その
    // 答えは変えない＝metaOk は「プラットフォーム API がこの投稿につ
    // いて教えてくれた」という意味を保ち続けるので、画面から組み立て
    // たレコードは一部欠けた保存のままだ。変わるのはレコードの方だ:
    // 以前は何も持たずに host へ届いていた年齢制限の投稿が、今はテキ
    // ストと投稿者を持って届く。これが、host が拒否する保存（#492）
    // と、ライブラリにある投稿との違いになる。
    const domFilled = mergeDomMeta(meta, domMeta);

    const record = buildRecord(meta, {
      captureId,
      capturedAt,
      postUrl,
      sendPlatform,
      replaces,
      // スクリーンショットが主画像で、media[]（API の原本 URL）はブ
      // リッジがダウンロードし、その後保存したファイル名で上書きす
      // るものだ。
      extra: { image: `${captureId}.jpg`, mediaType: meta.mediaType, media: meta.media || [], capturedVia, domFilled },
    });

    const metaOk = metaFetched(meta);
    // 一度だけ組み立てる。失敗した送信とその再試行キューへの退避
    // （#203）がまったく同じオブジェクトを共有するようにするため＝
    // 'save' は save-queue.ts がキューに入れる2つの要求の形のうちの1
    // つだ（3つ目の 'savePost' がなぜそうではないかは、そちらのヘッ
    // ダーコメントを参照）。
    const saveReq: SaveRequest = { type: 'save', captureId, saveId, image: jpegBase64, metadata: record, metaOk, metaReason: meta.metaError || null };
    let ack: BridgeAck;
    try {
      ack = await bridgeSend(saveReq);
    } catch (err: any) {
      const failErr = trace.fail('bridge', err?.message || 'bridge save failed');
      if (err?.unreachable) failErr.queued = await stashFailedSave(saveReq, logCapture);
      throw failErr;
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id); // このタブのタイムラインバッジを今すぐ灯す
    // ついで掃き出し (#203): この保存が host に届いたことが、今まさに届くという証拠になる。
    triggerQueueSweep();
    // grouped = このセッションでのこの投稿の以前の保存の件数 →
    // バナーはそれらと統合したと言う（アプリは同じ URL のレコードを
    // 1枚のカードに折りたたむ）。
    const grouped = await bumpRecentSave(record.url);
    chrome.tabs.sendMessage(tab.id, { type: 'notify', success: true, metaOk, metaReason: meta.metaError || null, grouped, hostSkew: await skewNoteForBanner(), domFilled } satisfies NotifyMessage).catch(() => {});
    // タブには上ですでに結果を伝えていて、これを読むことはない。これ
    // を返すのは、admitSave が書く save-history の行が、他の3つの経
    // 路の行がすでにそうしているように、レコード自身の id を運べるよ
    // うにするためだ（#124。#125 の「アプリで開く」のために）。
    return { ...ack, captureId: ack?.captureId || captureId };
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

  // 同じ注記だが、ブラウザのセッションにつき1回だけ（#124）。
  //
  // 保存バナーは以前これをすべての保存で言っていた。それを置く定位置
  // がどこにもなかったからだ＝ずれはインストールの状態であり、バナー
  // が誰もが見る唯一の画面だった。今はポップアップがその定位置なの
  // で、すべての保存で繰り返すのは、ユーザーが保存の最中には直せない
  // ことについてのノイズになる。
  //
  // バナーから完全には落としていない: そうしないと、ポップアップを一
  // 度も開かない人は、両側が食い違っていることを一生知らないままにな
  // る。セッションにつき1回が、それでもその人に届く最小限の量だ。
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
  // save-queue.ts が「host が一度も答えなかった」を「host が答えて
  // 拒否した」と区別できるよう、エラーに印を付ける（#203）。これは文
  // 字列の一致ではなく機構の印だ＝意図してこうしている。再試行の対象
  // にするかどうかの判定が、native-error.ts 自身の狭く Chrome の文言
  // 変更に対して壊れやすい分類を絶対に引き継がないように。
  function unreachableError(message: string): Error {
    return Object.assign(new Error(message), { unreachable: true });
  }

  function bridgeSend(message: HostRequest): Promise<BridgeAck> {
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
        port = chrome.runtime.connectNative(NATIVE_HOST);
      } catch (error: any) {
        reject(unreachableError(`Native host unavailable: ${error?.message || error}`));
        return;
      }

      timer = setTimeout(() => finish(unreachableError('Native host timed out')), NATIVE_HOST_TIMEOUT_MS);

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
        // 下の unreachableError にはしない: host は実際に答えた。た
        // だ拒否しただけだ（#492 の post-unavailable など）＝
        // save-queue.ts は、繰り返すだけになる答えを絶対に再試行して
        // はいけない（#203）。
        if (res.ok) finish(null, res.ack);
        else finish(new Error(res.error));
      });

      port.onDisconnect.addListener(() => {
        finish(unreachableError(chrome.runtime.lastError?.message || 'Native host disconnected (is it installed?)'));
      });

      port.postMessage(message);
    });
  }

  // 一括取り込みの保存（#362）: メタデータのみでスクリーンショットな
  // し＝host が投稿自身のメディアをダウンロードし、最初の1枚がレコー
  // ドの画像になる。
  //
  // 意図して残された唯一の保存要求ラッパー（#203）: 'save' と
  // 'saveDragged' の要求は、今は captureAndSave と
  // captureAndSaveDragged の中で直接組み立てている。失敗した送信は、
  // bridgeSend に渡したのとまったく同じオブジェクトを
  // save-queue.ts の再試行キューへ退避しなければならないからだ。この
  // 要求の形（'savePost'）は絶対にキューに入らない
  // （save-queue.ts のヘッダーを参照）ので、自分専用の薄いラッパーを
  // 保っている。
  function sendPostToBridge(captureId: string, record: CaptureMetadata, metaOk: boolean, metaReason: string | null, saveId: string | null) {
    return bridgeSend({ type: 'savePost', captureId, saveId, metadata: record, metaOk, metaReason });
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
  let nextQueryId = 1;
  const pendingQueries = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  function failAllPending(message: string) {
    for (const [, p] of pendingQueries) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pendingQueries.clear();
  }

  function getQueryPort(): chrome.runtime.Port {
    if (queryPort) return queryPort;
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    queryPort = port;
    port.onMessage.addListener((msg: unknown) => {
      const id = responseId(msg);
      const p = id == null ? null : pendingQueries.get(id);
      if (p == null || id == null) return; // タイムアウトした要求への遅れた返信＝決着させるものは何もない
      pendingQueries.delete(id);
      clearTimeout(p.timer);
      p.resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      if (queryPort === port) queryPort = null;
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
  function queryBridge(urls: string[]): Promise<{ results: SavedResults; trashed: TrashedResults }> {
    return new Promise((resolve, reject) => {
      let port: chrome.runtime.Port;
      try {
        port = getQueryPort();
      } catch (error: any) {
        reject(new Error(`Native host unavailable: ${error?.message || error}`));
        return;
      }
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
          resolve(res.ok ? { results: res.ack.results || {}, trashed: res.ack.trashed || {} } : { results: {}, trashed: {} });
        },
        reject,
        timer,
      });
      try {
        port.postMessage({ type: 'query', id, urls } satisfies HostRequest);
      } catch (error: any) {
        pendingQueries.delete(id);
        clearTimeout(timer);
        queryPort = null;
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
  function queryForResend(url: string): Promise<SavedEntry | null> {
    return queryBridge([url]).then((r) => r.results[url] ?? null);
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
  // activeTab で都度注入する Alt+S だけが動く。
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

  // 引き金（#203 設計コメント #4 — なぜ chrome.alarms によるポーリ
  // ングではなくちょうどこの4つなのかという理由付けはそちらにある）:
  // Chrome の再起動、インストール/更新、保存が成功した直後の瞬間
  // （下の captureAndSave/captureAndSaveDragged/savePostByUrl/
  // doSaveBookmark にある）、そして保存済みバッジの問い合わせポート
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
  function markSaved(urls: Array<string | null | undefined>, captureId: string | null, media: Array<string | null>, tabId?: number) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const known = cacheGet(url)?.entry;
      const merged: SavedEntry = known ? { id: known.id || captureId || '', media: known.media.slice(), owners: (known.owners || known.media.map(() => known.id || null)).slice() } : { id: captureId || '', media: [] as Array<string | null>, owners: [] as Array<string | null> };
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
      if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'savedUpdate', url, media } satisfies SavedUpdateMessage).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, _sender, sendResponse) => {
    if (message.type !== 'checkSaved') return false;
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
    return true; // 非同期の応答
  });

  // --- 重複保存の警告（#34） ---------------------------------------------
  // content script が保存を始める前に尋ねるので、答えは事後の通知で
  // はなく選択（コピー/置換/スキップ）になれる: 拡張機能は native
  // host を通して書き込むので、デスクトップアプリを閉じた状態での保
  // 存には、後から解決するアプリ内の画面がない。
  //
  // 読み取り専用で fail-open。質問を未解決のままにするものは何であれ
  // （パーマリンクなし、host に届かない、問い合わせの例外）
  // `ok:false` で答え、呼び出し元は常にそうしてきたとおり保存する。
  // 見逃した警告のコストはレコード1件増えることで、ブロックされた保
  // 存のコストは投稿そのものだ。
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type !== 'checkDuplicate') return false;
    duplicateOf(message.url, message.platform, Array.isArray(message.imageUrls) ? message.imageUrls : [])
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true; // 非同期の応答
  });

  interface DuplicateAnswer {
    ok: boolean;
    duplicate?: boolean;
    captureId?: string | null;
    // #158: 投稿はライブラリにないが、そのレコードとファイルはライブ
    // ラリのゴミ箱にある。duplicate:true と一緒にセットすることは絶
    // 対にない＝生きたキャプチャの方が強い答えで、それこそが置換でき
    // るものだ。
    trashed?: TrashedEntry | null;
  }

  // 2つの軸を、決められる順に（#34 で確定した設計）:
  //   1. 投稿の URL（postKeyOf、host 側）＝この投稿はそもそもライブ
  //      ラリにあるか？
  //   2. 画像＝これから保存しようとしているものは、保存済みのものと
  //      重なるか？
  // 軸2があるおかげで、漫画の次のページが重複と呼ばれずに済む: 同じ
  // 投稿 URL でも、ライブラリが持っていない画像なので、何も再保存さ
  // れない。画像をまったく比較できないとき（テキストのみの投稿、画像
  // ごとの答えが存在する前に保存されたレコード、プラットフォームが画
  // 像アイデンティティのルールを持たないページ）は軸1だけで単独で警
  // 告する＝誤った警告は「コピー」で答えられコストはかからないが、見
  // 逃した警告は静かな重複になる。
  async function duplicateOf(url: unknown, platform: string, imageUrls: string[]): Promise<DuplicateAnswer> {
    if (typeof url !== 'string' || !url) return { ok: true, duplicate: false };
    const hit = cacheGet(url);
    let entry: SavedEntry | null;
    let trashed: TrashedEntry | null;
    if (hit) {
      entry = hit.entry;
      trashed = hit.trashed;
    } else {
      const fresh = await queryBridge([url]);
      entry = (Object.hasOwn(fresh.results, url) ? fresh.results[url] : null) || null;
      trashed = (Object.hasOwn(fresh.trashed, url) ? fresh.trashed[url] : null) || null;
      cacheSet(url, entry, trashed);
    }
    // 生きたものは何もないが、投稿はゴミ箱にある（#158）: 再保存す
    // ると、原本がまだ復元可能な投稿の2つ目のコピーを作ってしまうの
    // で、この通知は中断させるだけの価値がある。下の画像比較より前に
    // 尋ねているのは、比較すべき保存済みの画像が存在しないからだ＝
    // レコードはライブラリを離れていて、ゴミ箱の索引は画像単位ではな
    // く投稿単位で答える。
    if (!entry) return trashed ? { ok: true, duplicate: false, trashed } : { ok: true, duplicate: false };

    const wanted = imageUrls.map((u) => mediaKeyOf(platform, u)).filter((k): k is string => !!k);
    const saved = entry.media.map((u, i) => ({ key: u ? mediaKeyOf(platform, u) : null, owner: (entry?.owners && entry.owners[i]) || entry?.id || null }));
    const comparable = saved.filter((s) => s.key);
    if (!comparable.length || !wanted.length) return { ok: true, duplicate: true, captureId: entry.id || null };
    const overlap = comparable.find((s) => s.key && wanted.includes(s.key));
    return overlap ? { ok: true, duplicate: true, captureId: overlap.owner } : { ok: true, duplicate: false };
  }

  // --- 直近の保存の記憶（投稿 URL ごと） ------------------------------------------
  // 同じ投稿の連続した保存（複数ページの漫画、撮り直し）はアプリで1
  // 枚のカードに統合されるので、保存のトーストはそれを言うべきだ＝そ
  // うしないと2回目の保存は何もしなかったように見える（新しいものは
  // 何も現れず、カードの見た目も変わらない）。
  // この件数は chrome.storage.session に住む: service worker の再起
  // 動を生き延び、ブラウザが閉じるとクリアされる（「直近」＝このブラ
  // ウジングセッション）。レコードの正規化された投稿 URL をキーにす
  // る（どちらの保存経路も同じメタデータからそれを組み立てる）。この
  // 保存より前に、この URL の保存が何回起きたかを返す（0 = 最初）。
  const RECENT_SAVES_KEY = 'recentSaves.v1';
  const RECENT_SAVES_MAX = 200; // これより多い数の投稿は古いものから刈り取る
  async function bumpRecentSave(url) {
    if (!url) return 0;
    try {
      const got = await chrome.storage.session.get(RECENT_SAVES_KEY);
      const map = got[RECENT_SAVES_KEY] || {};
      const prev = map[url] ? map[url].n : 0;
      map[url] = { n: prev + 1, t: Date.now() };
      const keys = Object.keys(map);
      if (keys.length > RECENT_SAVES_MAX) {
        keys.sort((a, b) => map[a].t - map[b].t);
        for (const k of keys.slice(0, keys.length - RECENT_SAVES_MAX)) delete map[k];
      }
      await chrome.storage.session.set({ [RECENT_SAVES_KEY]: map });
      return prev;
    } catch {
      return 0; // この記憶はできる範囲で＝これのために保存を失敗させたり遅らせたりすることは絶対にない
    }
  }

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

  function flushLog() {
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
      port = chrome.runtime.connectNative(NATIVE_HOST);
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

  // メタデータの取得が「成功した」と言えるのは、プラットフォームの
  // API が何かしら識別できる欄を返したときだ。空のレコード（fetch 失
  // 敗、API 停止、パースできない URL）は author/date/text が null で
  // media もない＝スクリーンショットは保存できているが、ユーザーには
  // 素の成功ではなく投稿情報が欠けていると伝えるべきだ。metaError が
  // セットされていればそれが権威を持つ: screenName は URL からパース
  // でき、date は X の snowflake id からデコードできるので、API の
  // fetch が何も返さなかったレコードにも両方が存在しうる（鍵付きの X
  // アカウントが、URL 由来の screenName のせいで完全な成功に見えてし
  // まっていた＝2026-07-12）。
  // プラットフォームがファイルとして提供し、ページはプレビューしかで
  // きないメディア。その代わりに表示される静止フレームは決してレコー
  // ドの中身ではないので、これらの投稿はページが見せているものではな
  // くプラットフォームが告知するものをダウンロードして保存する。
  function isPlayableMedia(mediaType) {
    return mediaType === 'video' || mediaType === 'gif';
  }

  function metaFetched(meta) {
    if (!meta || meta.metaError) return false;
    return !!(meta.displayName || meta.userId || meta.text || meta.date || (Array.isArray(meta.media) && meta.media.length));
  }

  // --- 画像ドラッグの保存（drag.js → ここ） ---
  // 投稿クリックの保存と同じメタデータだが、スクリーンショットはな
  // い: ドラッグされた画像自体がレコードの主画像になる（ブリッジがそ
  // れをダウンロードする）。「イラストのレコード」の形（image = 作
  // 品、media: []）を生む。
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type !== 'imageDragged') return false;
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
    const imageUrls = message.imageUrls || [];
    const admitted = admitSave(message, tabId, senderHost, imageUrls, () => captureAndSaveDragged(tab, message.platform, message.postUrl, imageUrls, message.replaces || null, message.saveId));
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
        sendResponse({ ok: false, errorKind, metaReason: error?.metaReason || null, queued: error?.queued } satisfies SaveResponse);
      });
    return true; // 非同期の応答
  });

  // 診断の中継。content.js はブリッジより手前の段階の失敗
  // （select / permalink）をここへ報告する。{type:'dumpLogs'} は
  // ローカルのフォールバック用リングバッファ（host の capture.log に
  // 一度も届かなかったエントリ）を読み返す。
  chrome.runtime.onMessage.addListener((message: ContentToBackgroundMessage, sender, sendResponse) => {
    if (message.type === 'logCapture') {
      const entry = Object.assign({ host: getHostname(sender.tab?.url) }, message.entry || {});
      noteDevReloadActivity(sender.tab?.id ?? null, entry.stage, entry.phase);
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

  async function captureAndSaveDragged(tab, sendPlatform, postUrl, imageUrls, replaces: string | null = null, saveId: string | null = null) {
    const captureId = generateCaptureId();
    const capturedAt = new Date().toISOString();
    const trace = beginSave('saveDragged', { saveId, captureId, platform: sendPlatform, url: postUrl, tabId: tab.id ?? null });

    // expectedHost は Misskey/Mastodon インスタンスへの fetch を送信
    // 元タブの host に固定する（SSRF の番人）。ドラッグは今のところ
    // x/bsky/pixiv だけだが、一貫性のために付けておく。
    let meta: PostRecord;
    try {
      meta = await fetchPostMetadata(postUrl, { expectedHost: getHostname(tab.url) });
    } catch (err) {
      throw trace.fail('metadata', err?.message || 'metadata fetch threw');
    }
    trace.passed('metadata');
    const metaOk = metaFetched(meta);

    // 動画や GIF の投稿についてページが渡せるのはポスターフレームだ
    // けで、ポスター単体はライブラリのエントリの価値がない＝中身は動
    // 画ファイルだ（#450）。投稿保存の経路は、#119 段階1以降、動画本
    // 体も含めてプラットフォームが告知する原本をすでにダウンロードし
    // ているので、この経路にも動画を fetch させるよう教えるのではな
    // く、そちらへ流す。それ以外はすべてイラストレコードの形を保ち、
    // そこでは指し示された画像こそがユーザーが保存を求めたものそのも
    // のだ。
    let record: any;
    let send: () => Promise<BridgeAck>;
    // 下の分岐のうち、bridgeSend の呼び出しが再試行の対象になりうる
    // 方（#203）＝'saveDragged' の要求のときだけセットする。再生可能
    // メディアの分岐は代わりに 'savePost' を送り、これは
    // save-queue.ts のヘッダーコメントが意図して再試行キューから除外
    // しているので、そちらでは null のままにする。
    let queueable: SaveDraggedRequest | null = null;
    if (isPlayableMedia(meta.mediaType)) {
      // capturedVia は null のまま＝取り込み経路（#362）ではなく通常の保存だ。
      record = buildRecord(meta, { captureId, capturedAt, postUrl, sendPlatform, replaces, extra: { mediaType: meta.mediaType, media: meta.media, capturedVia: null } });
      send = () => sendPostToBridge(captureId, record, metaOk, meta.metaError || null, saveId);
    } else {
      const primary = pickPrimaryImage(meta.platform || sendPlatform, imageUrls, meta);
      if (!primary || !primary.url) throw trace.fail('image', 'Could not resolve a dragged image URL');
      trace.passed('image');
      record = buildRecord(meta, {
        captureId,
        capturedAt,
        postUrl,
        sendPlatform,
        replaces,
        extra: {
          mediaType: 'image',
          // 複数画像の投稿の何枚目か（1始まり）＋合計。複数画像の投
          // 稿でのみ記録する。判定できないときは imageIndex は null。
          imageCount: (meta.media || []).length > 1 ? meta.media.length : null,
          imageIndex: (meta.media || []).length > 1 && primary.index >= 0 ? primary.index + 1 : null,
          // image + media[] はブリッジがセットする（image = ダウンロードした原本、media = []）
        },
      });
      const draggedReq: SaveDraggedRequest = { type: 'saveDragged', captureId, saveId, imageUrl: primary.url, imageReferer: primary.referer, metadata: record, metaOk, metaReason: meta.metaError || null };
      queueable = draggedReq;
      send = () => bridgeSend(draggedReq);
    }

    let ack: BridgeAck;
    try {
      ack = await send();
    } catch (err: any) {
      const failErr = trace.fail('bridge', err?.message || 'bridge save failed', meta.metaError || null);
      if (err?.unreachable && queueable) failErr.queued = await stashFailedSave(queueable, logCapture);
      throw failErr;
    }
    trace.passed('bridge');
    markSaved([record.url, postUrl], ack?.captureId || captureId, savedMediaUrls(ack), tab.id); // このタブのタイムラインバッジを今すぐ灯す
    // ついで掃き出し (#203): この保存が host に届いたことが、今まさに届くという証拠になる。
    triggerQueueSweep();
    // メタデータ取得の失敗をドロップのオーバーレイに表示する（クリッ
    // ク保存のバナーと同じ一部成功のシグナル）。それによって、投稿情
    // 報なしで保存されたスクリーンショットのないイラストが素の成功と
    // して表示されないようにする。grouped = このセッションでのこの投
    // 稿の以前の保存件数（オーバーレイは統合したと言う）。
    const grouped = await bumpRecentSave(record.url);
    return { ...ack, captureId: ack?.captureId || captureId, metaOk, metaReason: meta.metaError || null, grouped, hostSkew: await skewNoteForBanner() };
  }
}

// 両方の保存経路が共有するサイドカーレコードを組み立てる。クリック経
// 路は image と media を加える（スクリーンショットが本体で、
// media[] はブリッジがダウンロードする API の原本を運ぶ）。ドラッグ
// 経路は image/media をブリッジに任せ（ダウンロードしたイラストが
// image になり、media は [] のまま）、代わりに複数画像の投稿の何枚目
// だったかを記録する。唯一の正本にすることで、新しい欄が2つの経路の
// 間でずれるのを防ぐ。
function buildRecord(meta, { captureId, capturedAt, postUrl, sendPlatform, replaces, extra }: { captureId: string; capturedAt: string; postUrl: string; sendPlatform: string | null; replaces?: string | null; extra: Record<string, unknown> }): CaptureMetadata {
  return Object.assign(
    {
      captureId,
      // #34: ユーザーが重複警告に「置換」と答えたときの、この保存が
      // 置き換えるキャプチャの id。host はそれを素のレコードの欄とし
      // てそのまま書き込む＝古いキャプチャをゴミ箱へ送るのはアプリの
      // 仕事だ（write-once）。
      replaces: replaces || null,
      url: meta.url || postUrl || null,
      // meta.platform が null になるのは URL がパースできなかったと
      // きだけだ。その場合は送信元が報告した（すでにオリジン検証済み
      // の）プラットフォームへフォールバックし、レコードが
      // platform:null にならず、表示側のプラットフォームフィルタで見
      // え続けるようにする。
      platform: meta.platform || sendPlatform || null,
      text: meta.text,
      title: meta.title || null,
      displayName: meta.displayName,
      screenName: meta.screenName,
      userId: meta.userId,
      avatar: meta.avatar,
      avatarReferer: meta.avatarReferer,
      // #289: 投稿者プロフィールのスナップショット欄
      // （bio/profileLinks/banner）＝ブックマーク経路では null ではな
      // く undefined になる。上の quotedPost/poll/linkCard と同じ
      // で、それらの meta オブジェクトはそもそもそういう欄を一切持た
      // ない。
      bio: meta.bio,
      profileLinks: meta.profileLinks,
      banner: meta.banner,
      followers: meta.followers,
      authorCreatedAt: meta.authorCreatedAt,
      likes: meta.likes,
      reposts: meta.reposts,
      replies: meta.replies,
      bookmarks: meta.bookmarks,
      views: meta.views,
      // キャプチャ時刻への黙ったフォールバックはしない: でっち上げた
      // 「投稿日」は表示側の日付ソート/フィルタを汚染する。表示側は
      // null の日付を扱える。
      date: meta.date || null,
      capturedAt,
      updatedAt: capturedAt, // Hologram での最終更新（タグ編集などで更新される）
      lang: meta.lang,
      isReply: meta.isReply,
      isQuote: meta.isQuote,
      isThread: meta.isThread,
      isEdited: meta.isEdited,
      editedAt: meta.editedAt,
      cw: meta.cw,
      sensitive: meta.sensitive,
      quotedUrl: meta.quotedUrl,
      replyToId: meta.replyToId,
      // #180 のサイドカーの子レコード（extractor がそれらを組み立て
      // る。これが欠けていた配線だった＝#751 を参照）。ブックマーク経
      // 路では undefined（null ではない）になる。その meta オブジェク
      // トにはそもそもそういう欄がない。
      quotedPost: meta.quotedPost,
      replyToPost: meta.replyToPost,
      // #179: 投稿のアンケート、持っている場合（X / Misskey /
      // Mastodon）。上の2つと同じく、ブックマーク経路では undefined
      // （null ではない）。
      poll: meta.poll,
      // #181: リンク共有投稿の OGP プレビューカード（Bluesky /
      // Mastodon / X）。上の2つと同じく、ブックマーク経路では
      // undefined（null ではない）。
      linkCard: meta.linkCard,
      seriesId: meta.seriesId,
      seriesTitle: meta.seriesTitle,
      seriesOrder: meta.seriesOrder,
      hashtags: meta.hashtags || [],
      tags: meta.tags || [],
      // #290: 投稿自身の :shortcode: カスタム絵文字（Misskey/Mastodon
      // 限定。extractor/types.ts の CustomEmoji を参照）。ここでは告
      // 知するだけで、ブリッジがそれぞれを共有の emoji/ ストアへダウ
      // ンロードしてその `file` を埋める。media-download.mts の
      // downloadAvatar が使うのと同じアバターストアのパターンだ。
      customEmojis: meta.customEmojis || [],
      // 取得した原本（#292）で、受け取ったテキストのまま＝native
      // host がそれらを圧縮・ハッシュ化・上限適用する
      // （native-host/raw-payload.mts）。一部欠けたものを含むすべて
      // の保存経路で運ぶ: 使える欄を何も生まなかった応答こそ、その本
      // 文が生き残らなければならないものだ。
      rawPayloads: meta.raw || [],
      // #239: ブックマーク経路で title/description/author/
      // published/siteName/url を埋めたのがどの流儀（schema.org 形
      // 式 / OGP / DC / Highwire / HTML フォールバック）だったか。プ
      // ラットフォームの保存すべてでは undefined（null ではない）に
      // なる。その meta オブジェクトにはそういう欄がそもそもない＝上
      // の quotedPost/poll と同じ慣習だ。
      metaSource: meta.metaSource,
    },
    extra,
  );
}

function generateCaptureId() {
  const hex = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
  return `${Date.now()}-${hex}`;
}

// ドラッグされた画像のためにどの原本を保存するか選ぶ。フル解像度で保
// 存できるよう、プラットフォーム API の原本（ドラッグされた画像と一
// 致するもの）を優先する。{ url, referer, index } を返す。index は投
// 稿の media[] 内での選ばれた画像の0始まりの位置（判定できなければ
// -1）。
function pickPrimaryImage(platform, imageUrls, meta) {
  const media = (meta && meta.media) || [];
  const extractor = extractorFor(platform);
  // media[] がファイル名中のページ番号でインデックスされているサイ
  // ト（pixiv）は、キー照合なしにドラッグされた URL からそのまま答え
  // る。
  if (extractor?.mediaPageIndex) {
    const page = extractor.mediaPageIndex(imageUrls);
    const referer = extractor.mediaReferer;
    const i = page !== null && page < media.length ? page : media.length === 1 ? 0 : -1;
    // ドラッグされたページが実際に一致したときだけ API の原本に差し
    // 替える＝一致しないドラッグに対して黙って p0 を保存すると、ユー
    // ザーが一度もドラッグしていない画像を主張してしまう。不一致 →
    // ドラッグされた URL を保つ（X/Bluesky と同じ）。
    const pick = i >= 0 ? media[i] : null;
    if (pick && pick.url) return { url: pick.url, referer: pick.referer || referer, index: i };
    return { url: imageUrls[0], referer, index: -1 };
  }
  const i = matchMediaIndex(platform, imageUrls, media);
  if (i >= 0 && media[i] && media[i].url) return { url: media[i].url, referer: media[i].referer, index: i };
  return { url: hiRes(platform, imageUrls[0]), referer: undefined, index: media.length === 1 ? 0 : -1 };
}

// ドラッグされた画像が由来する、投稿の media[] エントリの（0始まり
// の）インデックス。mediaKeyOf で照合する（サイトごとのルールは
// extractor が持ち、オーバーレイも同じもので保存済み画像と比較する、
// #334）。一致しなければ（またはプラットフォームがキーの仕組みを持
// たなければ）-1。
function matchMediaIndex(platform, imageUrls, media) {
  const keys = imageUrls.map((u) => mediaKeyOf(platform, u)).filter(Boolean);
  if (!keys.length) return -1;
  for (let i = 0; i < media.length; i++) {
    const k = mediaKeyOf(platform, media[i].url);
    if (k && keys.includes(k)) return i;
  }
  return -1;
}

// サイトの元解像度への書き換え。与えられた URL へフォールバックす
// る＝書き換えルールが当てはまらない場合でも、保存は何かを送らなけれ
// ばならない。
function hiRes(platform, url) {
  if (!url) return url;
  return highResUrlOf(platform, url) ?? url;
}

// chrome.* / DOM への依存を持たない純粋なヘルパーで、直接のユニット
// テスト（scripts/background-unit.test.ts）のために export してあ
// る＝このファイルの残りは startBackground() を通して拡張機能の
// service worker の中でしか動かない。
export { isAllowedSender, pickPrimaryImage, matchMediaIndex, hiRes, buildRecord, generateCaptureId };

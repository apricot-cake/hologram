// ブリッジの送信が native host に一度も届かなかった保存のための再試行
// キュー（#203）。bridgeSend が一度も答えを読まないまま reject したと
// き、または要求を送った後に結果だけ分からなくなったとき、通信路に乗る
// はずだった個別画像の保存要求を
// ここへ退避し、host に再び届くようになった
// ら再送する。失われはしない。これがなければ、失敗バナーが提示できる
// 唯一の直し方（host を登録する、Chrome を再起動する）が、ユーザーが
// 保存しようとしていた画像も一緒に捨ててしまう。
//
// 範囲はあえて狭くしてある。Issue #203 の 2026-08-02 のコメントが現時
// 点の設計記録であり、このヘッダーはそのコメントがすでに完全に述べて
// いる理由を要約するだけだ:
//
//   - host への要求のうち、キューに入るのは右クリック画像の
//     'saveMedia' だけだ。'savePost' は絶対にキューに入らない。一覧
//     取り込み中に host が届かなくなると、多数の要求が一度にキューへ
//     入り、バイト予算を使い果たすためだ。
//   - 「到達不能」は機構であって（connectNative が例外を投げた、応答
//     が一度も来なかった、送信がタイムアウトした）、host のエラー文言
//     との一致では絶対にない。native-error.ts の文字列分類は意図して
//     狭くしてあり、Chrome の文言変更に対して壊れやすい。再試行の対象
//     とするかどうかがその壊れやすさを引き継いではいけない。
//     background.ts の bridgeSend は機構から `delivery` を付け、このモ
//     ジュールが信頼するのはそれだけだ。送信前、結果不明、明示拒否を
//     Error の文言から推測してはならない。
//   - chrome.storage.local のキーはエントリごとに1つで、全部をまとめ
//     て持つ1本の配列キーには絶対にしない: 2件の保存が同時に失敗した
//     とき、同じ配列への read-modify-write が競合して片方を黙って落と
//     すようなことがあってはならない。background.ts 自身の診断ログの
//     退避（stashLogLocally）もすでに同じ理由でこの判断をしていて、こ
//     こでのキーの形は意図してそれに合わせてある。
//   - 予算は件数だけでなくバイト数でも制限する。画像 URL や付随する
//     メタデータの長さは一定ではなく、chrome.storage.local の枠全体
//     （約10MiB）は診断用のリング
//     バッファ（background.ts の DIAG_PREFIX）と共有している。件数の
//     上限だけでは、許可したエントリが実際に収まる保証にはならない。
import type { RequestReceipt, SavedEntry, SaveMediaRequest } from '../../native-host/protocol.mts';
import type { SaveLogEntry } from './capture-log.ts';
import { getNativeHost } from './native-host.ts';

export const SAVE_QUEUE_PREFIX = 'savequeue_';
// chrome.storage.local の約10MiBの枠の半分。残り半分は、同じ保管庫を
// 共有する診断用リングバッファ（background.ts の DIAG_PREFIX、
// DIAG_KEEP）のための余裕と、chrome.storage.local 自身がここで計測し
// た JSON ペイロードに上乗せしてキーごとに課す小さなオーバーヘッドの
// ためのもの。
export const SAVE_QUEUE_BUDGET_BYTES = 5 * 1024 * 1024;
// 2つ目の、件数ベースの天井: これがないと、とても小さいペイロード
// （短い URL の画像など）の長い連なり
// が、1件あたりのバイト数が安いというだけの理由で、妥当な範囲をはるか
// に超えて増え続けてしまう。
export const SAVE_QUEUE_MAX_ENTRIES = 20;
// この回数だけ到達不能な試行が続いたら、エントリは永遠に再試行される
// のではなく諦めた扱いになる＝下の gaveUp を参照。
export const SAVE_QUEUE_MAX_TRIES = 5;

type QueueableRequest = SaveMediaRequest;

export interface QueuedSaveEntry {
  v: 1;
  ts: string; // ISO — 保管庫のキーにも埋め込んであり、追い出しはキーだけでソートできる
  // このエントリがどの Native Host 向けに退避されたか（#732: 開発用
  // ドとリリースビルドは、1つの chrome.storage を共有していても、異な
  // る host 名と異なるライブラリを相手にする）。再送は `host` が今の
  // 現在のプロファイルが選ぶ Native Host と一致するエントリしか考慮しない。
  host: string;
  type: QueueableRequest['type'];
  payload: QueueableRequest;
  tries: number;
  // true は要求を送った後に応答だけを失ったことを表す。この状態では、
  // ライブラリへの問い合わせが成功して「未保存」と確定するまで再送しない。
  // タイムアウト直後には host の commit がまだ進行中かもしれないためである。
  outcomeUnknown?: boolean;
  attemptedAt?: number;
  // tries が SAVE_QUEUE_MAX_TRIES に達したときにセットする＝このキー
  // が置かれているモジュールコメントを参照。諦めたエントリは（削除さ
  // れず）その場に残るので、診断ページはそれでもそれを数えられる。他
  // のすべてと同じ「古い方から追い出す」仕組みで年老いていき、自分だ
  // けの別スケジュールは持たない。
  gaveUp?: boolean;
}

export type SaveQueueLogger = (entry: SaveLogEntry, keepLocal?: boolean) => void;

// --- chrome.storage.local, promisified ------------------------------------------

function storageGet(keys: string[] | null): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (all) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(all || {});
    });
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function storageRemove(keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

// UTF-16 のコード単位ではなく UTF-8 のバイト長（`.length` では投稿の
// テキストが持つ非 ASCII 文字をすべて過小に数えてしまう）＝枠そのもの
// が単位としているものに合わせてある。
function byteSizeOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

interface QueueRow {
  key: string;
  entry: QueuedSaveEntry;
  size: number;
}

let queueMutation: Promise<void> = Promise.resolve();

function serializeQueueMutation<T>(work: () => Promise<T>): Promise<T> {
  const result = queueMutation.then(work, work);
  queueMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// 今保管庫にあるキューのエントリすべてを、古いものから順に。文字列と
// してのキー順が時系列順になっている＝診断用リングバッファのキーが使
// うのと同じ仕掛けで、「一番古いものを落とす」のために `ts` を別途ソー
// トする必要が絶対にない。
function queueRowsOf(all: Record<string, unknown>): QueueRow[] {
  return Object.keys(all)
    .filter((k) => k.startsWith(SAVE_QUEUE_PREFIX))
    .sort()
    .map((key) => ({ key, entry: all[key] as QueuedSaveEntry, size: byteSizeOf(all[key]) }));
}

// --- 退避 -----------------------------------------------------------------------

// background.ts のブリッジの catch から呼ばれる。未送信または結果不明の
// 保存ごとに1回。エントリが今保管庫にあって後で確認・再送できる
// なら true、何も保持できなかったら false を返す＝この2つの答えから
// 失敗バナーの文言（i18n.ts の bannerQueued / bannerNotQueued）が選ば
// れるので、呼び出し元は絶対にどちらかを推測してはいけない。
export async function stashFailedSave(payload: QueueableRequest, log: SaveQueueLogger, targetHost?: string, outcomeUnknown = false, preserveExisting = false): Promise<boolean> {
  const nativeHost = targetHost ?? (await getNativeHost());
  const ts = new Date().toISOString();
  const candidatePayload = payload;
  const size = byteSizeOf({ v: 1, ts, host: nativeHost, type: payload.type, payload: candidatePayload, tries: 0, outcomeUnknown });

  if (size > SAVE_QUEUE_BUDGET_BYTES) {
    // 単独でこのエントリが予算に収まらない。保持しても、収まるはずのエントリを
    // 押し出すだけだ。後で再試行してもサイズが変わるわけでもないの
    // で、この保存はそもそもキューに入れない。
    log({ stage: 'queue', phase: 'fail', reason: 'too-large', type: payload.type, bytes: size }, true);
    return false;
  }

  const entry: QueuedSaveEntry = { v: 1, ts, host: nativeHost, type: payload.type, payload: candidatePayload, tries: 0, ...(outcomeUnknown ? { outcomeUnknown: true, attemptedAt: Date.now() } : {}) };

  return serializeQueueMutation(async () => {
    try {
      const rows = queueRowsOf(await storageGet(null));
      let totalBytes = rows.reduce((sum, row) => sum + row.size, 0) + size;
      let count = rows.length + 1;
      const evicted: string[] = [];
      let i = 0;
      if (preserveExisting && (totalBytes > SAVE_QUEUE_BUDGET_BYTES || count > SAVE_QUEUE_MAX_ENTRIES)) {
        // gaveUpは再送対象でない終端在庫。unknown/retryableを守ったまま、
        // 新しい保存を永久に拒否しない範囲で古いgaveUpだけを整理する。
        for (const row of rows.filter((row) => row.entry.gaveUp)) {
          if (totalBytes <= SAVE_QUEUE_BUDGET_BYTES && count <= SAVE_QUEUE_MAX_ENTRIES) break;
          totalBytes -= row.size;
          count -= 1;
          evicted.push(row.key);
        }
        if (totalBytes > SAVE_QUEUE_BUDGET_BYTES || count > SAVE_QUEUE_MAX_ENTRIES) {
          log({ stage: 'queue', phase: 'fail', reason: 'quota', type: payload.type }, true);
          return false;
        }
      }
      // 新しいエントリが両方の上限に収まるまで、古い方から追い出す。必
      // ず終わる: この候補は単独では上の予算チェックをすでに通っている
      // ので、既存の行をすべて追い出せば（i が rows.length に達する）
      // ちょうど1件だけが残り、それはバイト数・件数どちらの天井の下にも
      // 収まる。
      while ((totalBytes > SAVE_QUEUE_BUDGET_BYTES || count > SAVE_QUEUE_MAX_ENTRIES) && i < rows.length) {
        const oldest = rows[i];
        i++;
        if (!oldest) continue; // 到達しない（i < rows.length が今成立していた）＝noUncheckedIndexedAccess を満たすため
        totalBytes -= oldest.size;
        count -= 1;
        evicted.push(oldest.key);
      }
      if (evicted.length) {
        await storageRemove(evicted);
        log({ stage: 'queue', phase: 'evict', count: evicted.length }, true);
      }
      const key = `${SAVE_QUEUE_PREFIX}${ts}_${Math.floor(Math.random() * 1e6)}`;
      await storageSet({ [key]: entry });
      return true;
    } catch (err) {
      // この関数自身の予算計算が「収まるはず」と言った後でも、書き込み
      // は失敗しうる（特に、診断用リングバッファ自身の書き込みとの
      // QUOTA_BYTES の競合）。再試行はせず捨てる＝モジュールコメントの
      // 「予算はバイト数」という理由付けを参照: 今すぐもう一度試みても、
      // 同じ保管庫と再び競合するだけだ。
      log({ stage: 'queue', phase: 'fail', reason: 'quota', type: payload.type, error: (err as Error)?.message }, true);
      return false;
    }
  });
}

// 送信前に耐久化した要求を、ack または明示拒否を受け取った後だけ除く。
export async function removeQueuedSave(captureId: string, targetHost?: string): Promise<void> {
  const nativeHost = targetHost ?? (await getNativeHost());
  const rows = queueRowsOf(await storageGet(null));
  await storageRemove(rows.filter((row) => row.entry.host === nativeHost && row.entry.payload.captureId === captureId).map((row) => row.key));
}

export async function markQueuedSaveUnknown(captureId: string, targetHost?: string): Promise<void> {
  const nativeHost = targetHost ?? (await getNativeHost());
  const rows = queueRowsOf(await storageGet(null));
  for (const row of rows) {
    if (row.entry.host === nativeHost && row.entry.payload.captureId === captureId) await storageSet({ [row.key]: { ...row.entry, outcomeUnknown: true, attemptedAt: Date.now() } });
  }
}

export async function markQueuedSaveNotSent(captureId: string, targetHost?: string): Promise<void> {
  const nativeHost = targetHost ?? (await getNativeHost());
  const rows = queueRowsOf(await storageGet(null));
  for (const row of rows) {
    if (row.entry.host === nativeHost && row.entry.payload.captureId === captureId) await storageSet({ [row.key]: { ...row.entry, outcomeUnknown: false, attemptedAt: undefined } });
  }
}

// --- sweep（再送） ----------------------------------------------------------------

export interface SweepDeps {
  // background.ts の bridgeSend。通常の保存の送信と同じやり方で
  // reject する。`delivery` の分類も含めて＝このモジュールはその分類を
  // 再実装しない。
  send: (payload: QueueableRequest) => Promise<unknown>;
  // バッジのキャッシュではなく、新しく行う「このパーマリンクは保存済
  // みか」の問い合わせ（background.ts の queryBridge）＝どんな失敗で
  // も reject ではなく null で解決する（fail-open、
  // duplicate-guard.ts の checkDuplicate と同じルール）。
  query: (url: string, requestId: string) => Promise<{ saved: SavedEntry | null; receipt: RequestReceipt | null; receiptCapable: boolean }>;
  log: SaveQueueLogger;
}

// すでに sweep が実行中の間 true。単一飛行にしているのは、service
// worker はこれを常に1つしか持たないからだ（flushLog についての
// background.ts 自身のコメントが、ログキューについて同じ点を述べてい
// る）＝sweep の途中で届く2回目の引き金には付け加えるべき有用なもの
// が何もなく、2つを同時に走らせると、たった今失敗した host への
// connectNative の試行を倍にしてしまう。
let sweeping = false;

// 現在の host に対してキューにあるものをすべて、古いものから順に再送
// し、1回の試みが host はまだ到達不能だと証明した瞬間に止める（#203
// 設計コメント: キューの残りも今すぐ試せばまったく同じように失敗する
// はずで、それでも試すのは、たった今「だめだ」と言ったばかりの host に
// 対して connectNative の試行を余分に使うだけになる）。host が（タイ
// ムアウトや未接続ではなく）実際に答えたエントリは、sweep を止めるの
// ではなく、そのまま捨てる: それはこの一時停止が繰り返さないよう存在
// している接続性の問題ではないからだ。
export async function sweepSaveQueue(deps: SweepDeps, targetHost?: string): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const nativeHost = targetHost ?? (await getNativeHost());
    const rows = queueRowsOf(await storageGet(null)).filter((row) => row.entry?.host === nativeHost && !row.entry?.gaveUp);
    for (const { key, entry } of rows) {
      const url = entry.payload?.metadata?.url ?? null;
      const captureId = entry.payload?.captureId ?? null;
      if (url) {
        let known: SavedEntry | null = null;
        let receipt: RequestReceipt | null = null;
        let receiptCapable = false;
        let queryConfirmed = false;
        try {
          ({ saved: known, receipt, receiptCapable } = await deps.query(url, captureId || ''));
          queryConfirmed = true;
        } catch {
          known = null;
        }
        // #34 の owners/id は 2026-07-29 の時点ですでに乗っていた＝こ
        // のモジュールが実装する設計コメントは、まさにその理由でこの
        // べき等性チェックを v1 に折り込んでいる。一致するということ
        // は、host がまさにこのキャプチャを書き込み、ack だけが失われ
        // たということ。同じ URL に対する異なる captureId は、別の正
        // 当な保存であり、それでも送信しなければならない。
        const alreadyLanded = !!known && (known.id === captureId || (known.owners || []).includes(captureId));
        const receiptMatches = !receipt || !('requestNonce' in receipt) || !receipt.requestNonce || !entry.payload.requestNonce || receipt.requestNonce === entry.payload.requestNonce;
        // captureId が同じでも nonce が違う receipt は別の保存要求のもの。
        // URL の既存保存や終端状態を、この要求の結果として採用しない。
        if (receipt && !receiptMatches) break;
        if ((receipt?.state === 'completed' && receiptMatches) || alreadyLanded) {
          await storageRemove([key]).catch(() => {});
          continue;
        }
        if (receipt?.state === 'failed') {
          deps.log({ stage: 'queue', phase: 'fail', reason: 'answered', type: entry.type, error: receipt.error }, true);
          await storageRemove([key]).catch(() => {});
          continue;
        }
        if ((receipt?.state === 'processing' || receipt?.state === 'claiming') && receiptMatches) break;
        if (receipt?.state === 'retryable') {
          // owner が終了したことを host が確認済み。同じ requestId の排他を
          // 取り直せるため、この場合だけ結果不明要求を再送できる。
        } else if (entry.outcomeUnknown) {
          // v4以前は receipt lock を持たない。新しい query の欄を無視した
          // null を「未保存」と誤読して二重実行してはならない。
          if (!receiptCapable) break;
          const graceMs = 90_000;
          if (!entry.attemptedAt || Date.now() - entry.attemptedAt < graceMs || !queryConfirmed) break;
        }
        // 送信後の timeout/disconnect は失敗ではなく結果不明である。照会
        // 自体にも失敗したなら、再送は同じ capture の二重保存を作り得る。
      }
      try {
        // どの再送もpostMessageより先に結果不明を耐久化する。workerが
        // send直後に終了してcatchへ来なくても次世代は安全側から始める。
        await storageSet({ [key]: { ...entry, outcomeUnknown: true, attemptedAt: Date.now() } });
        await deps.send(entry.payload);
        await storageRemove([key]).catch(() => {});
      } catch (err: any) {
        if (err?.delivery === 'rejected') {
          // host は答えたうえで拒否した（自身の post-unavailable な
          // ど）＝再試行してもその答えを繰り返すだけだ。このエントリ
          // 1件だけを落として続ける。これは下の break が存在する理由
          // である「host がそこにいない」ケースではない。
          deps.log({ stage: 'queue', phase: 'fail', reason: 'answered', type: entry.type, error: err?.message }, true);
          await storageRemove([key]).catch(() => {});
          continue;
        }
        if (err?.delivery === 'unknown') {
          await storageSet({ [key]: { ...entry, outcomeUnknown: true } }).catch(() => {});
          break;
        }
        const tries = (entry.tries || 0) + 1;
        const deliveryState = err?.delivery === 'not-sent' ? { outcomeUnknown: false, attemptedAt: undefined } : {};
        if (tries >= SAVE_QUEUE_MAX_TRIES) {
          await storageSet({ [key]: { ...entry, ...deliveryState, tries, gaveUp: true } }).catch(() => {});
          deps.log({ stage: 'queue', phase: 'giveup', type: entry.type }, true);
        } else {
          await storageSet({ [key]: { ...entry, ...deliveryState, tries } }).catch(() => {});
        }
        break; // まだ到達不能＝残りも今すぐ試せば同じように失敗する
      }
    }
  } finally {
    sweeping = false;
  }
}

// --- 診断 -------------------------------------------------------------------

export interface SaveQueueStats {
  count: number;
  bytes: number;
  gaveUp: number;
}

// 読み取り専用＝送信もせず、追い出しもせず、host での絞り込みもしな
// い: 診断ページは保管庫全体のキューを表示する（別の host の残りエン
// トリ、#732 を含めて）。「保管庫に今何が座っているか」こそが、この
// ページにたどり着いた人が知りたい答えそのものだからだ。
export async function saveQueueStats(): Promise<SaveQueueStats> {
  const rows = queueRowsOf(await storageGet(null));
  return {
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.size, 0),
    gaveUp: rows.filter((row) => row.entry?.gaveUp).length,
  };
}

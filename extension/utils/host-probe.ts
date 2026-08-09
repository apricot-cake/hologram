// 「native host は今応答しているか、そして両側は同じ世代か」＝これを尋ね
// る理由がある拡張機能側の2つのページが、どちらもこれを尋ねる（#124）。
//
// コピーではなく抽出した。診断ページが最初にこれを作り（#203 の接続テス
// ト、#205 のバージョン比較）、ツールバーのポップアップも開くたびに同じ問
// いに答えなければならなくなった。2つの独立した計測では2つのページが食い
// 違いかねない＝「ポップアップでは緑なのに診断では赤」という状態は誰にも
// 説明できず、どちらの表示も二度と信用できなくなる。
//
// 計測は必ずページから行い、service worker からは絶対に行わない。理由は2
// つで、どちらも「答えが、保存が依存しているのと同じ事実になっている」こ
// とに関わる。
//   - 接続は拡張機能自身のオリジンから開くので、host 側の
//     allowed_origins チェックが実際の保存とまったく同じように働く。
//   - worker が覚えているプロトコルバージョン（background.ts の
//     hostSkew）は、たまたま最後に受け取った応答の記憶にすぎない。それは
//     「host が最後に話したとき何と言ったか」への答えであって、「今そこ
//     にいるか」への答えではない。
//
// 呼び出しごとに host のプロセスを1つ起動する＝Chrome は接続ごとに1つ生
// み出し、この host は短命だ。これは診断ページが元々払っていたコストで、
// ポップアップを開くたびにも同じコストを払う。
import { PROTOCOL_VERSION, hostProtocolVersion, protocolSkewOf } from '../../native-host/protocol.mts';
import type { HostRequest, ProtocolSkew } from '../../native-host/protocol.mts';
import { NATIVE_HOST } from './native-host.ts';

// 起動直後のコールドな host プロセス（再起動後の最初の起動）を死んでいる
// と判定しない程度に長く、それでいて待っているページがまだページでいられ
// る程度に短く。
const HOST_PING_TIMEOUT_MS = 5000;

// Chrome の言い回しではなく、どこで失敗したかを記録する。4つの値は判別可
// 能な4つの機構に対応し、それぞれ異なる助言につながる＝connect-threw は
// Chrome が host の登録すら見つけられなかったことを意味し（何もインストー
// ルされていない、またはレジストリのエントリが消えている）、disconnect は
// 見つかりはしたがプロセスが死んだことを意味する＝たいてい lastError が理
// 由を運んでいる。
export type HostPingWhere = 'connect-threw' | 'timeout' | 'disconnect' | 'post-threw';

export interface HostPing {
  ok: boolean;
  where?: HostPingWhere;
  error?: string | null;
  // host の応答をそのまま保持する: protocolReportOf がそのバージョンスタン
  // プを読み、診断ページは全体をそのまま出力する。
  msg?: unknown;
}

export function pingNativeHost(): Promise<HostPing> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: HostPing) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (e: any) {
      done({ ok: false, where: 'connect-threw', error: String((e && e.message) || e) });
      return;
    }
    const timer = setTimeout(() => {
      try {
        port.disconnect();
      } catch {
        /* */
      }
      done({ ok: false, where: 'timeout' });
    }, HOST_PING_TIMEOUT_MS);
    port.onMessage.addListener((m: unknown) => {
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch {
        /* */
      }
      done({ ok: true, msg: m });
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      done({ ok: false, where: 'disconnect', error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || null });
    });
    try {
      port.postMessage({ type: 'ping' } satisfies HostRequest);
    } catch (e: any) {
      clearTimeout(timer);
      done({ ok: false, where: 'post-threw', error: String((e && e.message) || e) });
    }
  });
}

export interface ProtocolReport {
  extension: number;
  host: number | null;
  hostAnswered: boolean;
  skew: ProtocolSkew | null;
}

// 両側の契約バージョンを並べる（#205）。
//
// `host` が null になるのは、ping が一切応答を得られなかったとき（host を
// 起動できなかった＝どちらだったかは ping の `where` が言う）と、スタン
// プなしで応答したとき（この handshake が存在する前の host）の両方だ。こ
// の2つは同じものではないので、読み手に ping から推測させるのではなく
// `hostAnswered` で区別している。
export function protocolReportOf(ping: HostPing): ProtocolReport {
  const answered = ping.ok === true;
  const host = answered ? hostProtocolVersion(ping.msg) : null;
  return {
    extension: PROTOCOL_VERSION,
    host,
    hostAnswered: answered,
    // host が応答して初めて意味を持つ: 届かない host には、遅れているとも
    // 進んでいるとも言えるバージョンがそもそもない。
    skew: answered ? protocolSkewOf(host) : null,
  };
}

// 1つのページが native host をどれだけ使ってよいか（#323 のうち、信頼の
// 話ではない方の半分）。
//
// `chrome.runtime.connectNative` は接続ごとに host のプロセスを1つ起動す
// る＝これは意図した設計（host は意図して短命であり、そのおかげでデスク
// トップアプリを閉じていても保存が動く）で、それゆえ「ページがどれだけの
// 要求を引き起こせるか」は実質「ページがどれだけのプロセスを起動できる
// か」という問いになる。#323 はこれに合成クリック経由で到達し、それは今
// utils/user-gesture.ts が止めている。このモジュールは同じ問いに対する答
// えを、それ以外のどんな経路（まだ誰も書いていない経路や、こちら側のバグ
// を含む）から尋ねられても返す。
//
// 意図して速度制限ではなく2つの上限にしてある。1分あたりの要求数に上限を
// 付けるなら、最も速い正当な経路（ブックマーク取り込み（#362）は host が
// 答えるのと同じ速さで保存する）より上に設定しなければならず、それより上
// の値では何の役にも立たないほど緩くなる。どの正当な経路も行わないのは
// 「同時に多数の保存を走らせる」ことだ＝Alt+S のキャプチャは単発、取り込
// みは厳密に直列、ドロップゾーンは1回のドロップしか保持せず、ホバーボタン
// は同じ画像への2回目の押下を拒む。だから上限をかけるべきは並行度であり、
// そこでの誠実な天井は小さい。
//
//   1. 同一の要求は倍増するのではなく合流する。同じタブから同じ画像への
//      保存が2件同時進行することはユーザーが求められるものではなく、2件
//      目に1件目自身の結果で答える方が、さもなければ2件が書いてしまう重
//      複レコードよりましだ。
//   2. 1つのタブ、そしてブラウザ全体が同時に抱えられる保存の数には限りが
//      ある。上限を超えた要求は、接続を開く前に即座に拒否する。だから拒
//      否のコストはゼロで、カウントが上限をこっそり超えることもない。
//
// 失敗も構造上ここに含まれる＝枠は保存が決着するまで保持され、保存のどの
// 区間にもデッドラインがある（utils/deadline.ts）ため、失敗する経路も成
// 功する経路より遅くならずに枠を解放する。ここでは何が失敗したかを知る必
// 要は一切ない。

// タブごと: 人間が一度に押せる数よりは上（ホバー保存ボタンは画像ごとなの
// で、素早いユーザーなら数個は始められる）だが、ループが欲しがる数よりは
// はるかに下。
export const SAVES_IN_FLIGHT_PER_TAB = 8;
// ブラウザ全体: 多数のタブがそれぞれ自分の上限の下にいる場合のため。
export const SAVES_IN_FLIGHT_TOTAL = 16;

export interface SaveGateLimits {
  perTab?: number;
  total?: number;
}

export interface SaveGate<T> {
  // 待つべき保存: 新規のもの、すでに実行中の同一のもの、あるいは呼び出し
  // 元がこの要求を拒否すべきときは null。これ自身は何も開かない＝それを
  // 行うのは `start` で、拒否や合流のときは呼ばれない。
  admit(key: string, tabId: number | null, start: () => Promise<T>): Promise<T> | null;
  // 1つのタブについて実行中の数、またはタブを指定しない場合はブラウザ全
  // 体の数。拒否が書く診断行のために報告し、テストからも読む。
  inFlight(tabId?: number | null): number;
}

// 何をもって2つの要求を「同じ保存」とみなすか。画像 URL がその一部になっ
// ているのは、1つの投稿の保存を分けるのが画像だからだ＝同じ投稿の2枚の画
// 像は2件の保存であり、それが画像ごとのホバー保存ボタン（#334）の存在意
// 義そのものだが、同じ画像の2回は1件になる。
export function saveRequestKey(tabId: number | null, type: string, postUrl: string | null | undefined, imageUrls: readonly string[] = []): string {
  return JSON.stringify([tabId ?? null, type, postUrl || null, [...imageUrls].sort()]);
}

export function createSaveGate<T>({ perTab = SAVES_IN_FLIGHT_PER_TAB, total = SAVES_IN_FLIGHT_TOTAL }: SaveGateLimits = {}): SaveGate<T> {
  // 受理したすべての保存を、キーごとに。重複排除用の索引と合計数を1つの
  // 構造にまとめてあるので、2つが食い違うことは絶対にない。
  const running = new Map<string, { promise: Promise<T>; tab: number }>();
  const perTabCount = new Map<number, number>();
  // タブを持たない要求（拡張機能自身のページにはタブがない）も、何かに対
  // してカウントしなければならず、それらをまとめて数えるのが正しい＝どれ
  // も同じオリジンだから。
  const slot = (tabId: number | null | undefined) => (tabId == null ? -1 : tabId);

  return {
    admit(key, tabId, start) {
      const joined = running.get(key);
      if (joined) return joined.promise;

      const tab = slot(tabId);
      const held = perTabCount.get(tab) || 0;
      if (running.size >= total || held >= perTab) return null;

      perTabCount.set(tab, held + 1);
      const release = () => {
        running.delete(key);
        const left = (perTabCount.get(tab) || 1) - 1;
        if (left > 0) perTabCount.set(tab, left);
        else perTabCount.delete(tab);
      };

      let promise: Promise<T>;
      try {
        promise = start();
      } catch (error) {
        release(); // promise を返す前に例外を投げた経路でも、確実に手放す
        throw error;
      }
      running.set(key, { promise, tab });
      // どちらの結果でも解放し、どちらも unhandled rejection にはならな
      // い＝呼び出し元がこの戻り値の promise を保持して処理するため。
      promise.then(release, release);
      return promise;
    },

    inFlight(tabId) {
      if (tabId === undefined) return running.size;
      return perTabCount.get(slot(tabId)) || 0;
    },
  };
}

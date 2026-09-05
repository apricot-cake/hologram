// スピナーを表示している保存に対する、ページ側の終わらせ方。
//
// 保存を待つホバーボタンと一括取り込みバナーが1つのデッドラインを共有する。最初のバー
// ジョンはそれぞれにコピーされた一律のタイマーで、コピーは何をログに残す
// かの点ですでにばらばらになっていたからだ。
//
// これが区切るのは保存そのものではなく沈黙だ。保存は正当に遅いことがある
// （host はすべての原本をダウンロードする）ので、一律の上限は全区間の合
// 計を収めなければならない。これが最初のバージョンが90秒にたどり着いた経
// 緯であり、そもそも受理すらされなかった保存がスピナーの下に1分半も座り
// 続けていた理由だ。worker は各区間の境目ごとに1行送るので
// （SaveProgressMessage）、これは保存全体ではなく「次の1行」を待ち、尋ね
// る2つの問いはどちらも短い（deadline.ts）:
//
//   受理されたか？  SAVE_ACK_MS    — worker 側で何一つ動かなかった
//   静かになったか？ SAVE_STALL_MS — 動いた後、区間の間で止まった
//
// 受理の通知は、すべての経路が通る1つの合流点から送られるので、すでに実
// 行中の同一の保存に合流した保存（host-budget.ts）についても答えを返す。
// その合流が得られないのは実行中の保存の段階の行だ＝それらは最初の押下の
// saveId を運ぶので、合流した側は残りの待機時間について沈黙の上限にフォー
// ルバックする。同じ画像を2回押して、その保存が40秒を超えるケースでは、
// 成功する保存に対してタイムアウトを報告してしまうことになる。実測した中
// で最も重い保存は12.4秒であり、代替案はユーザーが狙うことすらできないこ
// のケースのために、すべての段階を待機者の集合へ配信するようゲートに教え
// 込むことになる。
import { SAVE_ACK_MS, SAVE_STALL_MS } from './deadline.ts';
import type { BackgroundToContentMessage } from './messages.ts';

export interface SaveDeadline {
  // 保存が終わった＝結果が届いた、または呼び出し元がそれを見限った。この
  // 呼び出しが終わらせた張本人なら true、デッドラインの方が先に来ていて、
  // 呼び出し元がすでに諦めた保存への遅れた答えを抱えているだけなら
  // false。
  settle(): boolean;
}

// 待機を始める。`giveUp` はタイマーから最大1回だけ呼ばれ、2つの上限のど
// ちらが尽きたかを示す capture.log 用の1行を伴う＝この区別こそが診断上の
// 価値の全てだ:「一度も受理されなかった」は死んだ worker、「静かになっ
// た」は、すでに通過を報告した区間で止まった生きている worker。
export function startSaveDeadline(saveId: string | null, giveUp: (error: string) => void): SaveDeadline {
  let settled = false;
  let acknowledged = false;
  let timer: ReturnType<typeof setTimeout>;

  function stop() {
    clearTimeout(timer);
    chrome.runtime.onMessage.removeListener(onProgress);
  }

  function expire() {
    if (settled) return;
    settled = true;
    stop();
    giveUp(acknowledged ? `save timed out — the background acknowledged it, then went quiet for ${SAVE_STALL_MS}ms` : `save timed out — the background never acknowledged it within ${SAVE_ACK_MS}ms`);
  }

  // この保存についての行なら何であれ待機をリセットする＝worker が生きて
  // 動いているということだけが計測対象だ。別の保存の進捗は何も語らない＝
  // 別のタブが問題なく保存できていることが、このスピナーを開いたままにす
  // る理由になってはいけない。
  function onProgress(message: BackgroundToContentMessage) {
    if (settled || message?.type !== 'saveProgress' || message.saveId !== saveId) return;
    acknowledged = true;
    clearTimeout(timer);
    timer = setTimeout(expire, SAVE_STALL_MS);
  }

  timer = setTimeout(expire, SAVE_ACK_MS);
  chrome.runtime.onMessage.addListener(onProgress);

  return {
    settle() {
      if (settled) return false;
      settled = true;
      stop();
      return true;
    },
  };
}

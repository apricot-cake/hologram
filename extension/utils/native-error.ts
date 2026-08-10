// `busy` は host からは絶対に来ない唯一の種類だ＝service worker が、その
// タブがすでに自分の持ち分だけ同時進行の保存を抱えているという理由でこの
// 保存の開始を拒んだ（#323 — host-budget.ts）。何も壊れておらず何も書き
// 込まれていないので、これは診断すべき不具合でもなければ得られない投稿で
// もない＝助言は「待つ」ことであり、だからこそ専用の種類が必要になる。
export type SaveFailureKind = 'host-missing' | 'host-unavailable' | 'origin-rejected' | 'post-unavailable' | 'timeout' | 'busy' | 'unknown';

// Native Messaging は失敗を安定したエラーコードではなく人間可読な
// runtime.lastError のテキストとして露出する。既知のマッチはあえて狭く保
// つ＝Chrome の文言が変わったときは、黙って誤った復旧手順にすり替わるの
// ではなく、安全な一般的メッセージへフォールバックしなければならない。
export function classifySaveFailure(message: unknown): SaveFailureKind {
  const text = String(message || '');

  // 不具合ではなく、しかも Chrome の文言でもなく自分たち自身の host の文
  // 言（#492）: 投稿そのものを取得できなかった（削除・凍結・非公開・年齢
  // 制限）ため、何も書き込まれていない。上のいくつかの失敗とは分けてあ
  // る。助言が正反対だからだ＝ここにはユーザーが直せるものは何もない。
  if (/^post unavailable/i.test(text)) {
    return 'post-unavailable';
  }

  if (/access to the specified native messaging host is forbidden|allowed[_ -]origins|origin.+(?:forbidden|not allowed|denied)/i.test(text)) {
    return 'origin-rejected';
  }

  if (/specified native messaging host.+not found|native messaging host.+not found|is it installed/i.test(text)) {
    return 'host-missing';
  }

  if (/error (?:when|while) communicating with the native messaging host|native (?:messaging )?host (?:disconnected|exited|timed out)|host has exited|failed to start (?:the )?native messaging host|access is denied|permission denied/i.test(text)) {
    return 'host-unavailable';
  }

  // 応答が来ずに諦めた区間（#507 — utils/deadline.ts）。あえて上の host の
  // マッチより後に置いている＝「Native host timed out」もタイムアウトの一
  // 種だが、ユーザーは「保存する側が静かになった」と分かれば行動できる
  // し、その助言はすでに書かれている。
  if (/timed out/i.test(text)) {
    return 'timeout';
  }

  return 'unknown';
}

// 保存の失敗がどのコンソールに属するか（#580）。console.error の行は
// chrome://extensions のエラーコンソールに積み上がっていくが、2つの種類
// はそこにいる資格がない＝それらは不具合ではなく保存の結果だからだ＝取得
// できなかった投稿（ユーザーが直せるものは何もない — #492/#505）と、タブ
// がすでに持ち分だけ同時進行を抱えていたために拒否された保存。
// console.error のままにしておくと、拡張機能が壊れているように見えるまで
// 積み上がってしまう。
export function saveFailureConsoleLevel(kind: SaveFailureKind): 'warn' | 'error' {
  return kind === 'post-unavailable' || kind === 'busy' ? 'warn' : 'error';
}

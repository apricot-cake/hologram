// UI をそもそも注入できなかったとき、拡張機能が何をするか（#269）。
//
// 保存済み一覧の右クリックメニューは chrome.scripting.executeScript に bulk.js をページへ
// 注入する。bulk.js がバナーを描くので、注入それ自体が失敗するとページ上には報告
// する面が一切ない＝クリックは完全に無反応になり、唯一の痕跡は
// capture.log の1行だけになる。service worker が所有していてまだ描ける唯
// 一のものがツールバーのアクションなので、警告はそこへ出す。
//
// この拡張機能を unpacked で動かした headless Chromium で実測した
// （2026-07-31、#269 のための probe 実行。以下の数字が、このファイルが
// 2026-07-25 の設計コメントの推測どおりの形ではなく今の形になっている理由
// だ）:
//
//   setBadgeText / setBadgeBackgroundColor / setBadgeTextColor / setTitle
//     はマニフェストの `action` 以外に何も要らず（新しい permission も不
//     要）service worker から動く。しかも拡張機能自身のファイルが読めなく
//     なった後でも動き続ける。
//   tabId で絞ったバッジは実際に絞られる: 別のタブは '' を読み、既定の
//     tooltip のままだった。グローバルなバッジも同様。
//   Chrome はそのタブが遷移すると、タブ単位のバッジとタイトルを自動で消
//     す。だから遷移時にはこちらが覚えているものを捨てるだけでよい。
//   fetch(chrome.runtime.getURL(...)) はパッケージが読める間は200を返
//     し、ディレクトリが消えると（"Failed to fetch" で）reject する＝この
//     2つの原因を見分ける唯一の誠実な方法だ。
//   その状態では chrome-extension://<id>/diag.html は
//     ERR_FILE_NOT_FOUND で失敗する。診断ページは、この issue の動機に
//     なった失敗に対するエスカレーション先には絶対になれない。診断ページ
//     に到達できるのはもう一方の分岐だけだ。
import { actionBadge } from './tokens.ts';

// 4文字というのは Chrome 自身のバッジテキストに対する指針で、これは印が
// 言える最小限のことを言っている＝何かを確認する必要がある。カウントでも
// ユーザーが選んだ状態でもないので、単語ではなく絵記号にしてある＝文とし
// ての説明は隣の tooltip の側にある。
const ALERT_BADGE = '!';

// 下の生存確認 probe をどれだけ待つか。拡張機能のローカルリソースの読み取
// りが意味のある時間ブロックすることはないが、失敗経路での無制限の
// await はまさに #507 が丸ごと1つの issue を使って取り除いた形そのものだ。
// この答えは文言をどちらにするか選ぶだけなので、タイムアウトは「パッケー
// ジは問題ないとみなす」と安全に読み替えられる。
const PROBE_TIMEOUT_MS = 2000;

// 呼び出し元が2つの状況のどちらにいるか。Chrome のエラー文言（その文言に
// 契約はない）からではなく、拡張機能自身のファイルがまだ読めるかどうか、
// つまり実際に違いを生んでいるものから分類する。
export type InjectFailureKind =
  // パッケージが読めない＝unpacked のルートが移動または削除された。以降
  // 呼び出しごとのファイル読み取りはすべて失敗するため、拡張機能をリロー
  // ドするまでクリックは死んだままになる。一方、常駐する content script は
  // 共有メモリから動き続け、拡張機能は健全に見えてしまう（issue を参照）。
  | 'package-unreadable'
  // パッケージは問題なく、このページが拒否した。Web Store、ポリシーでブ
  // ロックされたホスト、クリックの最中に消えたタブ。修復すべきものは何も
  // なく、誰かに何かをリロードしろと言う理由もない。
  | 'page-refused';

// 拡張機能は自身のファイルをまだ読めるか。文言はこの問いにかかっている。
// メッセージから推測するのではなく、これに答えられる唯一の方法で尋ねる。
export async function packageReadable(): Promise<boolean> {
  try {
    const res = await fetch(chrome.runtime.getURL('diag.html'), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

// probe するファイルとして diag.html を意図して選んでいる: これは読める
// 分岐がエスカレーション先とするページでもあるので、probe の成功はその
// まま「そのページは開ける」という事実になる。
export async function injectFailureKind(): Promise<InjectFailureKind> {
  return (await packageReadable()) ? 'page-refused' : 'package-unreadable';
}

// 同じタブでの2回目の失敗が、ユーザーをどこへ送るか。
//
// 最初の押下はツールバーに印を付けるだけ。1回の保存が始まらなかっただけ
// で別のタブへ送るのは、単にスクリプトを実行できないページだった可能性
// も十分ある以上やりすぎだ。連続して2回目の押下があったときこそ、明らか
// に試していて明らかに何も得られていない状態だと言える。
//
//   package-unreadable → chrome://extensions を、この拡張機能に絞って開
//     く。そこにある Reload ボタンこそが修復であり、それがまだ描画でき
//     る唯一のページだ＝拡張機能自身の diag.html は、そのファイルが読め
//     ない状態では読み込めない（上で実測済み）。
//   page-refused → 診断ページ。ページ側の拒否が何であれ、記録された
//     activate/fail の行を表示できる。
export function escalationUrl(kind: InjectFailureKind): string {
  return kind === 'package-unreadable' ? `chrome://extensions/?id=${chrome.runtime.id}` : chrome.runtime.getURL('diag.html?issue=inject');
}

// tooltip。2通りの文にしているのは、2つの原因が正反対の助言を必要とし、
// 一方の文言はもう一方の状況では嘘になるからだ＝Web Store がスクリプトを
// 拒否しただけなのに健全な拡張機能をリロードしろと言うのは、壊れていな
// いものを直せと送り出すことになる。
export function injectFailureTitle(kind: InjectFailureKind): string {
  return chrome.i18n.getMessage(kind === 'package-unreadable' ? 'actionInjectUnreadable' : 'actionInjectRefused');
}

// 1つのタブのツールバーアクションに警告を出す。どの呼び出しも fire-and
// -forget＝どれも保存を救えるものではなく、ここでの reject（尋ねている間
// にタブが閉じた）が最初の失敗の上に2つ目の失敗として積み重なってはいけ
// ない。
export function showInjectFailure(tabId: number, kind: InjectFailureKind): void {
  chrome.action.setBadgeText({ text: ALERT_BADGE, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: actionBadge.background, tabId }).catch(() => {});
  chrome.action.setBadgeTextColor({ color: actionBadge.text, tabId }).catch(() => {});
  chrome.action.setTitle({ title: injectFailureTitle(kind), tabId }).catch(() => {});
}

// それを下げる。
//
// 「この worker が付けた場合だけ」ではなく無条件に行う。service worker は
// どのアイドル時点でも殺され、記憶を持たずに戻ってくる。一方 Chrome は描
// くよう指示されたバッジを保持し続けるので、再起動後に最初に成功した注入
// だけが、このプロセスの誰も設定した覚えのない印を消す唯一の機会になる。
// マニフェスト自身の tooltip は、空文字列を渡す（それはリセットではなく
// 「文字数ゼロの tooltip」になる）のではなく、名前で復元している。
export function clearInjectFailure(tabId: number): void {
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  chrome.action.setTitle({ title: chrome.i18n.getMessage('actionTitle'), tabId }).catch(() => {});
}

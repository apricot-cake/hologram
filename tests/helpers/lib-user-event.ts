// コンテンツスクリプトを駆動する jsdom のスイート向けの、利用者自身の
// イベント。
//
// `dispatchEvent` は定義上「必ず」`isTrusted: false` を生む — それこそが
// #323 が丸ごと拠り所にしている区別であり、それ以来拡張機能の保存ハンドラは
// それ以外を無視する（extension/utils/user-gesture.ts）。だから素の
// イベントを dispatch するテストは、利用者ではなく「ページ」を演じている
// ことになる。
//
// どちらの役も必要とされている: ほとんどのスイートは利用者の押下が何を
// するかを問うが、番人自身のテストは悪意あるページの押下が何を「しない」
// かを問う。ここで利用者側に名前を付けておくことで、各スイートの中で
// その違いが見える状態を保つ — `asUser(...)` は利用者、素の
// `dispatchEvent` はページ — dispatch を全部あいまいなままにするのでは
// なく。
//
// なぜこう書かれているか。プラットフォームの2つの層が、まさにこの関数が
// やろうとしていることを止めるために存在しており、両方に対処しなければ
// ならない:
//
//   1. `isTrusted` は `[LegacyUnforgeable]` — すべてのイベントインスタンスが
//      持つ、自身の・再設定不能なプロパティ — なので defineProperty で
//      イベント自身の上のそれを置き換えることはできない。jsdom はその値を、
//      イベントが持つ唯一の自前シンボル経由で辿れる、そのゲッターの裏にある
//      裏付けオブジェクト上に保持している。
//   2. `dispatchEvent` は最初のステップとしてそれを false に「設定する」ので、
//      dispatch の前に書いた値は、どのリスナーが走る時点でも消えている。
//      だから値ではなくゲッター（そのステップを吸収する何もしないセッター
//      付き）にしてある。
//
// 出来上がるのは、拡張機能が本物のイベントと見分けられないイベントであり、
// それこそがこれを正しい代役たらしめている。実際のブラウザでの等価物は
// DevTools プロトコルの `Input.*` ドメインで、それは Playwright のスイート
// が駆動しているものであり、だからこそそちらはここからの助けを必要と
// しない。
export function asUser<E extends Event>(event: E): E {
  // jsdom 30 は実装オブジェクトを Event インスタンスのシンボルから外した。
  // テスト専用の内部 API を経由し、実ブラウザでは偽造不能な isTrusted を jsdom
  // の中だけで本物の入力の代役にする。
  const path = require('node:path');
  const jsdomInternals = path.join(path.dirname(require.resolve('jsdom')), 'generated', 'idl', 'utils.js');
  const { implForWrapper } = require(jsdomInternals);
  const impl = implForWrapper(event);
  if (!impl) throw new Error('asUser: jsdom のイベントではない — trusted の印を付ける裏付けオブジェクトが無い');
  Object.defineProperty(impl, 'isTrusted', { get: () => true, set: () => {}, configurable: true });
  return event;
}

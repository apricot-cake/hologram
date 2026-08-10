// 新しいローカルビルドが出来たとき、拡張機能が自分自身をリロードする（#650）。
//
// 何が問題だったか。この拡張機能は、著者が一日中使っているブラウザの中で開
// 発している＝日常使いの Chrome は extension/.output/chrome-mv3 を直接読み
// 込んでいて、同じフォルダに本番ビルドも入っている（docs/build.md）。その
// ため、コードを1行変えるたびに人間が chrome://extensions のリロードボタン
// を押す羽目になっていた。このページはこのプロジェクトのツール群があえて
// 一切操作しないページだ。
//
// どういう形にしたか、そしてなぜこれが独自発明ではないか。WXT 自身の dev
// モードも CRXJS も、同じやり方でこの問題を解いている＝ビルドが新しいバン
// ドルがディスク上にあることを拡張機能へ伝え、拡張機能は自分自身に対して
// chrome.runtime.reload() を呼び、それがディスクからマニフェストを読み直す
// （#650 で実測: バージョン・追加された permissions・追加された
// content_scripts はすべて反映される。chrome.storage.local・キーボード
// ショートカット・拡張機能 id はすべて生き残る）。ここで違うのは運び手だけ
// だ＝開発サーバーへの WebSocket の代わりに、この拡張機能がすでに行ってい
// る native messaging の往復にニュースを乗せる＝すべての保存、すべての
// バッジ問い合わせ、すべての中継されるログ行が、出力フォルダに置かれてい
// るビルドのトークンを刻印されて返ってくる（native-host/protocol.mts の
// DevBuildStamp）。新しいプロセスも新しいポートも新しい host 登録も要ら
// ず、日常使いのブラウザには元からある本番ビルド以外は何も増えない。
//
// いつ何もしないか＝ほとんど常にそうだ。独立した2つの門が両方開いている
// 必要がある＝このバンドルに build id（EXT_BUILD_ID。
// scripts/build-extension.cts が発行する）が与えられていること、そして
// host が同じスクリプトが書いた stamp ファイル
// （native-host/paths.mts の extensionBuildStampPath）を見つけられること。
// リリース済みでストアからインストールされた拡張機能が、リリース済みの
// host と話す場合はどちらも持たないため、下の比較は比べる2つの値をそもそ
// も持たない。
//
// このファイルが持っているのは chrome.* を一切含まない部分＝リロードが起
// きてよいのはいつかというルールだ。配線（応答から stamp を読み取り拡張機
// 能をリロードする部分）は background.ts にある。work とみなせるイベントを
// 見られるのは worker だけだからだ。

// scripts/build-extension.cts が Vite の `define` を通してセットする。それ
// 以外では誰もセットしない＝通常の `wxt build`（ストア用の成果物を作る
// `npm run zip:ext` が実行するもの）はこれを undefined のままにし、このモ
// ジュールを直接 import する Vitest の実行も同様。素の参照ではなく
// `typeof` を使うのは、未宣言の識別子への参照は ReferenceError になるが、
// `typeof` なら合法で 'undefined' を返すため＝それがそのまま「ローカルビル
// ドは存在しない」という答えになる。
declare const __EXT_BUILD_ID__: string | undefined;
export const EXT_BUILD_ID: string = typeof __EXT_BUILD_ID__ === 'undefined' ? '' : __EXT_BUILD_ID__ || '';

// worker が、自分の後を引き継ぐインスタンスへ書き残すメモの置き場。
// chrome.storage.local に置くのは、それが chrome.runtime.reload() を生き延
// びるものだからだ（#650 で実測）。storage.session は拡張機能がリロードされ
// る瞬間（このメモがまたがなければならないまさにその瞬間）を生き延びない。
export const DEV_RELOAD_STATE_KEY = 'devReload.v1';

export interface DevReloadState {
  // すでにリロードを1回使ってしまったトークン。ループを断ち切るための仕
  // 掛け＝新しいバンドルが実際にはそのトークンを持っていない場合（典型的な
  // 原因は、どのブラウザも出力を読み込んでいない別の作業ツリーでのビルド）、
  // 次の応答は永遠に同じリロードを求め続けてしまう。トークンごとに試行は1
  // 回だけとし、本当に新しいビルドだけが次の試行を解禁する。
  attempted?: string | null;
}

// 最後に work の証拠があってから、保留がどれだけ自力で生き延びるか。この設
// 計には無制限の状態がひとつもない＝報告が止まった activity は、これが過ぎ
// れば何であれ解放される。
//
// 60秒は最悪ケースのフルの保存1回分（crop 10秒＋メタデータ20秒＋host 30秒。
// deadline.ts）に余裕なくちょうど収まる長さで、「始まった保存はまだ実行中
// かもしれない」と言える誠実な下限だ。これを超えると、1分間誰も触っていな
// いキャプチャ UI は進行中の作業ではないし、1分間何も保存していない一括取
// り込みは行を使い果たしている。
export const DEV_RELOAD_WORK_MS = 60_000;

// リロードが発火してよくなるまでに、最後に何かが起きてから求める静けさ。一
// 括取り込み自身のペース配分（MIN_SAVE_PERIOD_MS = 1秒）を覆うのに十分な長
// さにしてあり、実行中の取り込みが2つの投稿の間で分断されないようにしつつ、
// 通常の保存の直後にはほぼ即座に新しいビルドが追いつく程度に短くもしてあ
// る。
export const DEV_RELOAD_QUIET_MS = 3_000;

// 今起きていて、リロードによって壊されてしまう1つの物事。何がどこで起きて
// いるかをキーにするため、同じタブ上の一括取り込みとキャプチャ UI は別々の
// 2つの保留になり、どちらも相手を終わらせられない。
export type DevReloadActivity = string;

export function captureActivity(tabId: number): DevReloadActivity {
  return `capture:${tabId}`;
}

export function bulkActivity(tabId: number): DevReloadActivity {
  return `bulk:${tabId}`;
}

export interface DevReloadGate {
  // 中断されうる何かが始まった、または継続中。保留の失効時刻を再セットする
  // ので、報告し続ける activity は保護され続け、静かになった activity は
  // DEV_RELOAD_WORK_MS 後に保護を失う。
  begin(activity: DevReloadActivity): void;
  // すでに開いている activity がまだ続いているという証拠を与える。開いてい
  // ない activity を新たに始めることはしない。一括取り込みは1秒に1投稿保
  // 存し、それぞれの保存が実行中であることの証拠になる。同じ保存が通常の
  // タブで起きても、始まってすらいない実行について何も証明しないので、そ
  // のために保留をでっちあげてはいけない。
  refresh(activity: DevReloadActivity): void;
  // …そして終わった。「今」ではなく通常の静けさの窓へフォールバックする＝
  // ちょうど終わったものには、たいてい次のものがすぐ続く（取り込みの次の
  // 投稿、ページがまだ描いているバナー）。
  end(activity: DevReloadActivity): void;
  // タブが消えた（遷移した、または閉じた）。そこで開いていたものは何であ
  // れタブと一緒に消えるので、もう存在しない work のために静けさの窓を用
  // 意してやる義理はない。
  dropTab(tabId: number): void;
  // activity ではないが「今はだめ」を意味する何かが起きた（保存を受理し
  // た、診断行を書いた）。
  touch(): void;
  // 今すぐリロードしてよいなら 0、そうでなければ次に問い合わせるべき時
  // 刻。now + DEV_RELOAD_WORK_MS より先の値を返すことは絶対にない。
  blockedUntil(): number;
}

export interface DevReloadGateDeps {
  now(): number;
  // worker 自身が保持している保存の数（host-budget.ts）。上の activity 群
  // とは別に数えているのは、worker がすでにこれを正確に追跡しているから
  // で、加えて保存のどの区間にもデッドラインがあるため＝この数字は、対応
  // するページが黙り込んだ後でも勝手に減っていく。
  savesInFlight(): number;
}

export function createDevReloadGate({ now, savesInFlight }: DevReloadGateDeps): DevReloadGate {
  const open = new Map<DevReloadActivity, number>();
  let quietUntil = 0;

  const forget = (t: number) => {
    for (const [activity, until] of open) {
      if (until <= t) open.delete(activity);
    }
  };

  return {
    begin(activity) {
      open.set(activity, now() + DEV_RELOAD_WORK_MS);
    },
    refresh(activity) {
      const t = now();
      if ((open.get(activity) ?? 0) > t) open.set(activity, t + DEV_RELOAD_WORK_MS);
    },
    end(activity) {
      open.delete(activity);
      quietUntil = Math.max(quietUntil, now() + DEV_RELOAD_QUIET_MS);
    },
    dropTab(tabId) {
      open.delete(captureActivity(tabId));
      open.delete(bulkActivity(tabId));
    },
    touch() {
      quietUntil = Math.max(quietUntil, now() + DEV_RELOAD_QUIET_MS);
    },
    blockedUntil() {
      const t = now();
      forget(t);
      let until = quietUntil > t ? quietUntil : 0;
      for (const [, deadline] of open) until = Math.max(until, deadline);
      // worker が保持している保存は、それがどのページから来たものであれ、
      // ページ側が何を通知していようがいまいが単独でブロックする＝ホバー
      // 保存ボタンとドロップゾーンは activity を一切開かない。固定時間で
      // 保持するのではなく静けさの窓ぶん後にもう一度問い合わせる形にして
      // いるのは、この数字が自然に減っていくからだ＝保存のどの区間にもデ
      // ッドラインがあるため（deadline.ts）、動作していようといまいと、枠
      // は取得から遅くとも約60秒後には解放される。
      if (savesInFlight() > 0) until = Math.max(until, t + DEV_RELOAD_QUIET_MS);
      return until;
    },
  };
}

// この応答の stamp はリロードを始めるべきか。配線から切り離して独立させて
// あるのは、これがルールの全体であり、しかも微妙に間違えやすいルールだか
// らだ。
//
//   - ローカル build id なし → このバンドルは dev スクリプトでビルドされて
//                              いない。比べるものがなく、リリース済みの拡
//                              張機能はこの経路を絶対に通ってはいけない。
//   - 応答に stamp なし     → host が stamp ファイルを見つけられなかった。
//                              答えは同じ。
//   - 両者が一致            → ブラウザはすでにディスク上のものを実行中。
//   - すでに試行済み        → まさにこのトークンに対してリロードを1回使
//                              い、それでも切り替わらなかった。
//                              DevReloadState.attempted を参照。
export function shouldReloadFor(hostBuild: string | null, ownBuild: string, attempted: string | null | undefined): boolean {
  if (!ownBuild || !hostBuild) return false;
  if (hostBuild === ownBuild) return false;
  return hostBuild !== attempted;
}

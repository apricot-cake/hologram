// Electron E2Eテスト一式の共有ランチャーハーネス。
//
// scripts/test-app-folder-dnd.cts――実際のポインタ入力で本物のElectronウィンドウを
// 動かした最初のケース（#41）――を一般化したものだ。サンドボックス化された設定ディレクトリ、
// シードしたライブラリ、`_electron.launch()`、クリックできるウィンドウ。あのケースが手で
// 組み立てなければならなかったものは、すべてここに集約されている。だからスペックは自分の
// フローだけを書けばよい。
//
// なぜ見えるウィンドウが要るのか。scripts/test-app-*.cts層はアプリを非表示で起動し
// （HOLOGRAM_SMOKE）、合成したDOMイベントを送る。それで状態とIPCには届くが、実際のクリック経路
// ――pointer-events、z-index、重なり、レイアウト――には決して届かないし、ピクセルにも届かない。
// このテスト一式はまさにその隙間のために存在するので、ウィンドウは画面上にあり、実際に
// コンポジットされていなければならない。
//
// それでもなぜ画面を奪わないのか。HOLOGRAM_START_INACTIVEはmainに、ウィンドウをアクティブ化
// せずに表示させ、z-orderの最下部に押しやらせる（index.tsのsendWindowToBack）。
// scripts/sandbox-app.ctsが受けているのと同じ扱いだ。Playwrightの入力はCDP経由で行くので
// ウィンドウにフォーカスは要らず、実行がキーボードの前にいる人からフォアグラウンドを
// 奪うことは決してない。
//
// なぜChromiumの起動スイッチが要るのか。z-orderの最下部にあるウィンドウは遮蔽された
// （occluded）ウィンドウであり、Chromiumの既定の振る舞いはそれに対してレンダラーを
// バックグラウンド化しタイマーを絞ることだ――これがレンダリングを止め、画面キャプチャを
// 永遠に待たせたままにしうる。Playwrightは自分が起動するどのブラウザにもこの同じ3つの
// スイッチを渡している。Electronアプリはこちらが起動するので、自分たちでこれを渡す。
// --force-device-scale-factor=1はDPIを固定する。これがないと、ある表示スケールで取った
// ベースラインが別のスケールと決して一致しない。

import { _electron, test as base } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIXTURE_POSTS, type FixturePost, seedFixtureLibrary } from './library.ts';
import { CONTENT_SIZE, WIDE_MIN_PX } from './viewport.ts';

const repoRoot = path.join(__dirname, '..', '..');
const appDir = path.join(repoRoot, 'app');
const { electronPath, buildArtifactError } = require(path.join(repoRoot, 'scripts', 'lib-electron-path.cts'));

// コンテンツボックスは今やviewport.tsのものであり、ここに書き直すのではなくレイアウト自身の
// ブレークポイントから計算する（#649）。specsがインポートするのはこのハーネスなので、
// ここで再エクスポートしている。
export { CONTENT_SIZE };

export interface LaunchOptions {
  /** シードする投稿。初回起動の空状態にしたいときは[]を渡す。既定値はFIXTURE_POSTS。 */
  posts?: FixturePost[];
  /** 解決済みのテーマ。config.jsonに書き込まれるので、mainが最初の描画にそれを渡す。 */
  theme?: 'light' | 'dark';
  /**
   * 表示言語の設定値。設定パネルが書き込むのと同じ形（#1057）。省略すると設定値は無い
   * ままになり、レンダラーは以下のHOLOGRAM_LANGに対して'auto'を解決する――他のどの
   * ケースもそれを求めている。ランナー自身の言語に依存せずもう一方の言語を得たいときは
   * 'en'を渡す。
   */
  language?: 'auto' | 'ja' | 'en';
  /** 投稿を入れた後、起動する前に追加でシードするもの（フォルダ、タグ種別など）。 */
  seed?: (ctx: { configDir: string; saveFolder: string }) => void;
}

export interface Hologram {
  app: ElectronApplication;
  page: Page;
  configDir: string;
  saveFolder: string;
  /** アプリのデータベースを開いて`fn`を実行する――永続化を検証するためのもの。 */
  readDb<T>(fn: (sqlite: any) => T): T;
  /**
   * 保存されたとおりの、投稿のユーザータグ。スペック側がスキーマの知識を持たずに済むよう
   * ここに置いている。
   */
  tagsOf(captureId: string): string[];
}

async function launch(options: LaunchOptions): Promise<{ hologram: Hologram; close: () => Promise<void> }> {
  // #463のガードを、ケースごとのOSエラーダイアログではなくテスト失敗として表面化させる
  // （electronPath()自体はワーカー全体を終了させてしまう）。
  const notBuilt = buildArtifactError();
  if (notBuilt) throw new Error(notBuilt);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-e2e-'));
  const configDir = path.join(tmp, 'Hologram');
  const saveFolder = path.join(tmp, 'library');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(saveFolder, { recursive: true });
  // themeはトップレベルの設定キーであり（mainはreadConfig().themeを読んでページに
  // ?theme=として渡す）、ここで固定することが最初の描画を決める――ウィンドウは
  // マシンのOS設定に対して'auto'を解決することが決してない。
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'e2etestextensionidabcdefghijklm', theme: options.theme ?? 'light', ...(options.language ? { language: options.language } : {}) }, null, 2));

  seedFixtureLibrary(configDir, saveFolder, options.posts ?? FIXTURE_POSTS);
  options.seed?.({ configDir, saveFolder });

  const app = await _electron.launch({
    executablePath: electronPath(),
    args: ['.', '--force-device-scale-factor=1', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    cwd: appDir,
    env: {
      ...process.env,
      // %APPDATA%も同様に、フォールバックの読み書きがすべてサンドボックス内に留まるように。
      APPDATA: tmp,
      HOLOGRAM_CONFIG_DIR: configDir,
      // ネイティブホストの登録をスキップする＝HKCUへの書き込みも、共有設定ディレクトリへの
      // コピーも起きない。実行は実際のライブラリにも、実際のChromeから見えるその姿にも
      // 触れない。
      HOLOGRAM_SANDBOX: '1',
      HOLOGRAM_START_INACTIVE: '1',
      // スペックは日本語のラベルでコントロールを探す。これが無いと言語はマシンのものになり、
      // en-USのCIランナーでは「言語が違う」ではなく「コントロールが見つからない」と
      // 読めてしまう（docs/testing.md）。
      HOLOGRAM_LANG: 'ja',
      // 日付はUTCの瞬間として保存され、ローカル時刻で描画されるので、インスペクタが
      // 「この投稿はいつ投稿されたか」と表示する内容はマシンのタイムゾーンが決める。
      // 言語を固定するのと同じ理由でここも固定する＝別タイムゾーンのランナーは
      // （正しくはあるが）別の日付を描画し、スペックはそのラベルを読んでいる。
      TZ: 'Asia/Tokyo',
    },
  });

  const page = await app.firstWindow();
  // サイズを合わせるのはウィンドウではなくCONTENTボックス＝フレームの寸法はOSの領分であり
  // マシンごとに違うが、スクリーンショットが写しているのはコンテンツボックスの方だ。
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), CONTENT_SIZE);
  // 「最初の描画が終わった」＝カードがグリッドのスロットに載ったか、ライブラリが空で
  // 代わりにプレースホルダーがその場所を占めたかのいずれか。
  await page.waitForFunction(() => !!document.querySelector('[data-slot="post-card"], [data-slot="empty-state"]'));
  // ……そして描画がブレークポイントのWIDE側で終わったこと。これはすべてのフローのケースが
  // 前提に書かれているレイアウトだ。CONTENT_SIZEはそれ以外にはなり得ないよう算出されている
  // （#649）が、要求どおりの結果になるとは限らない＝setContentSizeは作業領域にクランプ
  // されるので、要求より狭いディスプレイでは全ケースが黙ってnarrowレイアウトを渡されて
  // しまう。layout-mode.ts自身の数値から組み立てたメディアクエリとして問うので、これも
  // ブレークポイントに追従する――そして1つのスペックにつき1回ではなく、起動につき1回問う。
  // （アプリ自体はもうこの問いを立てない＝#975/#981以降、幅で形を変えるものはアプリの中に
  // 何一つ無い。答えにまだ依存しているのはこのテスト一式の方だ――グリッドの列数、カードの
  // インデックス、ピクセルのベースライン。）
  const side = await page.evaluate((bp) => ({ width: window.innerWidth, wide: matchMedia(`(min-width: ${bp}px)`).matches }), WIDE_MIN_PX);
  if (!side.wide) throw new Error(`E2E ウィンドウが narrow 側で起動しました（実測 ${side.width}px ／ wide の下限 ${WIDE_MIN_PX}px）。要求した ${CONTENT_SIZE.width}px が画面の作業領域に収まらなかったか、幅の算出がブレークポイントから外れています。`);

  const hologram: Hologram = {
    app,
    page,
    configDir,
    saveFolder,
    readDb(fn) {
      const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
      // #176: hologram.dbは今、configDirではなく保存フォルダの中にある（ADR 0025）。
      const handle = openDatabase(path.join(saveFolder, 'hologram.db'));
      try {
        return fn(handle.sqlite);
      } finally {
        handle.sqlite.close();
      }
    },
    tagsOf(captureId) {
      return hologram.readDb((sqlite) =>
        sqlite
          .prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY t.name')
          .all(captureId)
          .map((row: { name: string }) => row.name),
      );
    },
  };

  return {
    hologram,
    close: async () => {
      await app.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}

/**
 * `launchHologram(opts)`は呼び出しごとにサンドボックス化したアプリを1つ起動し、ケースが
 * 終わるとそれを片付ける。フィクスチャの値ではなく関数になっているのは、ケースによって
 * シードしたいものが違うからだ――中にはアプリを2回起動して、何かが再起動を生き延びたことを
 * 確かめるケースもある。
 */
export const test = base.extend<{ launchHologram: (options?: LaunchOptions) => Promise<Hologram> }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies out of this destructuring pattern; empty means "depends on nothing", and it is the form the framework documents
  launchHologram: async ({}, use) => {
    const running: Array<() => Promise<void>> = [];
    await use(async (options = {}) => {
      const { hologram, close } = await launch(options);
      running.push(close);
      return hologram;
    });
    for (const close of running) await close();
  },
});

export { expect } from '@playwright/test';

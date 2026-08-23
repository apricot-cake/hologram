// コマンドパレット（#28）の項目の登録＝登録簿へ入る中身の側。orchestrator.ts の切り出しの
// 1つで、他の *-builder.ts と同じく ctx を注入する形を取る（perform の実体は、設計どおり
// アプリの起動後に、依存を注入した閉包として登録される）。
//
// ここは「エンジンは1つ、面は3つ」が集まる場所でもある。旧 buildSuggest（検索ボックス向けの
// 候補を users.ts が作っていたもの）は、このファイルのコーパスの提供側へ吸収した＝タグや
// 投稿者の候補は、パレットでも検索ボックスでも同じ関数から来る。確定時の動作も searchbox の
// ブリッジの onPick（＝search-editing の pick を履歴のまとめで包んだもの）と共有するので、
// 「今のタブへ AND で足す」という振る舞いが面ごとにずれることはない。
import { type CommandEntry, registerCommands, registerProvider } from './command-registry.ts';
import { handlers as searchBoxHandlers } from './searchbox.ts';
import { setLayout, setPosterLayout } from './display.ts';
import { recentHistory } from './history.ts';
import { open as openHistoryPanel } from './history-panel.ts';
import { toggle as togglePanels } from './panels.ts';
import { open as openSettings } from './settings.ts';
import { store } from './store.ts';
import { hologramTabsSource } from './tabs.ts';

// deps はアプリが供給するもの（ライブラリの実データ、フォルダの一覧、タブの操作、クエリの
// リセットと適用、コピー）。settings / store / tabs / searchbox は状態を持たない本物の ES
// モジュールなので、直接 import する。folders.ts は直接 import しない。あちらは ipc と i18n を
// 引き込むので、このモジュール全体がスタブ無しでは読み込めなくなるため（deps を差し替える
// だけで項目の並びを単体で確かめられる状態を保っている）。
export interface CommandDeps {
  t(key: string): string;
  allPosts(): HologramPost[];
  buildUsers(): HologramUserAgg[];
  listFolders(): HologramFolder[];
  folderPath(id: string): string;
  addTab(): void;
  /** #21: タグ管理のページのタブを開く（既にあれば焦点を移す）。 */
  openTagManagementTab(): void;
  /** #145: 履歴の行のビューへ直接飛ぶ（パレットの履歴の節＝飛ぶだけで、削除も日付の見出しも無い。それらはパネルの仕事のまま）。 */
  openHistoryEntry(e: HologramNavEntry): void;
  switchTab(id: string): void;
  resetAllFilters(): void;
  resetPosterFilters(): void;
  browseTo(mode: string): void;
  openFolder(id: string): void;
  /** 投稿者ビューのタグの語彙（一般タグと、作品／キャラ）。件数は、今の絞り込みを当てた後の投稿者の数。 */
  posterTagRows(): { value: string; count: number }[];
  /** 投稿者ビューのフォルダの一覧。 */
  posterFolderRows(): { id: string; name: string }[];
  /** 投稿者ビューのクエリへ条件を1つ足す。 */
  posterAddFilter(filter: { type: string; value: string; label?: string }): void;
}

export function makeCommands(deps: CommandDeps): void {
  const { t } = deps;

  // --- 操作の項目（固定の項目） ---------------------------------------------------------
  // モードによって行き先が変わる項目も、出し入れはしない＝分岐は perform の側でやる。だから
  // 同じ名前の項目が、今のモード次第で現れたり消えたりすることはない（「探したのに無かった」が
  // 起きない）。
  const commands: CommandEntry[] = [
    { id: 'cmd:settings', section: 'command', title: t('cmdOpenSettings'), perform: () => openSettings() },
    { id: 'cmd:new-tab', section: 'command', title: t('cmdNewTab'), hint: 'Ctrl+T', perform: () => deps.addTab() },
    { id: 'cmd:manage-tags', section: 'command', title: t('cmdManageTags'), perform: () => deps.openTagManagementTab() },
    // #145: 履歴のパネルを開く（3つある入り口の3つ目＝サイドバーのフッタの行／Ctrl+H／この行）。
    { id: 'cmd:history', section: 'command', title: t('cmdOpenHistory'), hint: 'Ctrl+H', perform: () => openHistoryPanel() },
    {
      id: 'cmd:clear-filters',
      section: 'command',
      title: t('cmdClearFilters'),
      perform: () => (store.getState().browseMode === 'posters' ? deps.resetPosterFilters() : deps.resetAllFilters()),
    },
    {
      id: 'cmd:view-grid',
      section: 'command',
      title: t('cmdViewGrid'),
      // 動かすのは配置の軸だけ＝「正方形のサムネ」「情報を表示」のスイッチには触れない
      // （#618/#630 の直交したキーへの分割。パレットは表示の状態を覚える面ではない）。
      perform: () => (store.getState().browseMode === 'posters' ? setPosterLayout(false) : setLayout(false)),
    },
    {
      id: 'cmd:view-list',
      section: 'command',
      title: t('cmdViewList'),
      perform: () => (store.getState().browseMode === 'posters' ? setPosterLayout(true) : setLayout(true)),
    },
    // 表示・非表示の一括切り替え（#245）。名前は状態ではなく操作を言う＝パレットの行が、
    // 開いた瞬間の状態に合わせて書き換わることはない（「隠す」と「戻す」の間で入れ替わる行は、
    // 検索して見つけられない）。
    { id: 'cmd:toggle-panels', section: 'command', title: t('cmdTogglePanels'), hint: 'Ctrl+Shift+B', perform: () => togglePanels() },
    { id: 'cmd:browse-posts', section: 'command', title: t('cmdBrowsePosts'), perform: () => deps.browseTo('posts') },
    { id: 'cmd:browse-posters', section: 'command', title: t('cmdBrowsePosters'), perform: () => deps.browseTo('posters') },
    // ゴミ箱も行き先の1つ（#268）＝上の2行と同じ扱いで、サイドバーに常設されている行き先は
    // パレットにも出す。
    { id: 'cmd:browse-trash', section: 'command', title: t('cmdBrowseTrash'), perform: () => deps.browseTo('trash') },
  ];
  registerCommands('commands', commands);

  // --- タブの切り替え ---------------------------------------------------------------
  // 表示名は、タブの帯そのものと同じ計算から取る（tabs.ts が導くタイトル）＝だからパレットに
  // 出る名前が、帯に出る名前と食い違うことはない。今のタブは並べない（switchTab はそれに
  // 対して即座に返す＝押しても何もしない行になってしまう）。
  registerProvider({
    id: 'tabs',
    entries: () => {
      const model = hologramTabsSource.get();
      if (!model) return [];
      return model.tabs
        .filter((tab) => !tab.active)
        .map((tab) => ({
          id: `tab:${tab.id}`,
          section: 'tab' as const,
          title: tab.title,
          perform: () => deps.switchTab(tab.id),
        }));
    },
  });

  // --- 履歴への素早い移動（#145。Chrome のオムニボックスの @history に当たるもの） ----
  // クエリが空でない時だけ出す。理由は下の 'corpus' と同じで、recentHistory() はこの
  // セッションの訪問しか持たない（services/history.ts の環状バッファで上限あり＝同期の
  // 提供側から DB へ往復しない）。だから無条件に並べると、意図した「最近」の一覧ではなく、
  // 恣意的で欠けのある切り取りになる。Issue の 2026-08-02 の追記は、削除と日付の見出しが
  // パネルの仕事のままだと明言している＝この節は飛ぶためだけの近道で、それ以上のものではない。
  registerProvider({
    id: 'history',
    entries: (query) => {
      if (!query.trim()) return [];
      return recentHistory().map((row) => ({
        id: `history:${row.id}`,
        section: 'history' as const,
        title: row.title,
        keywords: row.u,
        perform: () => deps.openHistoryEntry({ u: row.u, kind: row.kind as HologramNavEntry['kind'], state: row.state as HologramNavEntry['state'] }),
      }));
    },
  });

  // --- 移動先の候補（タグ／投稿者／フォルダ） ---------------------------------------
  // 旧 buildSuggest の中身がここにある。クエリが空の時は列挙しない＝タグも投稿者も数千件に
  // なるし、開いた瞬間にそれを全部並べる面はどこにも無い（絞り込みは丸ごと queryEntries の
  // 仕事なので、ここは母集団を返せばよい）。
  //
  // 確定時の動作は、検索ボックスの候補と同じ onPick（今のタブへ AND で足す）。ブリッジは遅延
  // させて引くので、この提供側の登録が、orchestrator の初期化が既に終わっていることを保証
  // する必要は無い（searchbox のブリッジが既に取っているのと同じ作法）。
  const pick = (kind: string, value: string, label: string) => {
    searchBoxHandlers()?.onPick({ kind, value, label });
  };
  // 語彙は、今出ているビューのもの＝投稿を見ている間は投稿のタグと投稿者、投稿者を見ている
  // 間は投稿者のタグとフォルダ（#148）。同じ「タグ」というラベルでも、引く語彙もクエリの木も
  // 違うので、混ぜると押しても何もしない候補が生まれる（投稿者ビューから投稿側のクエリを
  // 編集する行）。ここをモードで切り替わる2つの提供側に分けてあるから、節の並びと順序は
  // 1つの queryEntries を通り続けられる（面ごとに候補の生成を増やさずに済む）。
  const posters = () => store.getState().browseMode === 'posters';
  registerProvider({
    id: 'corpus',
    entries: (query) => {
      if (!query.trim() || posters()) return [];
      const out: CommandEntry[] = [];
      const counts = new Map<string, number>();
      for (const p of deps.allPosts()) if (p.url) for (const tag of p.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
      for (const [tag, count] of counts) {
        out.push({ id: `tag:${tag}`, section: 'tag', title: tag, hint: String(count), weight: count, filter: { type: 'tag', value: tag }, perform: () => pick('tag', tag, tag) });
      }
      for (const u of deps.buildUsers()) {
        const label = u.displayName || u.screenName || t('cmdUnknownUser');
        out.push({
          id: `user:${u.key}`,
          section: 'user',
          title: label,
          keywords: u.screenName || undefined,
          hint: String(u.count),
          weight: u.count,
          filter: { type: 'user', value: u.key, label },
          perform: () => pick('user', u.key, label),
        });
      }
      for (const f of deps.listFolders()) {
        // 入れ子のフォルダは名前が重なりうるので、名前には経路の表示（「親 / 子」）を使う。
        // filter は付けない。フォルダは「場所」＝行き先であり、確定は単なる条件の追加ではなく、
        // 投稿ビューへ切り替えて現在地を開く1つのまとまった行為だから（openFolder が持つ）。
        out.push({ id: `folder:${f.id}`, section: 'folder', title: deps.folderPath(f.id) || f.name, keywords: f.name, perform: () => deps.openFolder(f.id) });
      }
      return out;
    },
  });
  registerProvider({
    id: 'poster-corpus',
    entries: (query) => {
      if (!query.trim() || !posters()) return [];
      const out: CommandEntry[] = [];
      for (const row of deps.posterTagRows()) {
        out.push({ id: `poster-tag:${row.value}`, section: 'tag', title: row.value, hint: String(row.count), weight: row.count, filter: { type: 'tag', value: row.value }, perform: () => deps.posterAddFilter({ type: 'tag', value: row.value }) });
      }
      for (const f of deps.posterFolderRows()) {
        // 投稿者ビューのフォルダは posterQB の単一選択のファセット（既存のものを置き換える）＝
        // 投稿側の「場所へ移る」と違い、ここに留まったまま条件が1つ入れ替わるだけなので、
        // こちらは filter を持つ。
        out.push({ id: `poster-folder:${f.id}`, section: 'folder', title: f.name, filter: { type: 'folder', value: f.id }, perform: () => deps.posterAddFilter({ type: 'folder', value: f.id }) });
      }
      return out;
    },
  });
}

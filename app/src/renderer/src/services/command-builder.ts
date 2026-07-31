// コマンドパレット（#28）のエントリ登録＝レジストリに入る中身の側。orchestrator.ts の
// 分解スライスの1つで、他の *-builder.ts と同じ ctx 注入の形をとる（perform の実体は
// アプリ起動後に依存注入済みクロージャとして登録される、という設計どおり）。
//
// ここが「エンジンは1つ・面は3つ」の合流点でもある。旧 buildSuggest（users.ts の
// 検索ボックス用サジェスト生成）はこのファイルの corpus provider に吸収した＝タグ・
// 投稿者の候補はパレットと検索ボックスで同じ関数から出る。確定したときの動作も
// searchbox 橋の onPick（＝search-editing の pick を履歴コアレスで包んだもの）を
// 共有するので、「現在のタブに AND 追加」という挙動が面ごとにズレない。
import { type CommandEntry, registerCommands, registerProvider } from './command-registry.ts';
import { handlers as searchBoxHandlers } from './searchbox.ts';
import { setLayout, setPosterLayout } from './display.ts';
import { toggle as togglePanels } from './panels.ts';
import { toggle as togglePrivacyMode } from './privacy-mode.ts';
import { open as openSettings } from './settings.ts';
import { hologramTabsSource } from './tabs.ts';

// deps＝アプリが供給するもの（ライブラリの実体・フォルダ一覧・タブ操作・クエリの
// リセット/適用・現在のモード・文言）。settings / store / tabs / searchbox は状態を
// 持たない real ES module なので直 import する。folders.ts を直 import しないのは、
// あれが ipc/i18n を引き込む＝このモジュールごとスタブ無しでは読めなくなるため
// （エントリの顔ぶれは deps だけ差し替えれば単体で確かめられる状態を保つ）。
export interface CommandDeps {
  t(key: string): string;
  allPosts(): HologramPost[];
  buildUsers(): HologramUserAgg[];
  listFolders(): HologramFolder[];
  folderPath(id: string): string;
  getBrowseMode(): string;
  addTab(): void;
  switchTab(id: string): void;
  resetAllFilters(): void;
  resetPosterFilters(): void;
  browseTo(mode: string): void;
  applyFolderFilter(id: string): void;
  /** 投稿者ビューのタグ語彙（一般タグ＋作品/キャラ）。件数は現在の絞り込み後の投稿者数。 */
  posterTagRows(): { value: string; count: number }[];
  /** 投稿者ビューのフォルダ一覧。 */
  posterFolderRows(): { id: string; name: string }[];
  /** 投稿者ビューのクエリへ条件を1つ足す。 */
  posterAddFilter(filter: { type: string; value: string; label?: string }): void;
}

export function makeCommands(deps: CommandDeps): void {
  const { t } = deps;

  // --- 操作系（固定エントリ） ---------------------------------------------------
  // モードで宛先が変わるものは entries を出し入れせず perform 側で分岐する＝同じ名前の
  // 項目が現在のモードによって消えたり現れたりしない（探しても無い、が起きない）。
  const commands: CommandEntry[] = [
    { id: 'cmd:settings', section: 'command', title: t('cmdOpenSettings'), perform: () => openSettings() },
    { id: 'cmd:new-tab', section: 'command', title: t('cmdNewTab'), hint: 'Ctrl+T', perform: () => deps.addTab() },
    {
      id: 'cmd:clear-filters',
      section: 'command',
      title: t('cmdClearFilters'),
      perform: () => (deps.getBrowseMode() === 'posters' ? deps.resetPosterFilters() : deps.resetAllFilters()),
    },
    {
      id: 'cmd:view-grid',
      section: 'command',
      title: t('cmdViewGrid'),
      // レイアウト軸だけを動かす＝正方形サムネ／情報を表示のスイッチには触らない
      // （#618・#630 の直交キー化。パレットは表示の記憶を持つ面ではない）。
      perform: () => (deps.getBrowseMode() === 'posters' ? setPosterLayout(false) : setLayout(false)),
    },
    {
      id: 'cmd:view-list',
      section: 'command',
      title: t('cmdViewList'),
      perform: () => (deps.getBrowseMode() === 'posters' ? setPosterLayout(true) : setLayout(true)),
    },
    // 一括表示トグル（#245）。名前は状態を言わず動作だけを言う＝パレットの行は開いた
    // 瞬間の状態で書き換わらない（「隠す」と「戻す」が入れ替わる行は探して見つからない）。
    { id: 'cmd:toggle-panels', section: 'command', title: t('cmdTogglePanels'), hint: 'Ctrl+Shift+B', perform: () => togglePanels() },
    // #88: 一括ぼかしの切り替え。名前は状態を言わず動作だけを言う＝上の一括表示トグルと同じ理由。
    { id: 'cmd:toggle-privacy', section: 'command', title: t('cmdTogglePrivacy'), hint: 'P', perform: () => togglePrivacyMode() },
    { id: 'cmd:browse-posts', section: 'command', title: t('cmdBrowsePosts'), perform: () => deps.browseTo('posts') },
    { id: 'cmd:browse-posters', section: 'command', title: t('cmdBrowsePosters'), perform: () => deps.browseTo('posters') },
    // ゴミ箱も行き先の1つ（#268）＝サイドバーに常設された destination はパレットにも
    // 並ぶ、という上2行と同じ扱い。
    { id: 'cmd:browse-trash', section: 'command', title: t('cmdBrowseTrash'), perform: () => deps.browseTo('trash') },
  ];
  registerCommands('commands', commands);

  // --- タブ切替 ---------------------------------------------------------------
  // 表示名はタブ帯そのものと同じ計算（tabs.ts の派生タイトル）から採る＝パレットに出る
  // 名前と帯に出ている名前が食い違わない。現在のタブは出さない（switchTab が即 return
  // する＝押しても何も起きない行になる）。
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

  // --- ジャンプ候補（タグ・投稿者・フォルダ） -----------------------------------
  // 旧 buildSuggest の中身がここ。空クエリでは列挙しない＝タグと投稿者は数千件あり、
  // 開いた瞬間に全部並べる面は存在しない（絞り込みは queryEntries が一手に引き受ける
  // ので、ここは母集合を返すだけでよい）。
  //
  // 確定動作は検索ボックスのサジェストと同一の onPick（現在のタブに AND 追加）。橋を
  // 遅延で引くのは、この provider が登録される時点で orchestrator の初期化が終わって
  // いる保証を要らなくするため（searchbox 橋の既存作法と同じ）。
  const pick = (kind: string, value: string, label: string) => {
    searchBoxHandlers()?.onPick({ kind, value, label });
  };
  // 語彙は見ているビューのもの＝投稿を見ている間は投稿のタグ・投稿者、投稿者を見て
  // いる間は投稿者のタグ・フォルダ（#148）。同じ「タグ」でも別の語彙・別のクエリ木で、
  // 混ぜると押しても何も起きない候補（投稿者ビューで投稿側のクエリを編集する行）に
  // なる。provider を2本に割って mode で出し分けるのは、セクションの顔ぶれと並びを
  // 1つの queryEntries に通したままにするため（面ごとの候補生成を増やさない）。
  const posters = () => deps.getBrowseMode() === 'posters';
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
        // 入れ子のフォルダは同名がありうるのでパス表示（「親 / 子」）を名前にする。
        // filter を持たせないのは、フォルダが「場所」＝行き先で、確定は単なる条件追加で
        // なく「投稿ビューへ移って既存のフォルダ条件を置き換える」ひとまとまりだから
        // （applyFolderFilter がその全部を持っている）。
        out.push({ id: `folder:${f.id}`, section: 'folder', title: deps.folderPath(f.id) || f.name, keywords: f.name, perform: () => deps.applyFolderFilter(f.id) });
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
        // 投稿者ビューのフォルダは posterQB の択一ファセット（既存を置換）＝投稿側の
        // 「場所へ移る」とは違い、ここに居たまま条件が1つ入れ替わるだけなので filter を持つ。
        out.push({ id: `poster-folder:${f.id}`, section: 'folder', title: f.name, filter: { type: 'folder', value: f.id }, perform: () => deps.posterAddFilter({ type: 'folder', value: f.id }) });
      }
      return out;
    },
  });
}

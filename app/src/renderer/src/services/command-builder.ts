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
import { setLayout } from './display.ts';
import { toggle as togglePanels } from './panels.ts';
import { open as openSettings } from './settings.ts';
import { set as storeSet } from './store.ts';
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
      // レイアウト軸だけを動かす＝正方形サムネ／情報を表示の2スイッチには触らない
      // （#618 の直交キー化。パレットは表示の記憶を持つ面ではない）。
      perform: () => (deps.getBrowseMode() === 'posters' ? storeSet('posterView', 'card') : setLayout(false)),
    },
    {
      id: 'cmd:view-list',
      section: 'command',
      title: t('cmdViewList'),
      perform: () => (deps.getBrowseMode() === 'posters' ? storeSet('posterView', 'list') : setLayout(true)),
    },
    // 一括表示トグル（#245）。名前は状態を言わず動作だけを言う＝パレットの行は開いた
    // 瞬間の状態で書き換わらない（「隠す」と「戻す」が入れ替わる行は探して見つからない）。
    { id: 'cmd:toggle-panels', section: 'command', title: t('cmdTogglePanels'), hint: 'Ctrl+Shift+B', perform: () => togglePanels() },
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
  registerProvider({
    id: 'corpus',
    entries: (query) => {
      if (!query.trim()) return [];
      const out: CommandEntry[] = [];
      const counts = new Map<string, number>();
      for (const p of deps.allPosts()) if (p.url) for (const tag of p.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
      for (const [tag, count] of counts) {
        out.push({ id: `tag:${tag}`, section: 'tag', title: tag, hint: String(count), weight: count, perform: () => pick('tag', tag, tag) });
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
          perform: () => pick('user', u.key, label),
        });
      }
      for (const f of deps.listFolders()) {
        // 入れ子のフォルダは同名がありうるのでパス表示（「親 / 子」）を名前にする。
        out.push({ id: `folder:${f.id}`, section: 'folder', title: deps.folderPath(f.id) || f.name, keywords: f.name, perform: () => deps.applyFolderFilter(f.id) });
      }
      return out;
    },
  });
}

import type { Translate } from './translation.ts';
// 検索欄とフィルタ入力へタグ・投稿者・フォルダの候補を供給する。
import { type SearchSuggestion, registerProvider } from './search-suggestions.ts';
import { handlers as searchBoxHandlers } from './searchbox.ts';
import { store } from './store.ts';
export interface SearchSuggestionDeps {
  t: Translate;
  allPosts(): HologramPost[];
  buildUsers(): HologramUserAgg[];
  listFolders(): HologramFolder[];
  folderPath(id: string): string;
  openFolder(id: string): void;
  /** 投稿者ビューのタグの語彙（一般タグと、作品／キャラ）。件数は、今の絞り込みを当てた後の投稿者の数。 */
  posterTagRows(): { value: string; count: number }[];
  /** 投稿者ビューのフォルダの一覧。 */
  /** 投稿者ビューのクエリへ条件を1つ足す。 */
  posterAddFilter(filter: { type: string; value: string; label?: string }): void;
}

export function registerSearchSuggestions(deps: SearchSuggestionDeps): void {
  const { t } = deps;
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
      const out: SearchSuggestion[] = [];
      const counts = new Map<string, number>();
      for (const p of deps.allPosts()) if (p.url) for (const tag of p.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
      for (const [tag, count] of counts) {
        out.push({ id: `tag:${tag}`, section: 'tag', title: tag, hint: String(count), weight: count, filter: { type: 'tag', value: tag }, perform: () => pick('tag', tag, tag) });
      }
      for (const u of deps.buildUsers()) {
        const label = u.displayName || u.screenName || t('unnamedUser');
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
      const out: SearchSuggestion[] = [];
      for (const row of deps.posterTagRows()) {
        out.push({ id: `poster-tag:${row.value}`, section: 'tag', title: row.value, hint: String(row.count), weight: row.count, filter: { type: 'tag', value: row.value }, perform: () => deps.posterAddFilter({ type: 'tag', value: row.value }) });
      }
      return out;
    },
  });
}

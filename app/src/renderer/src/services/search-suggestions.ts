import { matchingIds } from './search-results.ts';
// 検索欄とフィルタ入力が共有する候補の登録・順位付け。

export type SuggestionSection = 'tag' | 'user' | 'folder';

export interface SearchSuggestion {
  id: string;
  section: SuggestionSection;
  title: string;
  /** title 以外に照合する文字列（例: ポスターのスクリーンネーム）。 */
  keywords?: string;
  screenName?: string;
  /** 行の右端に薄く表示する補助テキスト（ショートカット表記、件数、パス）。 */
  hint?: string;
  /** 同じスコア帯の中での順位（タグの使用回数、ポスターの投稿数）。 */
  weight?: number;
  /** 確定時に追加する絞り込み条件。フォルダへの移動は perform() を使う。 */
  filter?: { type: string; value: string; label?: string };
  perform(): void;
}

export interface SuggestionProvider {
  id: string;
  /** 検索時点の候補を返す。順位付けは queryEntries が行う。 */
  entries(query: string): SearchSuggestion[];
}

export interface SuggestionGroup {
  section: SuggestionSection;
  items: SearchSuggestion[];
}

// 見出しが現れる順序。スコアはセクションの「中で」順位付けする――セクション
// 自体が入れ替わることは決してない（アクション型セクションがタグの下に
// 滑り込んだら、「ここで何ができるか」が読めなくなってしまう）。
const SECTION_ORDER: readonly SuggestionSection[] = ['tag', 'user', 'folder'];

const providers = new Map<string, SuggestionProvider>();

/** 動的なエントリ（タグ／投稿者／フォルダ）をプロバイダとして登録する。 */
export function registerProvider(provider: SuggestionProvider): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

/** テスト用: すべての登録を落とす（製品コードから呼ばれることは無い）。 */
export function resetProviders(): void {
  providers.clear();
}

export interface QueryOptions {
  /** 表示するセクション（画面ごとのラインナップ）。省略で全部。 */
  sections?: readonly SuggestionSection[];
  /** セクションごとの上限（画面ごとの件数）。省略で無制限。 */
  limit?: Partial<Record<SuggestionSection, number>>;
}

/**
 * セクションごとにまとめた候補を返す。どの画面もこの1つの関数を通る――
 * 順序とマッチングのセマンティクスは共有される。
 */
export function queryEntries(query: string, opts?: QueryOptions): SuggestionGroup[] {
  const entries = [...providers.values()].flatMap((provider) => provider.entries(query)).sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const ids = query.trim()
    ? matchingIds(
        'suggestions',
        query,
        entries.map(({ id, title, keywords, screenName }) => ({ id, title, keywords, screenName })),
      )
    : new Set(entries.map((e) => e.id));
  const rank = new Map([...ids].map((id, i) => [id, i]));
  return SECTION_ORDER.filter((section) => !opts?.sections || opts.sections.includes(section))
    .map((section) => {
      const items = entries.filter((e) => e.section === section && ids.has(e.id));
      items.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || (b.weight || 0) - (a.weight || 0));
      return { section, items: opts?.limit?.[section] == null ? items : items.slice(0, opts.limit[section]) };
    })
    .filter((group) => group.items.length);
}

// 検索欄とフィルタ入力が共有する候補の登録・順位付け。
import { compile, normalize } from './search.ts';
export type SuggestionSection = 'tag' | 'user' | 'folder';

export interface SearchSuggestion {
  id: string;
  section: SuggestionSection;
  title: string;
  /** title 以外に照合する文字列（例: ポスターのスクリーンネーム）。 */
  keywords?: string;
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

const SCORE_EXACT = 4;
const SCORE_PREFIX = 3;
const SCORE_SUBSTRING = 2;
const SCORE_TERMS = 1;
const SCORE_ANY = 0; // empty query = every entry ties
const NO_MATCH = -1;

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

/**
 * 1つのエントリのスコア。title と keywords のうちより一致するほうを採る。
 * nq / matcher は呼び出し側が一度だけ組み立てる（描画のたびに再コンパイル
 * しない）。
 */
export function scoreEntry(entry: SearchSuggestion, nq: string, matcher: (hay: string) => boolean): number {
  if (!nq) return SCORE_ANY;
  let best = NO_MATCH;
  for (const field of [entry.title, entry.keywords]) {
    if (!field) continue;
    const nh = normalize(field);
    const s = nh === nq ? SCORE_EXACT : nh.startsWith(nq) ? SCORE_PREFIX : nh.includes(nq) ? SCORE_SUBSTRING : matcher(field) ? SCORE_TERMS : NO_MATCH;
    if (s > best) best = s;
  }
  return best;
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
  const nq = normalize(query).trim();
  const matcher = compile(query);
  const wanted = opts?.sections;
  // 登録順を、同点のときの最終的な同順位判定に使う（同じ入力は常に同じ順序になる）。
  const buckets = new Map<SuggestionSection, { entry: SearchSuggestion; score: number; seq: number }[]>();
  let seq = 0;
  for (const provider of providers.values()) {
    for (const entry of provider.entries(query)) {
      if (wanted && !wanted.includes(entry.section)) continue;
      const score = scoreEntry(entry, nq, matcher);
      if (score === NO_MATCH) continue;
      const bucket = buckets.get(entry.section);
      if (bucket) bucket.push({ entry, score, seq: seq++ });
      else buckets.set(entry.section, [{ entry, score, seq: seq++ }]);
    }
  }
  const groups: SuggestionGroup[] = [];
  for (const section of SECTION_ORDER) {
    const bucket = buckets.get(section);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => b.score - a.score || (b.entry.weight || 0) - (a.entry.weight || 0) || a.seq - b.seq);
    const cap = opts?.limit?.[section];
    groups.push({ section, items: (cap == null ? bucket : bucket.slice(0, cap)).map((r) => r.entry) });
  }
  return groups;
}

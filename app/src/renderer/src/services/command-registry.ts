// コマンドパレット（#28）の供給源＝候補の唯一のレジストリ。
//
// 「タイプ→種別候補」のエンジンは1つ・面は3つ（検索ボックスのサジェスト／パレット／
// #148 のチップ帯インライン入力）という方針の土台。候補の生成はここに集約し、面ごとに
// 変えるのは「どのセクションを何件見せるか」と「確定したときの既定動作」だけ＝顔ぶれ・
// 並び・種別ラベルが面ごとにズレない。
//
// 形は settings.ts / searchbox.ts と同じ real ES module（named exports）で、window 経由に
// しない。開閉状態もこのモジュールが持つ（純状態＝open / close / isOpen / subscribe。
// callback はストアに置かないという既存規約に従う）。島は useSyncExternalStore で購読する。
//
// フィルタ系（タグ・投稿者・フォルダへのジャンプ）も操作系（設定・新規タブ・…）も
// perform() 1本に正規化してあり、型を分けず差は section だけにしてある。perform の実体は
// アプリ起動後に依存注入済みクロージャとして command-builder.ts が登録する。
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { compile, normalize } from './search.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isManagerOpen as folderManagerIsOpen } from './folders.ts';

// section は「見出し」であり、種別で挙動を分けるための型ではない。
// 'folder' は設計コメントが 'collection' と書いていた枠＝コレクションがサイドバーの
// フォルダ一覧になった（2026-07-04）後もそのまま残っていた旧名で、コード側の語彙
// （applyFolderFilter / staticFolders / クエリ葉の type:'folder'）に合わせてある。
export type CommandSection = 'command' | 'tab' | 'tag' | 'user' | 'folder';

export interface CommandEntry {
  id: string;
  section: CommandSection;
  title: string;
  /** title 以外にマッチさせたい文字列（投稿者のスクリーンネーム等）。 */
  keywords?: string;
  /** 行の右端に薄字で出す補助表示（ショートカット表記・件数・パス）。 */
  hint?: string;
  /** 同じスコア帯での順位付け（タグの使用回数・投稿者の投稿数）。 */
  weight?: number;
  /**
   * この候補が意味する「絞り込み条件」そのもの。**面が自分の確定動作を持つときの材料**で、
   * 候補の生成（顔ぶれ・並び・種別ラベル）は分岐させない＝ADR 0016 の「面が決めるのは
   * どの section を何件見せるかと、確定したときの既定動作だけ」。
   *
   * 実際の使い分け: 検索ボックスとパレットは `perform()`（現在のタブに AND 追加＝
   * 打ちかけの本文語を捨てて置き換える、検索ボックス由来の作法）を走らせる。#148 の
   * チップ帯インライン入力はこちらを読んで `addFilter` へ直接渡す＝**検索ボックスの
   * 打ちかけを巻き込まない**（あの面は「チップを1つ足す」だけの入力で、本文検索の
   * 入力欄ではない）。持たないエントリ（操作系・タブ・フォルダジャンプ）はどの面でも
   * `perform()` に倒れる。
   */
  filter?: { type: string; value: string; label?: string };
  perform(): void;
}

export interface CommandProvider {
  id: string;
  /**
   * その時点の候補を返す。パレットを開いた瞬間に呼ばれるので鮮度管理は持たない。
   * query を受け取るのは「空クエリでは列挙しない」を provider 側で決められるようにするため
   * （タグ・投稿者は数千件あり、開いた瞬間に全部出す面は無い）。絞り込み自体は
   * queryEntries が一手に引き受けるので、provider は母集合を返すだけでよい。
   */
  entries(query: string): CommandEntry[];
}

export interface CommandGroup {
  section: CommandSection;
  items: CommandEntry[];
}

// 見出しの並び順。スコアはセクション内の順位付けで、セクション同士は入れ替わらない
// （操作系がタグの下に潜り込むと「まず何ができるか」が読めなくなる）。
const SECTION_ORDER: readonly CommandSection[] = ['command', 'tab', 'tag', 'user', 'folder'];

// 並びの重み: 完全一致 > 前方一致 > 部分一致 > あいまい。あいまいの判定だけは既存 search の
// compile() をそのまま使う＝アプリ全体で1つのマッチ意味論（表記ゆれ正規化・サブシーケンス・
// 編集距離）を共有し、パレットが独自のスコアラを持たない。
const SCORE_EXACT = 4;
const SCORE_PREFIX = 3;
const SCORE_SUBSTRING = 2;
const SCORE_FUZZY = 1;
const SCORE_ANY = 0; // 空クエリ＝全件同点
const NO_MATCH = -1;

const providers = new Map<string, CommandProvider>();

/** 固定エントリ（アプリの寿命の間ずっと同じ顔ぶれ）をまとめて登録する。 */
export function registerCommands(id: string, entries: readonly CommandEntry[]): () => void {
  const frozen = [...entries];
  return registerProvider({ id, entries: () => frozen });
}

/** 動的エントリ（タブ・タグ・投稿者・フォルダ）を provider として登録する。 */
export function registerProvider(provider: CommandProvider): () => void {
  providers.set(provider.id, provider);
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
  };
}

/** テスト用: 登録を全部落とす（プロダクトコードからは呼ばない）。 */
export function resetProviders(): void {
  providers.clear();
}

/**
 * 1エントリのスコア。title と keywords のうち最も良く当たった方を採る。
 * nq / matcher は呼び出し側で1回だけ作る（描画ごとに compile し直さない）。
 */
export function scoreEntry(entry: CommandEntry, nq: string, matcher: (hay: string) => boolean): number {
  if (!nq) return SCORE_ANY;
  let best = NO_MATCH;
  for (const field of [entry.title, entry.keywords]) {
    if (!field) continue;
    const nh = normalize(field);
    const s = nh === nq ? SCORE_EXACT : nh.startsWith(nq) ? SCORE_PREFIX : nh.includes(nq) ? SCORE_SUBSTRING : matcher(field) ? SCORE_FUZZY : NO_MATCH;
    if (s > best) best = s;
  }
  return best;
}

export interface QueryOptions {
  /** 見たいセクション（面ごとの顔ぶれ）。省略＝全部。 */
  sections?: readonly CommandSection[];
  /** セクションごとの上限（面ごとの件数）。省略＝無制限。 */
  limit?: Partial<Record<CommandSection, number>>;
}

/**
 * 候補をセクションごとに束ねて返す。どの面もこれ1本を通る＝並びとマッチ意味論が共通。
 */
export function queryEntries(query: string, opts?: QueryOptions): CommandGroup[] {
  const nq = normalize(query).trim();
  const matcher = compile(query);
  const wanted = opts?.sections;
  // 登録順を同点時の最終タイブレークに使う（同じ入力なら毎回同じ並び）。
  const buckets = new Map<CommandSection, { entry: CommandEntry; score: number; seq: number }[]>();
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
  const groups: CommandGroup[] = [];
  for (const section of SECTION_ORDER) {
    const bucket = buckets.get(section);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => b.score - a.score || (b.entry.weight || 0) - (a.entry.weight || 0) || a.seq - b.seq);
    const cap = opts?.limit?.[section];
    groups.push({ section, items: (cap == null ? bucket : bucket.slice(0, cap)).map((r) => r.entry) });
  }
  return groups;
}

// --- 開閉状態（純状態・settings.ts と同じ形） ---------------------------------
let open_ = false;
let openSeq = 0;
const subs = new Set<() => void>();

export function isOpen(): boolean {
  return open_;
}

/**
 * 開いた回数。島がこれを key に使うと、閉じるアニメーションの途中で開き直しても
 * 打ちかけのクエリを持ち越さない（ConfirmHost / BulkTagDialogHost と同じ作法）。
 */
export function openId(): number {
  return openSeq;
}

function set(v: boolean) {
  const next = !!v;
  if (next === open_) return;
  open_ = next;
  if (next) openSeq++;
  for (const cb of [...subs]) cb();
}

export function open(): void {
  set(true);
}

export function close(): void {
  set(false);
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/**
 * エントリの実行。**閉じてから perform する**のがこの関数の存在理由で、順番は2つの理由で
 * 逆にできない: ①Base UI Dialog は閉じるときに開く前のフォーカス位置へ戻すので、perform が
 * 先だと復帰先が perform 後の DOM になる ②perform が別のモーダル（設定・確認）を開く場合、
 * 閉じ処理と開き処理が同じフレームで競合する。呼び出し側で忘れられないよう1箇所に閉じ込める。
 */
export function runEntry(entry: CommandEntry): void {
  close();
  entry.perform();
}

// --- Ctrl/Cmd+K ---------------------------------------------------------------
// 役割分担は確定済み: `/` は検索ボックスへのフォーカス（search-box-builder.ts）、
// Ctrl/Cmd+K はパレット。登録は GlobalShortcuts（app/App.tsx）が持ち、ガード＋動作は
// 他の全域ショートカットと同じくこちら側に置く＝開いているかどうかを知っているのは
// このモジュールなので、判定もここが持つのが自然。
//
// 入力欄の中でも効かせる（他の全域ショートカットは INPUT/TEXTAREA から手を引くが、
// Ctrl+K は検索ボックスの隣のバッジが入口を教える＝そこから押せないと嘘になる。
// Windows のテキスト入力に Ctrl+K の既定動作は無く、Chrome 自身も Ctrl+K を
// アドレスバーの検索に使っている）。
export function handleShortcutPaletteKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  if ((e.key || '').toLowerCase() !== 'k') return;
  // 開いている間は素通り＝閉じる手段は Esc と背景クリック（Base UI の dismiss）に一本化する。
  if (open_) return;
  if (confirmGet() || lightboxIsOpen()) return;
  if (settingsIsOpen()) return;
  if (folderManagerIsOpen()) return;
  e.preventDefault();
  open();
}

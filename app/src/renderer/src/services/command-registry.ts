// コマンドパレット（#28）の供給元＝候補の単一の登録簿。
//
// 「入力→種類ごとの候補」という方針の土台: 1つのエンジン、3つの画面
// （検索ボックスのサジェスト／パレット／#148 のチップ帯のインライン
// 入力）。候補生成はここに集約する。画面ごとに違うのは「どのセクションを
// いくつ見せるか」と「確定時の既定アクション」だけ――だからラインナップ、
// 順序、種類のラベルは画面間で決してずれない。
//
// settings.ts / searchbox.ts と同じく本物の ES モジュール（named exports）
// として構成し、window 経由では通さない。このモジュールは開閉状態も持つ
// （純粋な状態＝open / close / isOpen / subscribe。ストアにコールバックを
// 置かない、という既存の慣習に従う）。アイランドは useSyncExternalStore
// 経由で購読する。
//
// フィルタ型のエントリ（タグ／ポスター／フォルダへのジャンプ）もアクション型
// のエントリ（設定、新規タブ、…）も、1つの perform() へ正規化されている――
// 別々の型は無く、違いはセクションだけ。perform の実体は、アプリの起動後に
// command-builder.ts が依存性注入された閉包として登録する。
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { compile, normalize } from './search.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { registerShortcut, tryRun } from './shortcut-registry.ts';

// section は「見出し」であって、種類ごとに挙動を分岐させるための型では
// ない。
// 'folder' は、設計コメントがかつて 'collection' と呼んでいた枠――コレク
// ションがサイドバーのフォルダ一覧になった後（2026-07-04）も残っていた
// 古い名前。今ではコード側の語彙（applyFolderFilter / staticFolders／クエリ
// の葉の type:'folder'）と揃えてある。
// 'history'（#145）: 過去の訪問へのクイックジャンプ行（Chrome のオムニ
// ボックスの @history 相当）――command-builder.ts の history プロバイダを
// 参照。削除と日付の見出しは引き続きパネルの仕事
// （services/history-panel.ts の Ctrl+H）。このセクションはあくまで
// 「まっすぐそこへ跳ぶ」高速ショートカットでしかない。
export type CommandSection = 'command' | 'tab' | 'history' | 'tag' | 'user' | 'folder';

export interface CommandEntry {
  id: string;
  section: CommandSection;
  title: string;
  /** title 以外に照合する文字列（例: ポスターのスクリーンネーム）。 */
  keywords?: string;
  /** 行の右端に薄く表示する補助テキスト（ショートカット表記、件数、パス）。 */
  hint?: string;
  /** 同じスコア帯の中での順位（タグの使用回数、ポスターの投稿数）。 */
  weight?: number;
  /**
   * この候補自身が意味する「絞り込み条件」。**画面が独自の確定アクションを
   * 持つときの材料**――候補生成（ラインナップ／順序／種類のラベル）はこれで
   * 分岐することは決してない――ADR 0016 に従う: 「画面が決めるのは、どの
   * セクションをいくつ見せるかと、確定時の既定アクションだけ」。
   *
   * 実際の使い分け: 検索ボックスとパレットはどちらも `perform()` を実行する
   * （現在のタブへ AND で追加＝進行中の本文テキストを破棄して置き換える、
   * 検索ボックス由来の慣習）。#148 のチップ帯のインライン入力は代わりに
   * このフィールドを読んで `addFilter` へそのまま渡す――**検索ボックスの
   * 進行中のテキストを一緒に引きずることは決してない**（その画面はただの
   * 「チップを1つ追加する」入力であって、全文検索フィールドではない）。
   * これを持たないエントリ（アクション型／タブ／フォルダジャンプ）は、
   * どの画面でも `perform()` にフォールスルーする。
   */
  filter?: { type: string; value: string; label?: string };
  perform(): void;
}

export interface CommandProvider {
  id: string;
  /**
   * 今この瞬間の候補を返す。パレットが開いた瞬間に呼ばれるので、自分では
   * 鮮度管理を一切持たない。query を取るのは、プロバイダ自身が「空クエリ
   * では列挙しない」と判断できるようにするため（タグとポスターは数千件に
   * 達し、開いた瞬間に全部を見せる画面は無い）。絞り込み自体は完全に
   * queryEntries の仕事なので、プロバイダは母集団を返すだけでよい。
   */
  entries(query: string): CommandEntry[];
}

export interface CommandGroup {
  section: CommandSection;
  items: CommandEntry[];
}

// 見出しが現れる順序。スコアはセクションの「中で」順位付けする――セクション
// 自体が入れ替わることは決してない（アクション型セクションがタグの下に
// 滑り込んだら、「ここで何ができるか」が読めなくなってしまう）。
const SECTION_ORDER: readonly CommandSection[] = ['command', 'tab', 'history', 'tag', 'user', 'folder'];

// 順序を決める重み: 完全一致 > 前方一致 > 部分文字列一致 > あいまい一致。
// あいまい一致の判定だけが既存検索の compile() をそのまま再利用する――
// アプリ全体が1つの一致セマンティクス（表記ゆれの正規化、部分列、編集距離）
// を共有し、パレットは自前のスコア計算器を持たない。
const SCORE_EXACT = 4;
const SCORE_PREFIX = 3;
const SCORE_SUBSTRING = 2;
const SCORE_FUZZY = 1;
const SCORE_ANY = 0; // empty query = every entry ties
const NO_MATCH = -1;

const providers = new Map<string, CommandProvider>();

/** 固定エントリの一群を登録する（アプリの生存期間を通して同じラインナップ）。 */
export function registerCommands(id: string, entries: readonly CommandEntry[]): () => void {
  const frozen = [...entries];
  return registerProvider({ id, entries: () => frozen });
}

/** 動的なエントリ（タブ／タグ／ポスター／フォルダ）をプロバイダとして登録する。 */
export function registerProvider(provider: CommandProvider): () => void {
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
  /** 表示するセクション（画面ごとのラインナップ）。省略で全部。 */
  sections?: readonly CommandSection[];
  /** セクションごとの上限（画面ごとの件数）。省略で無制限。 */
  limit?: Partial<Record<CommandSection, number>>;
}

/**
 * セクションごとにまとめた候補を返す。どの画面もこの1つの関数を通る――
 * 順序とマッチングのセマンティクスは共有される。
 */
export function queryEntries(query: string, opts?: QueryOptions): CommandGroup[] {
  const nq = normalize(query).trim();
  const matcher = compile(query);
  const wanted = opts?.sections;
  // 登録順を、同点のときの最終的な同順位判定に使う（同じ入力は常に同じ順序になる）。
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

// --- 開閉状態（純粋な状態＝settings.ts と同じ形） ---------------------------
let open_ = false;
let openSeq = 0;
// #29: どちらの面が開いたか。PaletteBody がマウント時に一度だけ読む
// （openSeq をキーにする＝下のクエリリセットの慣習と同じ）＝開いている間に
// 変更されることは無い、この状態の他の部分と同様（閉じる方法は Esc か
// 背景クリックだけで、runEntry/PaletteHost に統一されている）。
let openMode_: 'commands' | 'fulltext' = 'commands';
const subs = new Set<() => void>();

export function isOpen(): boolean {
  return open_;
}

/**
 * 開かれた回数。アイランドがこれを自分のキーとして使えば、閉じるアニメー
 * ション中の再オープンが進行中のクエリを決して引き継がない
 * （ConfirmHost / BulkTagDialogHost と同じ慣習）。
 */
export function openId(): number {
  return openSeq;
}

/** 今の（あるいは直近の）オープンがどちらの面だったか――openFulltext()
 * （Ctrl/Cmd+Shift+F、またはパレット自身のフッター行）の後は 'fulltext'、
 * それ以外は 'commands'。 */
export function openMode(): 'commands' | 'fulltext' {
  return openMode_;
}

// `mode` は実際に閉→開の遷移が起きたときだけ適用される（ここの他のすべてと
// 同じ `next === open_` の早期リターンでガードされている）――すでに開いて
// いるときの冗長な open()/openFulltext() 呼び出しは、今表示中のものの
// 足元で openMode_ を黙って裏返してはいけない。
function set(v: boolean, mode?: 'commands' | 'fulltext') {
  const next = !!v;
  if (next === open_) return;
  open_ = next;
  if (next) {
    openSeq++;
    openMode_ = mode ?? 'commands';
  }
  for (const cb of [...subs]) cb();
}

export function open(): void {
  set(true, 'commands');
}

/** #29: パレットを全文検索モードのまま開く（Ctrl/Cmd+Shift+F）。 */
export function openFulltext(): void {
  set(true, 'fulltext');
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
 * エントリを実行する。「perform を実行する前に閉じる」ことがこの関数の
 * 存在理由のすべてで、順序を逆にはできない。理由は2つ: ①Base UI の
 * Dialog は閉じるときに開く前の位置へフォーカスを戻すので、perform が
 * 先に走ると、復元先が perform 実行「後」の DOM になってしまう ②perform
 * が別のモーダル（設定／確認）を開くなら、クローズ処理とオープン処理が
 * 同じフレーム内で競合してしまう。1箇所で締めくくることで、呼び出し側が
 * これを忘れられないようにしている。
 */
export function runEntry(entry: CommandEntry): void {
  close();
  entry.perform();
}

// --- Ctrl/Cmd+K --------------------------------------------------------------
// 役割分担は決まっている: `/` が検索ボックスへフォーカスし
// （search-box-builder.ts）、Ctrl/Cmd+K がパレット。登録は GlobalShortcuts
// （app/App.tsx）にある。ガード＋アクションはここにあり、他のすべての
// アプリ全体のショートカットと同じ――このモジュールは自分が開いているかを
// 知っている唯一の場所なので、そのチェックを持つのに自然な場所でもある。
//
// テキスト入力欄の中でも生かしたままにしている（他のアプリ全体の
// ショートカットは INPUT/TEXTAREA の中では引き下がるが、検索ボックスの隣の
// Ctrl+K のバッジはそれを入り口として宣伝している――そこから押せなければ
// 嘘になってしまう。Windows のテキスト入力に Ctrl+K の既定の挙動は無く、
// Chrome 自身もアドレスバー検索に Ctrl+K を使っている）。
// #246: このコード（Ctrl+K）は今では登録簿にある。ここに残るのはガードと
// アクションだけ。
function canExecuteOpenPalette(): boolean {
  // すでに開いているときは通過させる――閉じる方法は Esc と背景クリック（Base UI の dismiss）に統一されている。
  if (open_) return false;
  if (confirmGet() || lightboxIsOpen()) return false;
  if (settingsIsOpen()) return false;
  return true;
}

registerShortcut({
  id: 'palette.open',
  titleKey: 'shortcutOpenPalette',
  defaultCombo: 'Ctrl+k',
  canExecute: canExecuteOpenPalette,
  perform: open,
});

export function handleShortcutPaletteKey(e: KeyboardEvent): void {
  tryRun('palette.open', e);
}

// #29: Ctrl/Cmd+Shift+F はパレットを全文検索モードのまま開く――パレット
// 自身の「本文を検索」フッター行と並ぶ、設計上の2つ目の入り口。上の
// handleShortcutPaletteKey と同じガードの形。
// #246: このコード（Ctrl+Shift+F）は今では登録簿にある。ここに残るのは
// ガードとアクションだけ。
// canExecute は上のパレットオープンコマンドと同じ――どちらの面を開くのも、
// まったく同じ「すでに開いている／モーダルが画面を占有している」の条件で
// 塞がれる。
registerShortcut({
  id: 'palette.openFulltext',
  titleKey: 'shortcutOpenFulltextSearch',
  defaultCombo: 'Ctrl+Shift+f',
  canExecute: canExecuteOpenPalette,
  perform: openFulltext,
});

export function handleShortcutFullTextKey(e: KeyboardEvent): void {
  tryRun('palette.openFulltext', e);
}

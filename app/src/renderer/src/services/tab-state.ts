// タブの状態の service＝タブのタイトルの導出（filterLabel / tabTitleOf）、タブごとの
// ブラウザ風の戻る／進むの履歴の状態機械（makeNavHistory）、tabs.json の直列化・復元の対
// （serializeTabs / sanitizeSavedTabs）、tabs.json の読み込みと永続化の呼び出し
// （loadTabs / persistTabs）。viewer decomposition（最終形 B）の6番目の「純粋なロジック →
// service」の切り出しとして viewer.js から1対1で取り出し、その後 P4 の「IPC → service」の
// 領域ごとのまとめを重ねたもの。viewer.ts が直接 import する本物の ES モジュールで、DOM には
// 触れない。実行時の結び付きは注入する＝再代入される viewer の let（appBooted）は getter の
// 関数として、後で宣言する const（PF_NAME / CF）は遅延させたアロー関数として入る。だから
// このファイルは Node でも読み込める（scripts/test-tabstate-unit.cts が動的 import で
// 動かす）。loadTabs/persistTabs は hologramIpc（services/ipc.ts）を呼ぶが、あちらは
// window.hologram をアロー関数の中で遅延して触る＝import 自体に副作用が無いので、Node でも
// 無害なままでいられる。
import { hologramIpc } from './ipc.ts';
import { normalizeLeaf, normalizeTree } from './query.ts';

export function genTabId() {
  return 'tab_' + Math.random().toString(36).slice(2, 10);
}

// deps の取り決め:
//   t(key,subs?)＝i18n のメッセージの引き当て（getMessage）
//   engTypeLabels＝反応の種類のラベルの対応表（const は viewer が持つ。絞り込みの
//                  ポップオーバーが種類の <select> のために共有する）
//   platformName(v)＝PF_NAME の引き当て。無ければ生の値を使う
//   formatShortDate(dateStr) / formatCount(n)＝viewer の整形の補助
//   folderName(id)＝フォルダの id を表示名へ解決する
//                   （不明なら null/undefined を返し、呼び出し側が代わりのものを使う）
export function makeTabLabels(deps: {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  engTypeLabels: { [k: string]: string };
  platformName(v: string): string;
  formatShortDate(dateStr: string): string;
  formatCount(n: number | null | undefined): string;
  folderName(id: string): string | null | undefined;
  posterFolderName(id: string): string | null | undefined;
}) {
  const { t, engTypeLabels, platformName, formatShortDate, formatCount, folderName } = deps;

  // 有効な絞り込み1つに対する、人が読めるラベルを返す。クエリチップの描画と、タブの
  // タイトルの生成が共有する。
  function filterLabel(f: { type: string; [k: string]: any }): string {
    switch (f.type) {
      case 'kind':
        return f.value === 'post' ? t('kindPost') : f.value === 'bookmark' ? t('kindBookmark') : t('kindImage');
      case 'platform':
        return f.value === '__none' ? t('qfSiteNone') : platformName(f.value);
      // #253: 対応外ドメインの行の葉＝ホストそのものがラベルになる（下の 'instance' と
      // 同じ形で、どちらも「サイト」ファセットの子行）。
      case 'domain':
        return f.value;
      case 'postType':
        return f.value === 'post' ? t('qfPost') : f.value === 'reply' ? t('qfReply') : f.value === 'quote' ? t('qfQuote') : t('qfThread');
      case 'date': {
        const typeName = f.dateField === 'capturedAt' ? t('qfDateCaptured') : t('qfDatePost');
        const fromStr = f.from ? formatShortDate(f.from) : '';
        const toStr = f.to ? formatShortDate(f.to) : '';
        return `${typeName}: ${fromStr}〜${toStr}`;
      }
      case 'engagement':
        return `${engTypeLabels[f.engType] || f.engType} ${f.op === 'lte' ? '≤' : '≥'} ${formatCount(f.min)}`;
      // #162: width/height/long は px、サイズの軸は MB（保存されたバイト数から換算する）。
      case 'dimension': {
        const axisName = f.axis === 'width' ? t('qfDimWidth') : f.axis === 'height' ? t('qfDimHeight') : f.axis === 'long' ? t('qfDimLong') : t('qfDimBytes');
        const valueStr = f.axis === 'bytes' ? `${(f.value / 1048576).toFixed(1)}MB` : `${f.value}px`;
        return `${axisName} ${f.op === 'lte' ? '≤' : '≥'} ${valueStr}`;
      }
      // '__none' は「タグなし」（facets.ts）＝チップはそれを言葉で書く必要がある。
      // そうしないと、'__none' という名前のタグに見えてしまう。
      // #774: タグのエンティティ1つを表す葉は、ファセットの行が出していた曖昧さを解く
      // ラベル（"alice(東方)"）を持つ。それが無いと、同名のエンティティ2つが同じチップを
      // 付けてしまう。下の 'user' と同じく、無い時は生の値を使う形。
      case 'tag':
        return f.value === '__none' ? t('qfTagNone') : f.label || f.value;
      case 'hashtag':
        return `#${f.value}`;
      // フォルダのチップは、そのフォルダと下位フォルダの両方を表す（#41）。だから
      // そうでない方は、そうと書く必要がある＝でないと別々のクエリが同じチップを付ける。
      case 'folder':
        return (folderName(f.value) || f.value) + (f.only ? t('foldOnlySuffix') : '');
      case 'media':
        return f.value === 'image' ? t('qfImage') : f.value === 'video' ? t('qfVideo') : t('qfGif');
      case 'instance':
        return f.value;
      case 'user':
        return f.label || f.value;
      case 'text':
        return f.value;
      default:
        return f.value || f.type;
    }
  }

  // スナップショットの状態からタブのタイトルを導く。純粋関数（DOM は読まない）。
  // 有効なラベルを優先順に ・ でつなぐので、どのタブも一意になる。
  function tabTitleOf(state: HologramTabSnapshot | null | undefined, ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string } {
    const filters = (state && state.f) || [];
    const search = (state && state.search) || '';
    const multi = !!(state && state.multi);
    const allCount = ctx && ctx.allCount != null ? ctx.allCount : 0;

    if (!filters.length && !search && !multi) {
      return { text: t('filterAll') + '(' + formatCount(allCount) + ')', iconType: 'all' };
    }

    const parts: string[] = [];
    let primaryIconType: string | null = null;
    const add = (label: string, iconType: string) => {
      parts.push(label);
      if (!primaryIconType) primaryIconType = iconType;
    };

    const byType: Record<string, any[]> = {};
    filters.forEach((f) => {
      (byType[f.type] = byType[f.type] || []).push(f);
    });

    // 検索の語は今は 'text' の葉（state.f の中）で、虫眼鏡のグリフを付けて最初に出す。
    if (byType.text)
      byType.text.forEach((f) => {
        const v = String(f.value || '');
        add('”' + (v.length > 12 ? v.slice(0, 12) + '…' : v) + '”', 'search');
      });
    if (byType.tag) byType.tag.forEach((f) => add(filterLabel(f), 'tag'));
    if (byType.hashtag) byType.hashtag.forEach((f) => add(filterLabel(f), 'hashtag'));
    if (byType.user) byType.user.forEach((f) => add(filterLabel(f), 'user'));
    filters.filter((f) => f.type === 'platform' || f.type === 'instance' || f.type === 'domain').forEach((f) => add(filterLabel(f), f.type));
    filters.filter((f) => f.type === 'postType' || f.type === 'media').forEach((f) => add(filterLabel(f), f.type));
    if (multi && !byType.media) add(t('qfMultiImage'), 'media');
    if (byType.date) byType.date.forEach((f) => add(filterLabel(f), 'date'));
    if (byType.engagement) byType.engagement.forEach((f) => add(filterLabel(f), 'engagement'));
    if (byType.dimension) byType.dimension.forEach((f) => add(filterLabel(f), 'dimension'));
    if (byType.kind) byType.kind.forEach((f) => add(filterLabel(f), 'kind'));
    filters.filter((f) => f.type === 'folder').forEach((f) => add(filterLabel(f), f.type));

    return { text: parts.join('・'), iconType: primaryIconType || 'all' };
  }

  // 投稿者のクエリチップ／行のラベル。フォルダ名と日付の次元は投稿者に固有で、
  // platform / instance / tag は共有の filterLabel を使い回す。
  // deps.posterFolderName は、viewer が持つ pfStore から投稿者フォルダの id → 名前
  // （または null）を解決する。上の folderName の鏡。
  function posterFilterLabel(f: { type: string; [k: string]: any }): string {
    if (f.type === 'folder') {
      const name = deps.posterFolderName(f.value);
      return name != null ? name : f.value;
    }
    if (f.type === 'date') {
      const dimName = f.dateField === 'lastCapture' ? t('posterDateLastCapture') : f.dateField === 'authorCreatedAt' ? t('posterDateCreated') : t('posterDateLastPost');
      const fromStr = f.from ? formatShortDate(f.from) : '';
      const toStr = f.to ? formatShortDate(f.to) : '';
      return `${dimName}: ${fromStr}〜${toStr}`;
    }
    return filterLabel(f);
  }

  return { filterLabel, tabTitleOf, posterFilterLabel };
}

// エントリの擬似 URL を導く（ラベルと同一性のキー＝HologramNavEntry.u を参照）。
// グリッドの種別は今のところクエリ文字列を持たない（正本は state。履歴のページ #145 は
// tabTitleOf 経由で state から表示ラベルを導く）＝u に同一性が要るのは image の種別だけ
// （「同じ画像を開き直しても積み上がらない」）。
export function navEntryUrl(kind: HologramNavEntry['kind'], state: any): string {
  if (kind === 'image') return '/image/' + ((state && Array.isArray(state.recs) && state.recs[0]) || '');
  return kind === 'posters' ? '/posters' : '/posts';
}

// ブラウザ風の戻る／進むのための、タブごとのビューの履歴（#144: エントリはタグ付き
// 共用体 HologramNavEntry の JSON＝posts / posters / image がすべて同じスタックに乗る）。
// idx は今のエントリを指す。線形なので、戻ってから新しい変更を加えると、進む側の
// エントリは捨てられる。スタックは adopt/saveInto 経由でタブのオブジェクトに載って切り替えを
// またぎ、tabs.json へ永続化される（保留の判断5）。
//
// deps の取り決め:
//   cap＝履歴の深さの上限
//   enabled()＝履歴のゲート（viewer の appBooted。initTabs が保存したビューを適用するまで
//              エントリを作らない＝早い段階の設定の描画から空のエントリが紛れ込むのを避ける）
//   snapshot()＝今のビューのエントリ（引き取り時に新しい履歴へ種を入れる）
//   apply(entry)＝ビューのエントリを復元する（その restoring の防ぎが再 push を止める）
//   onChange()＝hist/idx を書き換えるたびに発火する（viewer が nav のボタンを揃える）
//   onPush(entry)＝#145: push() からだけ発火し（replace() では発火しない）、何もしない重複の
//                  判定を通った後に呼ばれる＝全体の履歴ページが記録する「新しいビューを
//                  実際に訪れた」という信号そのもの（置き換え＝実時間の打ち込み、ギャラリーの
//                  ページ送り、並び順＝は、Issue で確定した記録の粒度の設計に従い、意図して
//                  そちらからは見えないようにしてある）。
export function makeNavHistory(deps: { cap: number; enabled(): boolean; snapshot(): HologramNavEntry; apply(e: HologramNavEntry): void; onChange(): void; onPush?(e: HologramNavEntry): void }) {
  const { cap, enabled, snapshot, apply, onChange, onPush } = deps;
  let hist: string[] = [];
  let idx = -1;
  // record() のための、まとめの状態。呼び出し側が null でない同じキーを渡し続けている間
  // （1回の実時間の打ち込みのまとまり、開いているファセットエディタ1つ）は、後続の記録が、
  // 最初の記録が push したエントリを置き換える＝「1セッション、1エントリ」（決着済みの
  // 保留の判断2）。移動や引き取りで初期化されるので、移動の後の編集は新しく push する。
  let lastKey: unknown = null;

  // 新しいビューを記録する。状態が今のエントリと同じなら何もしないので、背面の更新や、
  // 同じクエリの描画のやり直しが積み上がらない。
  function push(e: HologramNavEntry) {
    if (!enabled()) return;
    lastKey = null;
    const s = JSON.stringify(e);
    if (idx >= 0 && hist[idx] === s) return;
    if (idx < hist.length - 1) hist = hist.slice(0, idx + 1); // 進む側の枝を捨てる
    hist.push(s);
    if (hist.length > cap) hist = hist.slice(hist.length - cap);
    idx = hist.length - 1;
    onChange();
    onPush?.(e);
  }
  // 今のエントリをその場で書き換える（実時間の打ち込み、ギャラリーのページ送り、並び順＝
  // 決着した置き換えの一覧）。書き換えた結果が1つ前のエントリと同じになったら（例えば
  // 打ち込みのセッションで、始めた場所まで消し戻した時）、同じ隣人を2つ残さずに捨てる。
  function replace(e: HologramNavEntry) {
    if (!enabled()) return;
    if (idx < 0) {
      push(e);
      return;
    }
    const s = JSON.stringify(e);
    if (hist[idx] === s) return;
    if (idx > 0 && hist[idx - 1] === s) {
      hist.splice(idx, 1);
      idx--;
      lastKey = null; // このまとまりのエントリが消えた＝次にまとめられる記録は、新しく push しなければならない
    } else {
      hist[idx] = s;
    }
    onChange();
  }
  // push と置き換えの振り分け。null でないまとめのキーが繰り返されると、そのまとまりは、
  // 最初の記録が push したエントリへ畳まれる。
  function record(e: HologramNavEntry, coalesceKey?: unknown) {
    if (coalesceKey != null && coalesceKey === lastKey) {
      replace(e);
      return;
    }
    push(e);
    lastKey = coalesceKey ?? null;
  }
  // 実際に移動したら true を返す（呼び出し側は true の時に永続化する）。
  function go(i: number): boolean {
    if (i < 0 || i >= hist.length || i === idx) return false;
    idx = i;
    lastKey = null;
    apply(JSON.parse(hist[idx]));
    onChange();
    return true;
  }
  const back = () => go(idx - 1);
  const forward = () => go(idx + 1);
  // 今のエントリ（解析した複製）＝最初の記録／引き取りより前は null。
  function current(): HologramNavEntry | null {
    return idx >= 0 ? JSON.parse(hist[idx]) : null;
  }
  // 今のエントリを適用し直す（タブの切り替え時。引き取ったスタックがビューを知っている）。
  function applyCurrent() {
    if (idx >= 0) apply(JSON.parse(hist[idx]));
  }
  // タブが選択された時に、その履歴を引き取る（無ければ種を入れる）。
  function adopt(t: HologramTab | null | undefined) {
    lastKey = null;
    if (t && Array.isArray(t._navHist) && t._navHist.length) {
      hist = t._navHist;
      idx = typeof t._navIdx === 'number' ? Math.max(0, Math.min(t._navIdx, hist.length - 1)) : hist.length - 1;
    } else {
      hist = [JSON.stringify(snapshot())];
      idx = 0;
    }
    onChange();
  }
  // 生きている履歴を、タブのオブジェクトに載せて切り替えをまたいで運ぶ。
  function saveInto(t: HologramTab) {
    t._navHist = hist;
    t._navIdx = idx;
  }
  return { push, replace, record, back, forward, current, applyCurrent, adopt, saveInto, canBack: () => idx > 0, canForward: () => idx < hist.length - 1 };
}

// タブ1枚が再起動後に戻ってくるために必要なものを、まとめて1つの不透明な塊にしたもの。
// main はこれを tabs テーブルの `state` 列へそのまま入れ、中を覗くことはない
// （lib-db-schema.ts がテーブルのところでそう書いている）。scrollTop も一緒に運ばれるので、
// ビューはタブの切り替えだけでなく再起動をまたいでも戻る。タブごとの戻る／進むのスタックは、
// 解析済みのエントリのオブジェクトとして `nav` の下に永続化される（#144 保留の判断5＝
// 大きさの上限は NAV_CAP だけ。Chrome も同じやり方でタブの履歴を再起動をまたいで運ぶ）。
// 旧来の renderLimit の欄は、窓で描く経路と一緒に無くなった＝ウィンドウイングするグリッドは
// scrollTop だけからどの深さでも戻せる（古い保存済みの欄は無視する）。
export interface HologramTabPersist {
  /** applyState が復元の元にする、投稿グリッドのスナップショット（一度も触っていないタブでは null）。 */
  view: HologramTabSnapshot | null;
  /** 画像ビューが刻んだタイトル（グリッドのエントリでは消す）。 */
  autoTitle?: boolean;
  scrollTop?: number;
  nav?: { hist: HologramNavEntry[]; idx?: number };
  // #21: タグ管理タブ（HologramTab.specialKind を参照）。HologramPersistedTab の兄弟では
  // なく、この塊の中に置く。理由はまさに #565（下のコメント）＝main の INSERT は
  // id/pinned/title/state しか運ばないので、その階層に他のものを置いても永続化されず、
  // 黙って落ちる。
  specialKind?: 'tags';
}
// 永続化するタブ1枚。塊の兄弟は id / pinned / title だけ＝main が索引を張る列がそれ
// （位置は配列の順序から来る）。
// #565: nav / scrollTop / autoTitle も以前は兄弟として載っていて、main の INSERT がそれを
// 黙って落としていた。だから戻る／進むのスタックとスクロール位置は再起動のたびに死んでいたのに、
// テストはすべて緑のままだった。ここの明示的な型が、それを直したまま保つ防ぎ＝4つ目の兄弟は
// 今やコンパイルエラーになるので、次のタブごとの欄は、生き残る場所へ置くしかない。
export interface HologramPersistedTab {
  id: string;
  pinned: boolean;
  title: string | null;
  state: HologramTabPersist;
}
export interface HologramPersistedTabs {
  activeTabId: string | null;
  tabs: HologramPersistedTab[];
}

export function serializeTabs(tabs: HologramTab[], activeTabId: string | null): HologramPersistedTabs {
  return {
    activeTabId,
    tabs: tabs.map((t) => ({
      id: t.id,
      pinned: t.pinned,
      title: t.title,
      state: {
        view: t.state ?? null,
        autoTitle: t._autoTitle || undefined,
        scrollTop: t._scrollTop,
        nav: Array.isArray(t._navHist) && t._navHist.length ? { hist: t._navHist.map((s) => JSON.parse(s)), idx: t._navIdx } : undefined,
        // #21: HologramPersistedTab の兄弟ではなく、この塊の中に置く＝そのインタフェースの
        // コメントを参照（このファイル自身のテストが守らせている #565 の防ぎ）。
        specialKind: t.specialKind,
      },
    })),
  };
}

// 永続化したタブの状態にある葉の型の名前を、今のスキーマへ正規化する（query.ts の
// normalizeLeaf を参照）。クエリの木（state.tree＝applyState が復元の元にするもの）と
// タイトルの影（state.f）の両方を、その場で通す。
function normalizeSavedState(state: any): any {
  if (state && typeof state === 'object') {
    if (state.tree) normalizeTree(state.tree);
    if (Array.isArray(state.f)) state.f.forEach(normalizeLeaf);
  }
  return state || null;
}

// 永続化した nav のエントリ1件を検証する＝直列化し直した文字列か null を返す（不正な行は
// 捨て、idx は呼び出し側が丸める）。種別ごとの状態の検査が、手で編集された／途中で切れた
// tabs.json から壊れたスタックが生まれるのを防ぐ。
function sanitizeNavEntry(e: any): string | null {
  if (!e || typeof e !== 'object') return null;
  const kind = e.kind === 'posters' || e.kind === 'image' ? e.kind : e.kind === 'posts' ? 'posts' : null;
  if (!kind) return null;
  let state = e.state;
  if (kind === 'image') {
    const recs = state && Array.isArray(state.recs) ? state.recs.filter((x: any) => typeof x === 'string') : [];
    if (!recs.length) return null;
    state = { recs, idx: typeof state.idx === 'number' ? Math.max(0, Math.min(state.idx, recs.length - 1)) : 0 };
  } else {
    if (!state || typeof state !== 'object') return null;
    if (kind === 'posts') state = normalizeSavedState(state);
    else if (state.tree) normalizeTree(state.tree);
  }
  return JSON.stringify({ u: navEntryUrl(kind, state), kind, state });
}

// 永続化した tabs.json の中身に対する、復元側の検査。使えるものが何も保存されていなければ
// null を返す（呼び出し側が新しいタブを1枚だけ用意する）。nav のスタックは行ごとに検証する
// （不正な行は捨て、idx は丸める）。
export function sanitizeSavedTabs(saved: unknown, genId: () => string): { tabs: HologramTab[]; activeTabId: string } | null {
  // `saved` は素の tabs.json の JSON（ディスク上では未知の形や古い形）＝下の欄への
  // アクセスすべてに `unknown` を通すのではなく、HologramPost の「開かれた JSON」の作法に
  // 合わせて、ここで一度だけ緩い形へ絞る。
  const data = saved as { tabs?: any[]; activeTabId?: string } | null | undefined;
  if (!data || !Array.isArray(data.tabs) || data.tabs.length === 0) return null;
  const tabs: HologramTab[] = data.tabs.map((t) => {
    // 3つの列以外はすべて塊の中にある（serializeTabs）。
    const p: Partial<HologramTabPersist> = t.state && typeof t.state === 'object' ? t.state : {};
    let navHist: string[] | undefined;
    let navIdx: number | undefined;
    if (p.nav && Array.isArray(p.nav.hist)) {
      const raw: any[] = p.nav.hist;
      const kept = raw.map((e, i) => ({ s: sanitizeNavEntry(e), i })).filter((x) => x.s != null);
      if (kept.length) {
        navHist = kept.map((x) => x.s as string);
        const savedIdx = typeof p.nav.idx === 'number' ? p.nav.idx : raw.length - 1;
        // 保存されていた現在の行に最も近い、残した行を指す（捨てた行の分だけずれる）。
        let mapped = kept.filter((x) => x.i <= savedIdx).length - 1;
        if (mapped < 0) mapped = 0;
        navIdx = Math.min(mapped, navHist.length - 1);
      }
    }
    return {
      specialKind: p.specialKind === 'tags' ? 'tags' : undefined,
      id: t.id || genId(),
      pinned: !!t.pinned,
      title: t.title || null,
      _autoTitle: !!p.autoTitle,
      // 永続化したクエリの木と、そのタイトルの影に残る、撤去済みの葉の型の名前を自分で
      // 直す（例えば #42 の 'collection' → 'folder'）。applyState は state.tree を優先する
      // ので両方を正規化する。次にタブを切り替えた時の書き込みが、直った形を永続化する。
      state: normalizeSavedState(p.view),
      _scrollTop: typeof p.scrollTop === 'number' ? p.scrollTop : 0,
      _navHist: navHist,
      _navIdx: navIdx,
    };
  });
  const sid = data.activeTabId;
  return { tabs, activeTabId: sid && tabs.find((t) => t.id === sid) ? sid : tabs[0].id };
}

// tabs.json の読み込みと永続化（P4 の「IPC → service」の領域ごとのまとめの一部＝素の
// hologramIpc.getTabs/setTabs の呼び出しを viewer.js からここへ、それが包む直列化・復元の
// 対の隣へ移した）。呼ばれるのはブラウザからだけ（viewer.js）で、Node の単体テストから
// 呼ばれることはない。
export async function loadTabs() {
  try {
    return await hologramIpc.getTabs();
  } catch {
    return null;
  }
}
export async function persistTabs(tabs: HologramTab[], activeTabId: string | null) {
  try {
    await hologramIpc.setTabs(serializeTabs(tabs, activeTabId));
  } catch {
    /* できる範囲で */
  }
}

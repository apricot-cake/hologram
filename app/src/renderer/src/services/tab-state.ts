import type { Translate } from './translation.ts';
import { ASPECT_RATIOS } from './aspect-ratio.ts';
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

export function genTabId() {
  return 'tab_' + Math.random().toString(36).slice(2, 10);
}

// deps の取り決め:
//   t(key,subs?)＝i18n のメッセージの引き当て（getMessage）
//   platformName(v)＝PF_NAME の引き当て。無ければ生の値を使う
//   formatShortDate(dateStr) / formatCount(n)＝viewer の整形の補助
//   folderName(id)＝フォルダの id を表示名へ解決する
//                   （不明なら null/undefined を返し、呼び出し側が代わりのものを使う）
export function makeTabLabels(deps: { t: Translate; platformName(v: string): string; formatShortDate(dateStr: string): string; formatCount(n: number | null | undefined): string; folderName(id: string): string | null | undefined }) {
  const { t, platformName, formatShortDate, formatCount, folderName } = deps;

  // 有効な絞り込み1つに対する、人が読めるラベルを返す。クエリチップの描画と、タブの
  // タイトルの生成が共有する。
  function filterLabel(f: { type: string; [k: string]: any }): string {
    switch (f.type) {
      case 'kind':
        return f.value === 'post' ? t('kindPost') : t('kindImage');
      case 'platform':
        return f.value === '__none' ? t('qfSiteNone') : platformName(f.value);
      // #253: 対応外ドメインの行の葉＝ホストそのものがラベルになる。
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
        return f.value === '__none' && f.tagId == null ? t('qfTagNone') : f.label || f.value;
      case 'hashtag':
        return `#${f.value}`;
      // フォルダのチップは、そのフォルダと下位フォルダの両方を表す（#41）。だから
      // そうでない方は、そうと書く必要がある＝でないと別々のクエリが同じチップを付ける。
      case 'folder':
        return (folderName(f.value) || f.value) + (f.only ? t('foldOnlySuffix') : '');
      case 'media':
        return f.value === 'image' ? t('qfImage') : f.value === 'video' ? t('qfVideo') : t('qfGif');
      case 'aspectRatio': {
        const ratio = ASPECT_RATIOS.find((item) => item.value === f.value);
        return ratio ? t(ratio.label) : f.value;
      }
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
  function tabTitleOf(state: HologramTabSnapshot | null | undefined, _ctx: { allCount?: number | null } | null | undefined): { text: string; iconType: string } {
    const filters = (state && state.f) || [];
    const folderId = (state && state.folderId) || '';
    const search = (state && state.search) || '';
    const multi = !!(state && state.multi);
    if (!filters.length && !folderId && !search && !multi) {
      return { text: t('browsePosts'), iconType: 'home' };
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

    // 静的フォルダは絞り込みではなく現在地。フィルタの葉と混ぜず、タブ名だけには
    // 先頭の場所として表すので、履歴とタブを見てもどこを開いているか分かる。
    if (folderId) add(folderName(folderId) || folderId, 'folder');

    // 検索の語は今は 'text' の葉（state.f の中）で、虫眼鏡のグリフを付けて最初に出す。
    if (byType.text)
      byType.text.forEach((f) => {
        const v = String(f.value || '');
        add('”' + (v.length > 12 ? v.slice(0, 12) + '…' : v) + '”', 'search');
      });
    if (byType.tag) byType.tag.forEach((f) => add(filterLabel(f), 'tag'));
    if (byType.hashtag) byType.hashtag.forEach((f) => add(filterLabel(f), 'hashtag'));
    if (byType.user) byType.user.forEach((f) => add(filterLabel(f), 'user'));
    filters.filter((f) => f.type === 'platform' || f.type === 'domain').forEach((f) => add(filterLabel(f), f.type));
    filters.filter((f) => f.type === 'postType' || f.type === 'media' || f.type === 'aspectRatio').forEach((f) => add(filterLabel(f), f.type));
    if (multi && !byType.media) add(t('qfMultiImage'), 'media');
    if (byType.date) byType.date.forEach((f) => add(filterLabel(f), 'date'));
    if (byType.dimension) byType.dimension.forEach((f) => add(filterLabel(f), 'dimension'));
    if (byType.kind) byType.kind.forEach((f) => add(filterLabel(f), 'kind'));
    filters.filter((f) => f.type === 'folder').forEach((f) => add(filterLabel(f), f.type));

    return { text: parts.join('・'), iconType: primaryIconType || 'all' };
  }

  function posterFilterLabel(f: { type: string; [k: string]: any }): string {
    if (f.type === 'date') {
      const dimName = f.dateField === 'lastCapture' ? t('posterDateLastCapture') : f.dateField === 'authorCreatedAt' ? t('posterDateCreated') : t('posterDateLastPost');
      const fromStr = f.from ? formatShortDate(f.from) : '';
      const toStr = f.to ? formatShortDate(f.to) : '';
      return `${dimName}: ${fromStr}〜${toStr}`;
    }
    if (f.type === 'followers') return `${t('detailFollowers')} ${f.op === 'lte' ? '≤' : '≥'} ${formatCount(f.min)}`;
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

  const sameEntry = (a: HologramNavEntry, b: HologramNavEntry) => a.u === b.u && a.kind === b.kind && JSON.stringify(a.state) === JSON.stringify(b.state);
  function saveScrollTop(scrollTop: number) {
    if (idx < 0 || !enabled()) return;
    const entry = JSON.parse(hist[idx]) as HologramNavEntry;
    hist[idx] = JSON.stringify({ ...entry, scrollTop: Math.max(0, scrollTop) });
  }

  // 新しいビューを記録する。状態が今のエントリと同じなら何もしないので、背面の更新や、
  // 同じクエリの描画のやり直しが積み上がらない。
  function push(e: HologramNavEntry) {
    if (!enabled()) return;
    lastKey = null;
    const s = JSON.stringify(e);
    if (idx >= 0 && sameEntry(JSON.parse(hist[idx]), e)) return;
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
    if (sameEntry(JSON.parse(hist[idx]), e)) return;
    if (idx > 0 && sameEntry(JSON.parse(hist[idx - 1]), e)) {
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
  return { push, replace, record, back, forward, saveScrollTop, current, applyCurrent, adopt, saveInto, canBack: () => idx > 0, canForward: () => idx < hist.length - 1 };
}

// タブ1枚が再起動後に戻ってくるために必要なものを、まとめて1つの不透明な塊にしたもの。
// main はこれを tabs テーブルの `state` 列へそのまま入れ、中を覗くことはない
// （lib-db-schema.ts がテーブルのところでそう書いている）。scrollTop も一緒に運ばれるので、
// ビューはタブの切り替えだけでなく再起動をまたいでも戻る。タブごとの戻る／進むのスタックは、
// 解析済みのエントリのオブジェクトとして `nav` の下に永続化される（#144 保留の判断5＝
// 大きさの上限は NAV_CAP だけ。Chrome も同じやり方でタブの履歴を再起動をまたいで運ぶ）。
// 旧来の renderLimit の欄は、窓で描く経路と一緒に無くなった＝仮想化するグリッドは
// scrollTop だけからどの深さでも戻せる（古い保存済みの欄は無視する）。
export type HologramTabPersist = z.output<typeof TabPersistSchema>;
// 永続化するタブ1枚。塊の兄弟は id / pinned / title だけ＝main が索引を張る列がそれ
// （位置は配列の順序から来る）。
// #565: nav / scrollTop / autoTitle も以前は兄弟として載っていて、main の INSERT がそれを
// 黙って落としていた。だから戻る／進むのスタックとスクロール位置は再起動のたびに死んでいたのに、
// テストはすべて緑のままだった。ここの明示的な型が、それを直したまま保つ防ぎ＝4つ目の兄弟は
// 今やコンパイルエラーになるので、次のタブごとの欄は、生き残る場所へ置くしかない。
export type HologramPersistedTab = TabRecord;
export type HologramPersistedTabs = TabsState;

export function serializeTabs(tabs: HologramTab[], activeTabId: string | null): HologramPersistedTabs {
  return {
    activeTabId,
    tabs: tabs.map((t) => ({
      id: t.id,
      pinned: false,
      title: t.title,
      state: {
        view: t.state ?? null,
        autoTitle: t._autoTitle || undefined,
        scrollTop: t._scrollTop,
        nav: Array.isArray(t._navHist) && t._navHist.length ? { hist: t._navHist.map((s) => JSON.parse(s)), idx: t._navIdx } : undefined,
      },
    })),
  };
}

// 保存形式は共通スキーマで検証する。復元時には表示用 URL と添字だけを導出する。
export function sanitizeSavedTabs(saved: unknown, _genId: () => string): { tabs: HologramTab[]; activeTabId: string } | null {
  if (saved == null) return null;
  const data = TabsSchema.parse(saved);
  if (!data.tabs.length) return null;
  const tabs: HologramTab[] = data.tabs.map((t) => {
    const p = t.state;
    const clean = (view: typeof p.view) => {
      if (!view) return;
      if (view.tree) normalizeTree(view.tree);
      if (view.f) view.f = view.f.filter((leaf) => !isRemovedFilter(leaf));
      if (view.ops) {
        delete view.ops.engagement;
        delete view.ops.instance;
      }
    };
    clean(p.view);
    for (const entry of p.nav?.hist ?? []) {
      if (entry.kind !== 'image') clean(entry.state);
    }
    const hist = p.nav?.hist;
    return {
      id: t.id,
      pinned: false,
      title: t.title,
      state: p.view,
      _autoTitle: p.autoTitle ?? false,
      _scrollTop: p.scrollTop ?? 0,
      _navHist: hist?.length ? hist.map((e) => JSON.stringify({ ...e, u: navEntryUrl(e.kind, e.state) })) : undefined,
      _navIdx: hist?.length ? Math.max(0, Math.min(p.nav?.idx ?? hist.length - 1, hist.length - 1)) : undefined,
    };
  });
  return { tabs, activeTabId: tabs.find((t) => t.id === data.activeTabId)?.id ?? tabs[0].id };
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
import { TabsSchema, type TabRecord, type TabsState, type TabPersistSchema } from '../../../shared/data-schemas.ts';
import { normalizeTree, isRemovedFilter } from './query';
import type { z } from 'zod';

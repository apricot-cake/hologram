// 追跡している各投稿についてライブラリが持っているもの: 「これは保存済
// みか」という問いをスクロールのひと固まりごとに1回の問い合わせへまと
// め、答えをキャッシュし、同じタブでの保存をそこへそのまま織り込む
// （#334）。#399 で overlay.ts から分離した。DOM についてはパーマリン
// クとキーにするメディア要素以外何も知らず、描画についても何も知らな
// い。
import { mediaKeyOf, mediaKeysOf } from '../extractor/index.ts';
import type { CaptureSite, MediaIdentitySite } from '../extractor/types.ts';
import type { BackgroundToContentMessage, CheckSavedMessage, CheckSavedResponse, SavedEntry } from '../messages.ts';
import { postMediaIn } from './positioning.ts';
import type { Anchor, SavedPictures, UnitState } from './types.ts';

// 何も解決しなかったときは（空文字列ではなく）null にする。そうすればユ
// ニットは未回答のままになり、次に画面内へスクロールしてきたときに読み
// 直される＝フィードのユニットは最初の交差時には中途半端にしか描画され
// ていないのが普通だから。
export function permalinkOf(capture: CaptureSite, unit: Element): string | null {
  try {
    return capture.getPermalink(unit) || null;
  } catch {
    return null;
  }
}

// host からの1投稿分の答えを、この側が比較できる形に変える。URL から
// アイデンティティキーが得られない保存済み画像は、投稿全体を `whole` に
// 落とす＝そうしないと、すでにライブラリにある画像に保存ボタンが乗って
// しまい、それをまた保存してしまうことこそ、この印が防ごうとしている結
// 果そのものだ。
export function readSavedPictures(entry: SavedEntry | null | undefined, media: MediaIdentitySite | null): SavedPictures | null {
  if (!entry) return null;
  const urls: Array<string | null> = Array.isArray(entry.media) ? entry.media : [];
  const saved: SavedPictures = { whole: !urls.length, keys: new Set(), seqs: new Set() };
  urls.forEach((url, seq) => {
    if (typeof url !== 'string' || !url) {
      saved.seqs.add(seq); // URLなしで記録された＝投稿内での位置しか手がかりがない
      return;
    }
    const key = media ? mediaKeyOf(media.platform, url) : null;
    if (key) saved.keys.add(key);
    else saved.whole = true;
  });
  return saved;
}

// たった今完了した保存を、投稿について分かっていることへ織り込む。空の
// 一覧は、その保存が自前の画像を1件も報告しなかったことを意味し、これ
// は host が返す「保存済み、画像は不明」と同じ扱いになる。
export function addSavedPictures(prev: SavedPictures | null, urls: Array<string | null>, media: MediaIdentitySite | null): SavedPictures {
  const next: SavedPictures = prev || { whole: false, keys: new Set(), seqs: new Set() };
  if (!urls.length) {
    next.whole = true;
    return next;
  }
  for (const url of urls) {
    const key = typeof url === 'string' && url && media ? mediaKeyOf(media.platform, url) : null;
    if (key) next.keys.add(key);
    else next.whole = true;
  }
  return next;
}

// この画像は投稿の保存済み画像のうちの1枚か。印と保存ボタンはこの1つの
// 問いの2つの面だ（#334）: 複数画像の投稿で2枚目が保存済みなら、1枚目
// にもボタンを提示し続けなければならない。
export function anchorSaved(state: UnitState, anchor: Anchor, index: number, media: MediaIdentitySite | null): boolean {
  const saved = state.saved;
  if (!saved) return false;
  if (saved.whole) return true;
  // テキストのアンカーには画像ごとのキーと比較すべき画像がない＝上の
  // `whole` だけが、テキストのみの投稿のレコードが「はい」と言える唯一
  // の方法だ（#365: readSavedPictures がキーにできる media の行を一切
  // 持たない）。
  if (anchor.kind === 'text') return false;
  const el = media ? postMediaIn(anchor.box) : null;
  const keys = el && media ? mediaKeysOf(el, media.platform) : [];
  if (keys.some((key) => saved.keys.has(key))) return true;
  // ページ上にも比較できる URL がない場合、残る手がかりは位置だけで、
  // それが答えられるのはライブラリが URL なしで記録した画像についてだ
  // けだ。
  return !keys.length && saved.seqs.has(index);
}

export interface SavedQuery {
  // ユニットに答えが必要だという印を付ける。これ自体は flush をスケ
  // ジュールしない＝呼び出し元が複数回の add をまとめて
  // （IntersectionObserver のコールバック1回、設定の再有効化1回）、最後
  // に1回だけ scheduleQuery() を呼ぶ。元の単一のクロージャがやっていた
  // のと同じだ。
  add(unit: Element): void;
  forget(unit: Element): void;
  scheduleQuery(): void;
  dispose(): void;
}

export interface SavedQueryOptions {
  debounceMs: number;
  tracked: Map<Element, UnitState>;
  isVisible: (unit: Element) => boolean;
  isWanted: () => boolean; // markMode !== 'off' || hoverSave
  isAlive: () => boolean; // extensionAlive()
  getPermalink: (unit: Element) => string | null;
  getMedia: () => MediaIdentitySite | null;
  onResolved: (unit: Element, state: UnitState) => void; // repaint if visible
}

export function createSavedQuery(opts: SavedQueryOptions): SavedQuery {
  const pending = new Set<Element>();
  let queryTimer: ReturnType<typeof setTimeout> | null = null;

  function flushQuery() {
    // #594 の受け身側の半分。これは投稿が画面内へスクロールしてくるたび
    // に動くので、孤児になったタブでは、ユーザーが再びそのタブを使い始
    // めた瞬間にそれに気付き、古くなった印とボタンをページから取り除く
    // 役目を果たす。何も表示しない: スクロールは要求ではなく、自動更新
    // のたびに開いているすべてのタイムラインでトーストを出すのは、まさ
    // に #154 の憲章2が締め出しているノイズだ。ユーザー自身の要求には
    // 専用の経路がある（コントローラの保存フロー）。
    if (!opts.isWanted() || !opts.isAlive()) {
      pending.clear();
      return;
    }
    // url -> その投稿を表示しているユニット群。1つのパーマリンクがペー
    // ジ上に2回現れることがあり（投稿とその引用プレビュー自身）、どちら
    // にも印を灯すべきだ。
    const byUrl = new Map<string, Element[]>();
    for (const unit of pending) {
      const state = opts.tracked.get(unit);
      if (!state) continue;
      if (state.url === null) state.url = opts.getPermalink(unit);
      if (!state.url) continue; // 結局投稿ではなかった（ヘッダー、広告、おすすめ表示）
      const list = byUrl.get(state.url);
      if (list) list.push(unit);
      else byUrl.set(state.url, [unit]);
    }
    pending.clear();
    if (!byUrl.size) return;

    chrome.runtime.sendMessage({ type: 'checkSaved', urls: [...byUrl.keys()] } satisfies CheckSavedMessage, (res?: CheckSavedResponse) => {
      // 届かない host は何も答えない: 「未保存」と断定するのではなく、投
      // 稿には印を付けないままにする。background.js は次のスクロールで
      // どのみち再度尋ねる（そのネガティブキャッシュはこれらを一度も記
      // 録していない）。保存ボタンはそれでも表示される＝答えが分からな
      // いときに保存を提示するのは安全だが、「未保存」だと主張するのは
      // 安全ではない。
      if (chrome.runtime.lastError || !res?.ok || !res.results) return;
      for (const [url, units] of byUrl) {
        const saved = readSavedPictures(res.results[url], opts.getMedia());
        for (const unit of units) {
          const state = opts.tracked.get(unit);
          if (!state) continue;
          state.saved = saved;
          if (opts.isVisible(unit)) opts.onResolved(unit, state);
        }
      }
    });
  }

  function scheduleQuery() {
    if (queryTimer || !pending.size) return;
    queryTimer = setTimeout(() => {
      queryTimer = null;
      flushQuery();
    }, opts.debounceMs);
  }

  // このタブで行われた保存: 次のスクロールを待たずにその投稿へ印を付け
  // 直す（background.js は host が受理した瞬間にこれを push する）。
  const onMessage = (message: BackgroundToContentMessage) => {
    if (message?.type !== 'savedUpdate' || !message.url) return;
    const urls: Array<string | null> = Array.isArray(message.media) ? message.media : [];
    for (const [unit, state] of opts.tracked) {
      if (state.url !== message.url) continue;
      state.saved = addSavedPictures(state.saved, urls, opts.getMedia());
      if (opts.isVisible(unit)) opts.onResolved(unit, state);
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);

  return {
    add(unit: Element) {
      pending.add(unit);
    },
    forget(unit: Element) {
      pending.delete(unit);
    },
    scheduleQuery,
    dispose() {
      chrome.runtime.onMessage.removeListener(onMessage);
      if (queryTimer) clearTimeout(queryTimer);
      queryTimer = null;
      pending.clear();
    },
  };
}

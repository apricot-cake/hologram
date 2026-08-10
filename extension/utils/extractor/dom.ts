// 複数の extractor が共有する DOM 相の補助関数。サイト固有のものはここに置かない
// ＝1サイトしか要らない規則は、そのサイトのモジュールに置く。
//
// どの関数もページをグローバル経由で読むが、読むのは呼び出しの時点であって
// モジュールの読み込み時ではない。これによって jsdom のフィクスチャ一式が
// フィクスチャごとに `document` / `location` を差し替えられる。

import type { PostMediaElement, PostRect } from './types.ts';

// このホスト自身、またはそのサブドメイン。サブドメイン（pro.x.com、
// mobile.twitter.com、www.pixiv.net …）は同じ web UI を出すので、あるホストを
// 受け入れるサイトはそのサブドメインも受け入れる。
function hostnameMatches(host: string): boolean {
  return location.hostname === host || location.hostname.endsWith(`.${host}`);
}

function normalizeRect(rect: { x?: number; y?: number; top?: number; left?: number; width?: number; height?: number; right?: number; bottom?: number } | DOMRect): PostRect {
  const x = rect?.x ?? rect?.left ?? 0;
  const y = rect?.y ?? rect?.top ?? 0;
  const width = rect?.width ?? (rect?.right ?? x) - (rect?.left ?? x);
  const height = rect?.height ?? (rect?.bottom ?? y) - (rect?.top ?? y);

  return {
    x,
    y,
    top: rect?.top ?? y,
    left: rect?.left ?? x,
    width,
    height,
    right: rect?.right ?? x + width,
    bottom: rect?.bottom ?? y + height,
  };
}

// スクリーンショットを撮っている間だけ hover のスタイルを黙らせたい要素に印の
// クラスを付け、取り消す関数を返す。
function prepareScopedCaptureState(className: string, elements: ReadonlyArray<Element | null | undefined>): () => void {
  const captureTargets = [...new Set(elements.filter((e): e is Element => Boolean(e)))];

  captureTargets.forEach((element) => {
    element.classList.add(className);
  });

  return () => {
    captureTargets.forEach((element) => {
      element.classList.remove(className);
    });
  };
}

// その要素を見分けるのに使える URL 群。instanceof ではなくタグ名で判定する。
// フィクスチャのテストはこれらを jsdom の realm 上で動かすが、そこのコンストラクタ
// はこのモジュールが閉じ込めたものとは別物だから。
function mediaSrcs(el: PostMediaElement): string[] {
  if (el.tagName === 'VIDEO') {
    const poster = (el as HTMLVideoElement).poster;
    return poster ? [poster] : [];
  }
  const img = el as HTMLImageElement;
  return [img.src, img.currentSrc].filter((src) => !!src);
}

function anySrc(el: PostMediaElement, test: (src: string) => boolean): boolean {
  return mediaSrcs(el).some(test);
}

// メディア URL が実際に配信されているホスト。部分文字列の一致では判定せず、必ず
// パースする。`https://evil.example/?x=i.pximg.net` は CDN の名前を含むだけでその
// CDN ではないので、`src.includes(host)` は自分の支配下の URL にこの文字列を置ける
// ページすべてに対して真を返してしまう
// （CodeQL js/incomplete-url-substring-sanitization）。
function mediaHostIs(src: string, host: string): boolean {
  try {
    return new URL(src, location.origin).hostname === host;
  } catch {
    return false;
  }
}

interface ParsedMediaPath {
  match: RegExpMatchArray;
  url: string;
}

function parseMediaUrlPath(href: string, pathRegex: RegExp): ParsedMediaPath | null {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(pathRegex);
    if (!match) return null;
    return { match, url: url.href };
  } catch {
    return null;
  }
}

// DOM 上の距離がいちばん近い候補リンク（候補が祖先を共有するグリッドで、隣の投稿の
// リンクを拾わないため）。遡りはいちばん近い投稿コンテナ（boundarySel）で必ず
// 止める。そこを越えて遡ると、DOM 上たまたま近いだけの無関係な投稿へ画像を
// 結び付けてしまう。アバター・バナー・サイドバーの画像は、でっち上げのレコードを
// 作るのではなく素性なしを返さなければならない。(audit 2026-06-11)
function findAncestorContainerLink(img: Element, selector: string, boundarySel: string): Element | null {
  let el = img.parentElement;
  while (el && el !== document.body) {
    const candidates = el.querySelectorAll(selector);
    if (candidates.length) {
      // 境界付き＝投稿コンテナの中にいる間だけ候補を信じる。広げていった探索が
      // そこを抜けたら（アバター・バナー・サイドバーの画像）、いちばん近い一致は
      // 無関係な投稿のものなので、代わりに諦める。
      if (boundarySel && !el.closest(boundarySel)) return null;
      if (candidates.length === 1) return candidates[0] ?? null;
      let best: Element | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const link of candidates) {
        const d = mediaTreeDistance(img, link);
        if (d < bestDist) {
          bestDist = d;
          best = link;
        }
      }
      return best;
    }
    if (boundarySel && el.matches(boundarySel)) return null; // コンテナを見尽くした＝ここで止める
    el = el.parentElement;
  }
  return null;
}

function mediaTreeDistance(a: Element, b: Element): number {
  const ancestorsA: Element[] = [];
  for (let n: Element | null = a; n; n = n.parentElement) ancestorsA.push(n);
  const indexInA = new Map(ancestorsA.map((n, i) => [n, i]));
  let depthB = 0;
  for (let n: Element | null = b; n; n = n.parentElement) {
    const idx = indexInA.get(n);
    if (idx !== undefined) return idx + depthB;
    depthB++;
  }
  return Number.POSITIVE_INFINITY;
}

export { anySrc, findAncestorContainerLink, hostnameMatches, mediaHostIs, mediaSrcs, mediaTreeDistance, normalizeRect, parseMediaUrlPath, prepareScopedCaptureState };
export type { ParsedMediaPath };

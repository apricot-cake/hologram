// 画像タブの隣の先読み（#241）。グループを送っていくと、以前はどのスライドも冷たい状態
// から始まっていた。ステージはメディアを `src` で key にしているので、前後の送りは古い
// 要素を壊して新しい要素を載せる。その新しい要素には当たれる温かいものが何も無かった＝
// 取得もデコードも。グリッドはずっと前から `decoding="async"` を持っていたのに、大きな
// 絵を実際に見る画面には何も無かった。
//
// `<link rel="preload" as="image">` で取得だけを先行させる。隣の原本は投稿者が用意した
// 画像であり、圧縮後のファイルサイズからデコード後の大きさを制限できない。したがって、
// 表示前に `Image.decode()` を呼んではならない（小さな PNG でも展開後は巨大になりうる）。
//
// ライブラリは足していない。DOM の呼び出しが2つあるだけ。
export const PRELOAD_RADIUS = 1;

// 前後の送りも ←/→ もちょうど1つ動くので、半径1で次の入力が着地しうる升目は覆える。

// `ImageTabItem` ではなく構造で型を付ける。このモジュールは Node 側のテストランナーが
// 取り込む純粋なロジックの単位で、構造で型を付ければ、ずれうる2つ目の宣言を作らずに
// コンポーネント（と JSX）から切り離しておける。
export interface PreloadableItem {
  src: string;
  video?: boolean;
  ugoira?: unknown;
  poster?: string;
}

// この項目に対して `<img>` が実際に描く静止画。項目がそもそも画像でなければ何も返さない。
export function stillSourceOf(item: PreloadableItem | undefined): string | undefined {
  if (!item) return undefined;
  // うごイラは書庫が開くまで poster を見せるし、書庫は data URL として IPC 越しに来る
  // （UgoiraPlayer）＝<img> が温められるものではない。
  if (item.ugoira) return item.poster || undefined;
  // <video> は自分の取り決めを持つ（preload="metadata"）。クリップを丸ごと引いてくるのは
  // 「隣の画像」が求めたことではないし、上の上限を吹き飛ばす。
  if (item.video) return undefined;
  return item.src || undefined;
}

// `idx` の周りで温めておく source。近い順に、後ろより先に前を出す（次へ送る方がありそう
// な動き）。ステージの前後の送りが回り込むので、こちらも回り込む。今のスライドとの間でも
// 互いの間でも重複を除く＝1つのグループが同じ src を繰り返しうるし、2件のグループでは
// 左右の隣が同じものになる。
export function neighborPreloadSources(items: readonly PreloadableItem[], idx: number, radius: number = PRELOAD_RADIUS): string[] {
  const n = items.length;
  if (n < 2 || radius < 1) return [];
  const at = (k: number) => ((k % n) + n) % n;
  const cur = at(idx);
  const seen = new Set<string>();
  const curSrc = stillSourceOf(items[cur]);
  if (curSrc) seen.add(curSrc);
  const out: string[] = [];
  for (let d = 1; d <= radius; d++) {
    for (const k of [cur + d, cur - d]) {
      if (at(k) === cur) continue; // 半径が枚数以上だと、回り込んで表示中のスライドに戻る
      const src = stillSourceOf(items[at(k)]);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push(src);
    }
  }
  return out;
}

export interface NeighborPreloader {
  // 抱えている集合をちょうど `sources` にする。新しく入ったものを始め、去ったものを手放す。
  sync(sources: readonly string[]): void;
  clear(): void;
  held(): string[];
}

export function createNeighborPreloader(): NeighborPreloader {
  const held = new Map<string, HTMLLinkElement>();
  const remove = (src: string) => {
    held.get(src)?.remove();
    held.delete(src);
  };
  return {
    sync(sources) {
      for (const src of [...held.keys()]) if (!sources.includes(src)) remove(src);
      for (const src of sources) {
        if (held.has(src)) continue;
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = src;
        document.head.append(link);
        held.set(src, link);
      }
    },
    clear() {
      for (const src of [...held.keys()]) remove(src);
    },
    held: () => [...held.keys()],
  };
}

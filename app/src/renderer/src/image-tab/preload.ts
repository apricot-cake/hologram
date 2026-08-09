// 画像タブの隣の先読み（#241）。グループを送っていくと、以前はどのスライドも冷たい状態
// から始まっていた。ステージはメディアを `src` で key にしているので、前後の送りは古い
// 要素を壊して新しい要素を載せる。その新しい要素には当たれる温かいものが何も無かった＝
// 取得もデコードも。グリッドはずっと前から `decoding="async"` を持っていたのに、大きな
// 絵を実際に見る画面には何も無かった。
//
// 手段はマークアップではなく `new Image()` と `HTMLImageElement.decode()` の2つ。ブラウザ
// 標準の候補と、他が落ちる理由:
//   - `<link rel="preload" as="image">` はダウンロードの予約しかしない（"it doesn't
//     load and execute … but only schedules it to be downloaded and cached"、MDN）。
//     `asset://` でローカルディスクから読むライブラリの原本では、ダウンロードは安い方の
//     半分で、次の描画が待つのは数千 px の JPEG のデコードの方。しかも1回のナビゲーション
//     に向けた宣言的な head のマークアップなので、キー入力ごとに動く添字には合わない。
//   - `fetchpriority` は既に出ている要求の順序を変えるだけ。何も始めないので、DOM がまだ
//     求めていない画像を温めることはできない。
//   - 生きている要素に対する `decode()` は、既に画面に出ているスライドしか助けない。
//   - DOM から切り離した要素に対する `decode()` は、まさに MDN がこの用途として書いている
//     場合そのもので（"initiate loading of the image prior to attaching it to an element
//     in the DOM … so that the image can be rendered immediately upon being added"）、
//     MDN の `decoding` のページ自身も、属性だけでは足りないときのより良い答えとしてこれを
//     指している。取得とデコードの両方を覆う＝受け入れ条件が求めているのはそれ。
//
// ライブラリは足していない。DOM の呼び出しが2つあるだけ。
export const PRELOAD_RADIUS = 1;

// デコード済みの隣を高々 2 × PRELOAD_RADIUS 枚だけ抱え、送りのたびに他をすべて追い出す
// ことで、メモリに上限を置いている。参照は必ず握っていなければならない＝投げっぱなしの
// `new Image()` は `decode()` が決着した瞬間に回収されうるので、その働きが、目当ての
// キーを利用者が押す前に捨てられかねない。つまり握ることと上限を置くことは同じ行いで、
// だから窓は1のままにしてある。4000×4000 の原本はデコードすると 4000·4000·4 ≈ 64MB
// かかるので、半径1は 128MB 近くで頭打ちになる＝UgoiraPlayer の 96MB のフレームの予算と
// 同じ桁で、半径2にすればそれを倍にするだけで届く先は増えない。そもそも半径が買うのは
// 届く先ではない。前後の送りも ←/→ もちょうど1つ動くので、半径1で次の入力が着地しうる
// 升目は左右とも既に覆えている。

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
  const held = new Map<string, HTMLImageElement>();
  return {
    sync(sources) {
      for (const src of [...held.keys()]) if (!sources.includes(src)) held.delete(src);
      for (const src of sources) {
        if (held.has(src)) continue;
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        held.set(src, img);
        // 要求が失敗した場合やデータが壊れている場合、decode() は EncodingError で
        // 拒否する（MDN）。デコードできない隣はここでは誤りではない＝それを見せる
        // スライドが、自分で壊れた状態を描く。
        void img.decode().catch(() => {});
      }
    },
    clear() {
      held.clear();
    },
    held: () => [...held.keys()],
  };
}

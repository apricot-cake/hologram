'use strict';

// タグのモデル（#50）にまつわるもののうち、I/O ではなく算術であるもの全部。ラベルのファイルを
// 読むこと、画像をモデルが求めるテンソルの形にすること、10,861個の生のスコアを候補のタグへ
// 戻すこと。
//
// 意図して Electron に依存せず、副作用も持たない。ここでは決められない2つ＝JPEG がどうピクセルに
// なるか、グラフをどう走らせるか＝は、この Issue の設計が再発明してはいけないと言っている2つ
// （それぞれ nativeImage と #831 のランタイム）。lib-ai-tags-job.ts がそれらをここへ繋ぐ。
//
// 算術はこちらが選べるものではない。モデルの作者自身の参照実装（`SmilingWolf/wd-tagger` の
// Space）を再現している。重みがまさにその前処理に対して学習されているため。このファイルがそこから
// 逸れるところでは、逸れていることと理由を述べる。

/** グラフが宣言する正方形のテンソルの辺。入力 `input` は [batch, 448, 448, 3]。 */
export const TAGGER_INPUT_SIZE = 448;

/**
 * 参照実装自身の既定値。意図して設定にはしていない（2026-07-11）。利用者が解釈できない数値は
 * 操作子ではなく、どちらへ回しても機能が壊れているように感じさせるつまみ。実際のライブラリに
 * 対してこれらを詰めることは #50 §10 に残っている実測で、その結果この定数が動く。
 */
export const TAGGER_THRESHOLDS = { general: 0.35, character: 0.85 } as const;

/** selected_tags.csv の `category` の列。 */
export const TAG_CATEGORY = { general: 0, copyright: 3, character: 4, rating: 9 } as const;

export interface TagVocabulary {
  /** 表示用に正規化した名前。グラフの出力の順。 */
  names: string[];
  /** selected_tags.csv の category の列。順序は同じ。 */
  categories: number[];
}

export interface AiTagCandidate {
  name: string;
  category: number;
  score: number;
}

export interface TaggerOutput {
  /** しきい値を超えたもの。強い順。rating はここに入らない。 */
  tags: AiTagCandidate[];
  /** rating のラベル全部と、そのスコア＝記録はするが、決して表示しない（2026-07-11）。 */
  ratings: AiTagCandidate[];
}

// 語ではなく顔の絵であるタグ。参照実装がこれらのアンダースコアを残しているのは、見れば分かる
// 理由から。アンダースコアを置き換えた `^_^` は同じタグではなく、肩をすくめる仕草になる。
const KAOMOJI = new Set(['0_0', '(o)_(o)', '+_+', '+_-', '._.', '<o>_<o>', '<|>_<|>', '=_=', '>_<', '3_3', '6_9', '>_o', '@_@', '^_^', 'o_o', 'u_u', 'x_x', '|_|', '||_||']);

/** `hair_ornament` → `hair ornament`。ただし `^_^` → `^_^`。 */
export function normalizeTagName(raw: string): string {
  return KAOMOJI.has(raw) ? raw : raw.replace(/_/g, ' ');
}

/**
 * RFC 4180 の CSV の1行。split(',') ではなく自前で書いてあるのは、ラベルのファイルが実際に、
 * 中に二重化した引用符を含む引用付きの欄（`don't_say_""lazy""`）を持つため。素朴な分割ではその
 * 行の category がずれ、タグに黙って違うラベルが付く。
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      fields.push(field);
      field = '';
    } else field += c;
  }
  fields.push(field);
  return fields;
}

/**
 * selected_tags.csv をグラフの出力の順で読む。
 *
 * 行の順序こそが出力の順序＝グラフの 10,861個のスコアの添字 i が、このファイルの i 行目。だから
 * このファイルは重みと並んで固定され、ハッシュを取られている（lib-model-registry.ts）。別の版の
 * ファイルは失敗するのではなく、すべてのタグを別の名前にしてしまう。
 */
export function parseSelectedTags(csv: string): TagVocabulary {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) throw new Error('selected_tags.csv is empty');
  const header = parseCsvLine(lines[0]);
  const nameCol = header.indexOf('name');
  const categoryCol = header.indexOf('category');
  if (nameCol < 0 || categoryCol < 0) throw new Error('selected_tags.csv has no name/category columns');

  const names: string[] = [];
  const categories: number[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    names.push(normalizeTagName(fields[nameCol]));
    categories.push(Number(fields[categoryCol]));
  }
  return { names, categories };
}

/** nativeImage が生のピクセルを返す並び。プラットフォーム依存なので、仮定せず実測する。 */
export type BitmapChannelOrder = 'rgba' | 'bgra';

/**
 * レターボックスに入れる前に画像を縮める先の大きさ。長い辺をちょうど `size` にし、縦横比を保ち、
 * 0 にはしない。
 *
 * 参照実装は先に余白を足し、その正方形を後から縮める。順序を逆にしても絵は同じ＝違いは、
 * バイキュービックが白い枠の細い線を外側のピクセルへ混ぜなくなることだけ＝そして、448x448 を
 * 確保するのと、短辺512のサムネイルの正方形を確保するのとの差になる。縦長の画像ではそれが
 * 数百 MB。
 */
export function fitLongEdge(width: number, height: number, size = TAGGER_INPUT_SIZE): { width: number; height: number } {
  const scale = size / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * 復号したビットマップを白い正方形の中央へ置き、グラフのテンソルを出す。NHWC [1, size, size, 3]、
 * BGR、0-255、正規化なし。
 *
 * この4つはいずれも慣習ではなくモデルの要求＝どれか1つでも間違えると、違う絵に対してもっともらしい
 * スコアが出る。ありものの画像処理器なら黙ってこちらに渡してきたであろう失敗が、まさにそれ
 * （#50 §0-2）。
 */
export function letterboxToTaggerInput(bitmap: Uint8Array, width: number, height: number, order: BitmapChannelOrder, size = TAGGER_INPUT_SIZE): Float32Array {
  if (width > size || height > size) throw new Error(`bitmap ${width}x${height} does not fit in ${size}x${size}`);
  if (bitmap.length < width * height * 4) throw new Error(`bitmap is ${bitmap.length} bytes, expected ${width * height * 4}`);

  const out = new Float32Array(size * size * 3).fill(255); // 余白は黒ではなく白
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  const [bIn, gIn, rIn] = order === 'bgra' ? [0, 1, 2] : [2, 1, 0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = ((top + y) * size + (left + x)) * 3;
      // アルファを捨てるのではなく白の上に合成する。サムネイルのキャッシュの JPEG は既に
      // 不透明なので、そこでは恒等変換になる。しかしこの関数は RGBA の入力も通る道であり、
      // 参照実装は何よりも先に白の上へ合成する。
      const a = bitmap[s + 3] / 255;
      out[d] = bitmap[s + bIn] * a + 255 * (1 - a);
      out[d + 1] = bitmap[s + gIn] * a + 255 * (1 - a);
      out[d + 2] = bitmap[s + rIn] * a + 255 * (1 - a);
    }
  }
  return out;
}

/**
 * グラフの生の出力 → 候補。
 *
 * 活性化関数は当てない。シグモイドは ONNX のグラフの中にあるので、この数値は既にタグごとの確率＝
 * transformers.js の image-classification のパイプラインを使えなかった理由もそこ。あれは 10,861
 * 個のクラス全体に無条件でソフトマックスを掛けるが、これはクラスが互いに独立な多ラベルのモデル。
 */
export function decodeTaggerOutput(scores: ArrayLike<number>, vocab: TagVocabulary, thresholds = TAGGER_THRESHOLDS): TaggerOutput {
  if (scores.length !== vocab.names.length) {
    throw new Error(`model produced ${scores.length} scores but the label file has ${vocab.names.length} rows`);
  }
  const tags: AiTagCandidate[] = [];
  const ratings: AiTagCandidate[] = [];
  for (let i = 0; i < scores.length; i++) {
    const category = vocab.categories[i];
    const candidate = { name: vocab.names[i], category, score: scores[i] };
    if (category === TAG_CATEGORY.rating) {
      ratings.push(candidate);
      continue;
    }
    // copyright は character としきい値を共有する。どちらも固有名詞で、惜しい外し方は、
    // 曖昧な主張ではなく、絵が何を描いているかについての誤った主張になるため。（この版の語彙は
    // たまたま copyright の行を1つも含まない＝general 8106、character 2751、rating 4＝ので、
    // この分岐はこのモデルの出力のためではなくスキーマのために置いてある。）
    const threshold = category === TAG_CATEGORY.general ? thresholds.general : thresholds.character;
    if (candidate.score >= threshold) tags.push(candidate);
  }
  tags.sort((a, b) => b.score - a.score);
  ratings.sort((a, b) => b.score - a.score);
  return { tags, ratings };
}

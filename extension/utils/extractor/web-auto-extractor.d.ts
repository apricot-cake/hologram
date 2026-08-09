// @marbec/web-auto-extractor の ambient 型定義 (#239)。パッケージ自身は .d.ts を
// 同梱していない（公開 tarball で確認、2026-08-03）。型は緩く付けている（WaeNode は
// schema.org の未知のプロパティを入れる袋）。このライブラリの仕事はマークアップを
// 形式と @type でバケットに仕分けることであって、schema.org が許すプロパティを
// 残らず記述することではない。web-meta.ts 側の読み出しが、触る欄ごとに型を絞って
// いる。
declare module '@marbec/web-auto-extractor' {
  export type WaeNode = Record<string, unknown>;
  export type WaeBucket = Record<string, WaeNode[]>;

  export interface WaeHeading {
    tag: string;
    level: number;
    text: string;
    order: number;
  }

  export interface WaeError {
    message: string;
    format: string;
    source: string;
  }

  export interface WaeParsed {
    // キーはページが書いた属性値（`content`/`name`/`property`）そのもので、大小文字も
    // そのまま＝`DC.creator` も `citation_author` もその綴りのままで引ける。小文字化
    // されることは一切ない。呼ぶ側は大小文字を無視して突き合わせること
    // （web-meta.ts の metaLookup がそうしている）。
    metatags: Record<string, string[]>;
    microdata: WaeBucket;
    rdfa: WaeBucket;
    jsonld: WaeBucket;
    headings: WaeHeading[];
    // ライブラリが解釈できなかったマークアップ1ブロックにつき1エントリ（壊れた
    // JSON-LD など）。そのブロックは上の jsonld/microdata/rdfa から単に欠けるだけで、
    // 例外は投げない。1ブロック壊れても他が巻き添えを食うことはない。
    errors: WaeError[];
  }

  export interface WaeOptions {
    addLocation?: boolean;
    embedSource?: boolean | string[];
    skipEmptyHeadings?: boolean;
    skipLayoutElements?: boolean;
  }

  export default class WebAutoExtractor {
    constructor(options?: WaeOptions);
    parse(html: string): WaeParsed;
  }
}

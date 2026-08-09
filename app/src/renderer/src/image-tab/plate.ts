// 画像表示の浮いた操作部品（P2⑫）の調子＝前後送り・スライドの枚数表示・インスペクタの
// 切り替え・うごイラの再生ボタン。そのすべてに半透明でぼかした plate を1枚ぶん共有させる。
// そうしないと、ウィンドウを埋めるステージの中で「操作部品とはどう見えるものか」の考えが
// 4通りに割れてしまう。以前は .itv-nav / .itv-counter / .icon-btn だった＝手で混ぜた
// color-mix の塗りが3種類と、アイコンの代わりに置いた 28px の "‹" のテキストグリフ。
//
// 境界線は飾りではない。--background から色を取った半透明の面は、たまたま同じ色の角を持つ
// 画像に対して自前の縁を持たない。しかも白い作品はここでは普通に起きる。サンドボックスで
// 実測したところ、plate はただ消え、山形の記号だけが浮いて残った。これらが手本にしている
// ビューア（Windows フォト・Eagle・IrfanView）はどれも同じ理由で、操作部品にはっきりした
// 境界を与えている。
//
// ImageTab.tsx からの export ではなく独立したモジュールにしてある: UgoiraPlayer は
// ImageTab の子なので、上へ import し返すと循環になる。
export const PLATE_SURFACE = 'border-border bg-background/80 shadow-xs backdrop-blur-sm';
export const PLATE = `${PLATE_SURFACE} text-muted-foreground hover:bg-background hover:text-foreground`;

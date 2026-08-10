// scripts/tsconfig.test.json専用の型参照（そちらの`include`がこのファイルを
// 名指ししている＝実行時のコードはこれをimportしない）。
//
// extension/utils/background.tsへ至るスイートは、それと一緒にtokens.tsを
// 引き込み、そのモジュールはVite独自の`?inline`サフィックス付きでCSSを
// importする＝これはvite/clientだけが宣言する指定子。それが無いとimportは
// `any`になり、これは単なる1件のTS2307では済まない: その`any`がtokens.tsの
// state()の絞り込みを台無しにし、そこで2つ目の一見無関係なエラーを報告する。
//
// プロジェクトの`types`配列のエントリではなく`/// <reference types>`にする:
// あちらのプロジェクトは`typeRoots`を設定しており、TypeScriptはそのルーツの
// 「下」でだけ全ての`types`エントリを解決する＝"vite/client"は@typesパッケージ
// ではないので、TS2688で返ってくる。reference指令は通常のモジュール解決を
// 経由して実物のパッケージを見つける。（extension/tsconfig.jsonはtypeRootsを
// 設定していないので`types`にこれを名指しできる。）
/// <reference types="vite/client" />

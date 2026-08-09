'use strict';

// ライブラリの JSON（ゴミ箱のレコード、取込エンベロープ、設定、ZIP のエントリ、
// legacy マイグレーションがまだ読む #5 以前のディスク上形式）をファイルから読んで
// パースする時のための、BOM を許容する JSON.parse。これらのファイルと設定は
// 利用者が手で編集しうる素のファイルで、Windows のエディタは UTF-8 の BOM を
// 先頭に付けたがる——それは utf8 デコードを生き延びて先頭の U+FEFF になり、
// 素の JSON.parse を例外で落とす。こうした例外の経路はすべて「壊れている／
// 存在しない」として読まれる: sidecar が黙ってライブラリから抜け落ち、最悪の
// 場合 record:null → reconcile がその captureId をコレクションから恒久的に
// 消し去る（BACKLOG L3）。BOM だけは許容し、それ以外の不正な形式は引き続き
// 例外を投げる。
function parseJsonLoose(text) {
  return JSON.parse(typeof text === 'string' && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

export { parseJsonLoose };

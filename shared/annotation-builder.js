// Info+ annotation 文字列の構築。仕様は docs/todo.md「annotation 最終仕様」。
// annotation-parser.js と round-trip する形式 (build → parse でフィールドが一致)。
//
// 用途:
//   - plugin のバックフィル (リンクはあるが Info+ 注釈が無い既存アイテムに、SNS API の meta から
//     後追いで注釈を書く)。投稿レベル情報のみ (Image / Alt は URL から画像を特定できないため付かない)。
//   - 将来 extension/ を shared から import する build 統合時にドラッグ経路も共用する想定
//     (現状 extension は package 外の shared を import できないため自前の buildAnnotation を持つ)。
//
// hashtags は「#なし」配列でも「#あり」でも受ける (内部で正規化)。author は @ なしの handle/userId。

const PLATFORM_LABEL = { x: 'X (Twitter)', bluesky: 'Bluesky', pixiv: 'Pixiv' };

export function platformLabel(platform) {
  return PLATFORM_LABEL[platform] || platform || null;
}

function sanitize(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function truncate(text, maxLen) {
  return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '…';
}

// fields: { platform | platformLabel, displayName, author, hashtags, image, alt, text, title }
//   pixiv は title を使い alt は出さない / X・Bluesky は text + alt。
//   title と text の両方があれば title 優先 (pixiv)。取れた行だけ出力し、空なら null。
export function buildAnnotation(fields = {}) {
  const label = fields.platformLabel || platformLabel(fields.platform);
  const lines = [];
  if (label) lines.push(`Platform: ${sanitize(label)}`);
  if (fields.displayName) lines.push(`Display Name: ${sanitize(fields.displayName)}`);
  if (fields.author) lines.push(`Author: @${sanitize(fields.author)}`);
  if (fields.image) lines.push(`Image: ${sanitize(fields.image)}`);
  if (fields.hashtags && fields.hashtags.length) {
    const tags = fields.hashtags
      .map((h) => sanitize(h).replace(/^#+/, ''))
      .filter(Boolean)
      .map((h) => `#${h}`);
    if (tags.length) lines.push(`Hashtags: ${tags.join(' ')}`);
  }
  // alt のデフォルト代替文言 (Eagle for Chrome が付ける '画像' / 'Image') はノイズなので落とす
  if (fields.alt && fields.alt !== '画像' && fields.alt !== 'Image') {
    lines.push(`Alt: ${truncate(sanitize(fields.alt), 200)}`);
  }
  if (fields.title) {
    lines.push(`Title: ${truncate(sanitize(fields.title), 200)}`);
  } else if (fields.text) {
    lines.push(`Text: ${truncate(sanitize(fields.text), 200)}`);
  }
  return lines.length ? lines.join('\n') : null;
}

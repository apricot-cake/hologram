// Eagle Info+ が書く annotation を構造化オブジェクトに parse する。
// 仕様: docs/todo.md の「annotation 最終仕様」セクション。
//
// 入力例 (X / Bluesky):
//   Platform: X (Twitter)
//   Display Name: たっぷり鈍器🫀⚒
//   Author: @ihana_k
//   Image: 1/3
//   Hashtags: #foo #bar
//   Alt: 画像の説明
//   Text: 投稿本文
//
// 入力例 (pixiv):
//   Platform: Pixiv
//   Display Name: 赤倉＠画集発売中
//   Author: @882569
//   Image: 1/3
//   Hashtags: #foo #bar
//   Title: チュッパチャプス ストロベリー

const PLATFORM_NORMALIZE = {
  'X (Twitter)': 'x',
  'Bluesky': 'bluesky',
  'Pixiv': 'pixiv'
};

// 行頭が "Key: " 形式で値を取り出す。Key は英字 + 半角スペースのみ。
const LINE_RE = /^([A-Z][A-Za-z ]*?):\s*(.*)$/;

export function parseAnnotation(text) {
  if (!text || typeof text !== 'string') return null;

  const fields = {};
  for (const line of text.split('\n')) {
    const m = line.match(LINE_RE);
    if (m) fields[m[1]] = m[2];
  }

  // Platform 行が無ければ Info+ が書いた annotation ではない
  if (!fields.Platform) return null;

  const platform = PLATFORM_NORMALIZE[fields.Platform] || null;
  const author = fields.Author?.startsWith('@') ? fields.Author.slice(1) : (fields.Author || null);
  const hashtags = fields.Hashtags
    ? fields.Hashtags.split(/\s+/).map(t => t.startsWith('#') ? t.slice(1) : t).filter(Boolean)
    : [];

  return {
    platform,                                 // 'x' | 'bluesky' | 'pixiv' | null
    platformLabel: fields.Platform,           // 元の表記 ('X (Twitter)' 等)
    displayName: fields['Display Name'] || null,
    author: author || null,                   // @ 抜きの handle / userId
    image: fields.Image || null,              // '1/3' / null
    hashtags,                                 // # 抜きの配列
    alt: fields.Alt || null,                  // X / Bluesky のみ
    text: fields.Text || null,                // X / Bluesky の post body
    title: fields.Title || null,              // pixiv の作品タイトル
    // 旧仕様 (Phase 1 以前) との互換用 — Window Plugin が古い library を sync する場合に備える
    legacy: {
      uid: fields.UID || null,
      postId: fields['Post ID'] || null,
      publishedAt: fields.Published || null,
      description: fields.Description || null
    }
  };
}

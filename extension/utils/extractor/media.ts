// 複数の extractor が共有するメディア URL の規則。

// サムネイルと元画像はファイル ID（ハッシュ）を共有する。これは URL の basename
// からクエリと拡張子を落としたもの。添付を、独自のパス体系を持つリサイズ CDN
// 経由ではなく、ドライブ上の素のファイルとして配信するサイト
// ならどこでも成り立つ。
function fileBasenameKey(url: string): string | null {
  const base = (url.split(/[?#]/)[0]?.match(/([^/]+)$/) || [])[1] || '';
  return base.replace(/\.[a-z0-9]+$/i, '') || null;
}

export { fileBasenameKey };

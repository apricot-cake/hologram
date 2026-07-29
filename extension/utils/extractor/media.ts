// Media-URL rules shared by more than one extractor.

// A thumbnail and its original share the file id / hash, which is the URL
// basename minus query and extension. True of any site that serves attachments
// as plain files off a drive (Misskey, Mastodon) rather than through a resizing
// CDN with its own path scheme.
function fileBasenameKey(url: string): string | null {
  const base = (url.split(/[?#]/)[0]?.match(/([^/]+)$/) || [])[1] || '';
  return base.replace(/\.[a-z0-9]+$/i, '') || null;
}

export { fileBasenameKey };

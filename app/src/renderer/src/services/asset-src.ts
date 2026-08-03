// The asset:// URL builder for a bare filename under the save folder — was a
// const inline inside orchestrator.ts's closure (the "image source" section);
// pulled out (#777) because the tag-split review screen needs it too and it is
// pure (no closed-over state), so a second copy would just be a literal fork of
// the same one-liner. orchestrator.ts re-exports its own `fileSrc` name for its
// existing callers (records-builder.ts etc. take it injected via deps) — this
// module is the one implementation both reach.
export function fileSrc(file: string, w?: number): string {
  return file ? 'asset://img/' + encodeURIComponent(file) + (w ? '?w=' + w : '') : '';
}

// The inverse of fileSrc's bare (no `?w=`) form — pulls the library filename
// back out of an already-built asset:// URL. Pin's toolbar entry point (#79)
// is the one caller: the image tab only hands out finished src strings
// (services/image-tab.ts), never the bare filename a PinItem needs.
export function fileOfSrc(src: string): string {
  const m = /^asset:\/\/img\/([^?]+)/.exec(src);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return '';
  }
}

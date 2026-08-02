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

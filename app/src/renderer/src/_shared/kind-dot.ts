// The 種別 (tag-kind) colour dot, shared by the filter bar's value list and the 種別
// context menu. Kind colours are app DOMAIN, not ui-kit styling — the two hues follow
// danbooru's tag-category convention (copyright/作品 = purple, character/キャラ = green),
// which is what a user coming from an image booru already reads.
//
// A class-string helper rather than a component: both call sites wrap the span in
// something of their own (a Tooltip / a menu row), so what they need is the tone.
// Any other kind gets the geometry and no fill — a dot with no assigned colour is
// drawn as an empty ring rather than guessing a hue for it.
const TINT: Record<string, string> = {
  work: 'bg-[var(--tint-purple-bd)]',
  character: 'bg-[var(--tint-green-bd)]',
};

export function kindDotClass(kind: string | undefined): string {
  return `size-2 shrink-0 rounded-full ${TINT[kind ?? ''] ?? 'border border-border'}`;
}

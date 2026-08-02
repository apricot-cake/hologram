// Regression guard for #581: the banner must draw in front of the selection
// frame, always, from one place. Both surfaces are position:fixed siblings in
// the shared ShadowRoot with no natural stacking order of their own (no
// transform/opacity/etc. establishes one) -- before this, DOM insertion order
// alone decided who painted on top, and capture.ts happens to insert the
// highlight right after the banner, so a post that fills the viewport (#325)
// drew the frame's edge straight through the banner's text.
//
// This is a text-level check on components.css rather than a rendered one:
// jsdom does not lay out or paint (no stacking context, no adoptedStyleSheets
// resolution reaching getComputedStyle), so there is nothing a browser-level
// assertion could read here that this file doesn't already say directly.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', 'utils', 'components.css'), 'utf8');

// Pulls a numeric custom-property VALUE out of the raw CSS text. Both names
// are unique across the file (there is exactly one declaration of each), so a
// plain substring search is enough -- no need to first isolate which of the
// file's two `:host` blocks declares them.
function customPropertyValue(name: string): number {
  const marker = name + ':';
  const at = CSS.indexOf(marker);
  if (at === -1) throw new Error('custom property not declared in components.css: ' + name);
  const rest = CSS.slice(at + marker.length);
  const match = rest.match(/^\s*(\d+)/);
  if (!match) throw new Error('custom property has no numeric value: ' + name);
  return Number(match[1]);
}

// Whether SELECTOR's rule contains NEEDLE, found by locating the selector's
// own opening/closing braces (none of these rules nest, so the first
// following `}` is the rule's end).
function ruleContains(selector: string, needle: string): boolean {
  const selectorAt = CSS.indexOf(selector + ' {');
  if (selectorAt === -1) throw new Error('selector not found in components.css: ' + selector);
  const braceStart = CSS.indexOf('{', selectorAt);
  const braceEnd = CSS.indexOf('}', braceStart);
  return CSS.slice(braceStart, braceEnd).includes(needle);
}

describe('#581 スタッキングは一箇所（components.css）が決める', () => {
  test(':host の --z-locate と --z-explain: explain の方が大きい（前面）', () => {
    expect(customPropertyValue('--z-explain')).toBeGreaterThan(customPropertyValue('--z-locate'));
  });

  test('バナー / ドロップゾーン（.surface）は --z-explain を使う', () => {
    expect(ruleContains('.surface', 'z-index: var(--z-explain)')).toBe(true);
  });

  test('選択枠（.highlight）は --z-locate を使う（.surface より低い）', () => {
    expect(ruleContains('.highlight', 'z-index: var(--z-locate)')).toBe(true);
  });

  // Neither name may collide with the app's design-token namespace: they are
  // not colors/motion generated from the app's globals.css, and giving them
  // the `--hologram-` prefix would make extension-tokens.test.ts's "every
  // referenced --hologram-* exists in the generated set" guard fail on them.
  test('--z-* は --hologram-* 名前空間と衝突しない（トークン生成の対象外）', () => {
    expect(CSS.includes('--hologram-z-')).toBe(false);
  });
});

import { useEffect, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Hint } from '../components/Hint.tsx';
import { t } from '../../_shared/i18n.ts';
import { notify } from '../../services/ui.ts';
import { comboFromEvent, comboLabel, list, resetToDefault, setCustomCombo, subscribe, type ShortcutRow } from '../../services/shortcut-registry.ts';

// #246: settings > shortcuts. One row per registered command (services/shortcut-registry.ts
// is the single source of truth — a command that never called registerShortcut() cannot
// appear here, and this list is never hand-maintained). The UI shape follows the Issue's
// design comment: a default/custom radio per row (digiKam / Calibre both land on this
// independently), and no search box — the roster is under 30 rows, two orders of magnitude
// short of where digiKam/Calibre/Hydrus add one (150+).
//
// Curated display order (registration order is really "whichever module happened to import
// first" — not something a user should have to make sense of).
const ORDER = [
  'undo',
  'redo',
  'selection.selectAll',
  'selection.copyImage',
  'selection.quickView',
  'search.focus',
  'grid.sizeIncrease',
  'grid.sizeDecrease',
  'zoom.fit',
  'zoom.actual',
  'clipboard.paste',
  'panels.toggle',
  'palette.open',
  'palette.openFulltext',
  'nav.back',
  'nav.forward',
  'tabs.new',
  'tabs.close',
  'tabs.next',
  'tabs.prev',
];

function orderedRows(rows: ShortcutRow[]): ShortcutRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ShortcutRow[] = [];
  for (const id of ORDER) {
    const r = byId.get(id);
    if (r) {
      out.push(r);
      byId.delete(id);
    }
  }
  // Anything registered but not in ORDER (should not normally happen) still shows up,
  // rather than silently vanishing from the settings page.
  return [...out, ...byId.values()];
}

// Modifier-only keydowns (still building the chord) don't resolve to anything yet.
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

export function Shortcuts() {
  const [rows, setRows] = useState<ShortcutRow[]>(() => orderedRows(list()));
  const [recordingId, setRecordingId] = useState<string | null>(null);

  useEffect(() => subscribe(() => setRows(orderedRows(list()))), []);

  const startCustom = (id: string) => setRecordingId(id);

  const cancelCustom = () => setRecordingId(null);

  const capture = (id: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    if (MODIFIER_KEYS.has(e.key)) return; // still holding modifiers down — wait for the real key
    if (e.key === 'Escape') {
      cancelCustom();
      return;
    }
    // React's KeyboardEvent carries the same ctrlKey/metaKey/shiftKey/altKey/key shape
    // comboFromEvent reads — structurally compatible with the DOM one it's typed for.
    const res = setCustomCombo(id, comboFromEvent(e as unknown as KeyboardEvent));
    if (!res.ok) notify(t('shortcutConflict', [res.conflict.title]));
    setRecordingId(null);
  };

  return (
    <div className="space-y-1">
      <Hint text={t('shortcutsSectionHint')} />
      <div className="divide-border mt-3 divide-y">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="text-sm">{row.title}</span>
            <div className="flex items-center gap-2">
              <ToggleGroup
                variant="outline"
                spacing={0}
                size="sm"
                value={[row.isCustom || recordingId === row.id ? 'custom' : 'default']}
                onValueChange={(v) => {
                  if (!v.length) return;
                  if (v[0] === 'default') {
                    cancelCustom();
                    resetToDefault(row.id);
                  } else {
                    startCustom(row.id);
                  }
                }}
                aria-label={row.title}
              >
                <ToggleGroupItem value="default">{t('shortcutDefault')}</ToggleGroupItem>
                <ToggleGroupItem value="custom">{t('shortcutCustom')}</ToggleGroupItem>
              </ToggleGroup>
              {recordingId === row.id ? (
                <input autoFocus readOnly value="" placeholder={t('shortcutPressKey')} onKeyDown={(e) => capture(row.id, e)} onBlur={cancelCustom} className="border-input bg-background text-muted-foreground focus:border-ring h-8 w-40 rounded-md border px-2.5 text-xs outline-none" />
              ) : (
                <code className="bg-muted min-w-24 rounded-md px-2.5 py-1 text-center font-mono text-xs">{comboLabel(row.currentCombo)}</code>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Hint } from '../components/Hint.tsx';
import { t } from '../../_shared/i18n.ts';
import { notify } from '../../services/ui.ts';
import { comboFromEvent, comboLabel, list, resetToDefault, setCustomCombo, subscribe, type ShortcutRow } from '../../services/shortcut-registry.ts';

// #246: 設定 > ショートカット。登録されたコマンド1つにつき1行（正本は
// services/shortcut-registry.ts の1つだけ＝registerShortcut() を一度も呼んでいない
// コマンドはここに現れないし、この一覧を手で保守することもない）。UI の形は Issue の
// 設計コメントに従う＝行ごとに既定／独自のラジオ（digiKam と Calibre がどちらも独立に
// この形に行き着いている）と、検索欄は置かないこと。並ぶのは30行に満たず、
// digiKam・Calibre・Hydrus が検索欄を足す規模（150行以上）より2桁少ない。
//
// 表示の順は選んで決める（登録の順は実のところ「たまたま先に import されたモジュール順」で、
// 利用者が意味を読み取らされるべきものではない）。
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
  // 登録済みだが ORDER に無いもの（普通は起きないはず）も、設定のページから黙って
  // 消えるのではなく、ちゃんと出るようにする。
  return [...out, ...byId.values()];
}

// 修飾キーだけの keydown（まだキーの組み合わせを組み立てている途中）は、まだ何にも解決しない。
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

export function Shortcuts() {
  const [rows, setRows] = useState<ShortcutRow[]>(() => orderedRows(list()));
  const [recordingId, setRecordingId] = useState<string | null>(null);

  useEffect(() => subscribe(() => setRows(orderedRows(list()))), []);

  const startCustom = (id: string) => setRecordingId(id);

  const cancelCustom = () => setRecordingId(null);

  const capture = (id: string, e: React.KeyboardEvent) => {
    e.preventDefault();
    if (MODIFIER_KEYS.has(e.key)) return; // まだ修飾キーを押さえているだけ＝本来のキーを待つ
    if (e.key === 'Escape') {
      cancelCustom();
      return;
    }
    // React の KeyboardEvent は comboFromEvent が読む ctrlKey/metaKey/shiftKey/altKey/key
    // と同じ形を持つ＝型としては DOM の側に付けてあるが、構造として互換がある。
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
                /* biome-ignore lint/a11y/noAutofocus: this input exists ONLY to catch the
                   next keypress — it appears because the user just chose "custom", and
                   without the focus there is nothing to press a key into. The rule is
                   about autofocus on page load stealing focus from the user; here the
                   user's own click is what put it on screen. */
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

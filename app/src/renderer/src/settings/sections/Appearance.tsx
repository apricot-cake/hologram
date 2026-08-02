import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingRow } from '../components/SettingRow.tsx';
import { FontCombobox } from '../components/FontCombobox.tsx';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';

const cleanPref = (p: unknown) => (p === 'light' || p === 'dark' ? p : 'auto');
const cleanFont = (p: unknown) => (typeof p === 'string' ? p : '');

// Appearance: theme (auto/light/dark) + interface font (#137).
//
// "Show info on tiles" used to sit here too. It is gone (#618): "Show Info" is one of
// the display popover's two grid switches now, and the same answer must not be asked
// twice on two surfaces.
export function Appearance() {
  const [theme, setTheme] = useState(() => ipc.theme.get());
  const [uiFont, setUiFont] = useState(() => ipc.uiFont.get());

  // Reconcile with persisted prefs once they resolve — theme.js / ui-font-api.ts may
  // still be syncing config from IPC when the component first mounts.
  useEffect(() => {
    ipc
      .getPrefs()
      .then((p) => {
        if (p?.theme) setTheme(cleanPref(p.theme));
        if (typeof p?.uiFontFamily === 'string') setUiFont(cleanFont(p.uiFontFamily));
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <SettingRow label={t('themeMode')} hint={t('hintTheme')}>
        <Select
          items={{ auto: t('themeAuto'), light: t('themeLight'), dark: t('themeDark') }}
          value={theme}
          onValueChange={(v) => {
            if (v === null) return;
            setTheme(v);
            ipc.theme.set(v);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('themeAuto')}</SelectItem>
            <SelectItem value="light">{t('themeLight')}</SelectItem>
            <SelectItem value="dark">{t('themeDark')}</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label={t('uiFontLabel')} hint={t('uiFontHint')}>
        <FontCombobox
          value={uiFont}
          onPreview={(v) => ipc.uiFont.preview(v)}
          onCommit={(v) => {
            setUiFont(v);
            ipc.uiFont.commit(v);
          }}
        />
      </SettingRow>
    </div>
  );
}

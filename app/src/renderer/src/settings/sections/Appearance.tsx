import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingRow } from '../components/SettingRow.tsx';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';

const cleanPref = (p: unknown) => (p === 'light' || p === 'dark' ? p : 'auto');

// 外観: theme (auto/light/dark).
//
// 「タイルに情報を表示」 used to sit here too. It is gone (#618): 情報を表示 is one of
// the display popover's two grid switches now, and the same answer must not be asked
// twice on two surfaces.
export function Appearance() {
  const [theme, setTheme] = useState(() => ipc.theme.get());

  // Reconcile with persisted prefs once they resolve — theme.js may still be
  // syncing config from IPC when the component first mounts.
  useEffect(() => {
    ipc
      .getPrefs()
      .then((p) => {
        if (p?.theme) setTheme(cleanPref(p.theme));
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
    </div>
  );
}

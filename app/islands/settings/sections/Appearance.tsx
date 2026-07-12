import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { SettingRow } from '../components/SettingRow.tsx';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';

const cleanPref = (p: unknown) => (p === 'light' || p === 'dark' ? p : 'auto');

// 外観: theme (auto/light/dark) + "show info on tiles" toggle.
export function Appearance() {
  const [theme, setTheme] = useState(() => ipc.theme.get());
  const [tileOverlay, setTileOverlay] = useState(true);

  // Reconcile with persisted prefs once they resolve — theme.js may still be
  // syncing config from IPC when the island first mounts.
  useEffect(() => {
    ipc
      .getPrefs()
      .then((p) => {
        if (!p) return;
        if (p.theme) setTheme(cleanPref(p.theme));
        setTileOverlay(p.tileOverlay !== false);
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <SettingRow label={t('themeMode')} hint={t('hintTheme')}>
        <Select
          value={theme}
          onValueChange={(v) => {
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
      <Separator />
      <SettingRow label={t('tileOverlay')}>
        <Switch
          checked={tileOverlay}
          onCheckedChange={(v) => {
            setTileOverlay(v);
            ipc.setTileOverlay(v);
          }}
        />
      </SettingRow>
    </div>
  );
}

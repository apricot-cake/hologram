import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingRow } from '../components/SettingRow.tsx';
import { FontCombobox } from '../components/FontCombobox.tsx';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';

const cleanPref = (p: unknown) => (p === 'light' || p === 'dark' ? p : 'auto');
const cleanFont = (p: unknown) => (typeof p === 'string' ? p : '');

// 外観: テーマ（自動・ライト・ダーク）と画面のフォント（#137）。
//
// 以前は「タイルに情報を表示」もここにあった。今は無い（#618）。「情報を表示」は表示
// ポップオーバーが持つグリッドの2つのスイッチの片方になっており、同じ問いを2つの画面で
// 二度尋ねてはいけない。
export function Appearance() {
  const [theme, setTheme] = useState(() => ipc.theme.get());
  const [uiFont, setUiFont] = useState(() => ipc.uiFont.get());

  // 永続化された設定が解決したら、それに合わせて突き合わせる＝コンポーネントを最初に
  // 載せた時点では、theme.js や ui-font-api.ts がまだ IPC から設定を取り込んでいる
  // 途中かもしれない。
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

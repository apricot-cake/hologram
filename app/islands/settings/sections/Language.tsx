import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Hint } from '../components/Hint.tsx';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';

// 言語: viewer display language. Changing it persists then reloads the renderer
// (so all static i18n re-applies) — same behavior as the vanilla select.
export function Language() {
  const [lang, setLang] = useState('auto');

  useEffect(() => {
    ipc
      .getPrefs()
      .then((p) => {
        if (p) setLang(p.language || 'auto');
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <Select
        value={lang}
        onValueChange={(v) => {
          setLang(v);
          Promise.resolve(ipc.setPref('language', v)).then(() => location.reload());
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{t('langAuto')}</SelectItem>
          <SelectItem value="ja">日本語</SelectItem>
          <SelectItem value="en">English</SelectItem>
        </SelectContent>
      </Select>
      <Hint text={t('hintLang')} />
    </>
  );
}

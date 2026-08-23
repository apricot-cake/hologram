import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Hint } from '../components/Hint.tsx';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';

// 言語: 表示側の表示言語。変えると値を永続化してからレンダラーを読み込み直す（静的な
// i18n がすべて当たり直すため）＝素の select と同じ振る舞い。
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
        items={{ auto: t('langAuto'), ja: '日本語', en: 'English', ko: '한국어', 'zh-CN': '简体中文', 'zh-TW': '繁體中文' }}
        value={lang}
        onValueChange={(v) => {
          if (v === null) return;
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
          <SelectItem value="ko">한국어</SelectItem>
          <SelectItem value="zh-CN">简体中文</SelectItem>
          <SelectItem value="zh-TW">繁體中文</SelectItem>
        </SelectContent>
      </Select>
      <Hint text={t('hintLang')} />
    </>
  );
}

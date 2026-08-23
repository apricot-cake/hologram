import type { ComponentType } from 'react';
import { Palette, Languages, Database, Keyboard, TriangleAlert, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Appearance } from './Appearance.tsx';
import { Language } from './Language.tsx';
import { Data } from './Data.tsx';
import { Shortcuts } from './Shortcuts.tsx';
import { Danger } from './Danger.tsx';
import { About } from './About.tsx';

// 節の登録簿＝横の目次と本体のパネルの両方をこれが動かすので、節を足すのはここの1行の
// 変更で済む。titleKey は i18n のキー（素のアプリから流用）。並び順は元のパネルに合わせて
// ある。
//
// ゴミ箱は意図してここに置いていない（#268）。中身はライブラリのレコードで、それを見て
// 回ったり1件を復元したりするのは閲覧であって設定ではない。今は左のナビの行き先であり、
// 入口はその1つだけ＝ここに2つ目を置けば、同じ破壊的な操作への扉が2つできてしまう。
export const SECTIONS: { id: string; titleKey: string; Icon: LucideIcon; Component: ComponentType }[] = [
  { id: 'appearance', titleKey: 'themeTitle', Icon: Palette, Component: Appearance },
  { id: 'language', titleKey: 'langTitle', Icon: Languages, Component: Language },
  { id: 'data', titleKey: 'dataTitle', Icon: Database, Component: Data },
  { id: 'shortcuts', titleKey: 'shortcutsSectionTitle', Icon: Keyboard, Component: Shortcuts },
  { id: 'danger', titleKey: 'dangerTitle', Icon: TriangleAlert, Component: Danger },
  { id: 'about', titleKey: 'aboutTitle', Icon: Info, Component: About },
];

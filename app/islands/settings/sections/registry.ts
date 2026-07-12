import type { ComponentType } from 'react';
import { Palette, Languages, Database, Trash2, TriangleAlert, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Appearance } from './Appearance.tsx';
import { Language } from './Language.tsx';
import { Data } from './Data.tsx';
import { Trash } from './Trash.tsx';
import { Danger } from './Danger.tsx';
import { About } from './About.tsx';

// Section registry — drives BOTH the side TOC and the body panel, so adding a
// section is a one-line change here. titleKey is an i18n key (reused from the
// vanilla app). Order mirrors the original panel.
export const SECTIONS: { id: string; titleKey: string; Icon: LucideIcon; Component: ComponentType }[] = [
  { id: 'appearance', titleKey: 'themeTitle', Icon: Palette, Component: Appearance },
  { id: 'language', titleKey: 'langTitle', Icon: Languages, Component: Language },
  { id: 'data', titleKey: 'dataTitle', Icon: Database, Component: Data },
  { id: 'trash', titleKey: 'trashTitle', Icon: Trash2, Component: Trash },
  { id: 'danger', titleKey: 'dangerTitle', Icon: TriangleAlert, Component: Danger },
  { id: 'about', titleKey: 'aboutTitle', Icon: Info, Component: About },
];

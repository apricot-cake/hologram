import type { ComponentType } from 'react';
import { Appearance } from './Appearance.tsx';
import { Language } from './Language.tsx';
import { Data } from './Data.tsx';
import { Trash } from './Trash.tsx';
import { Danger } from './Danger.tsx';
import { About } from './About.tsx';

// Section registry — drives BOTH the side TOC and the body panel, so adding a
// section is a one-line change here. titleKey is an i18n key (reused from the
// vanilla app). Order mirrors the original panel.
export const SECTIONS: { id: string; titleKey: string; Component: ComponentType }[] = [
  { id: 'appearance', titleKey: 'themeTitle', Component: Appearance },
  { id: 'language', titleKey: 'langTitle', Component: Language },
  { id: 'data', titleKey: 'dataTitle', Component: Data },
  { id: 'trash', titleKey: 'trashTitle', Component: Trash },
  { id: 'danger', titleKey: 'dangerTitle', Component: Danger },
  { id: 'about', titleKey: 'aboutTitle', Component: About },
];

import type { ComponentType } from 'react';
import { Palette, Languages, Database, TriangleAlert, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Appearance } from './Appearance.tsx';
import { Language } from './Language.tsx';
import { Data } from './Data.tsx';
import { Danger } from './Danger.tsx';
import { About } from './About.tsx';

// Section registry — drives BOTH the side TOC and the body panel, so adding a
// section is a one-line change here. titleKey is an i18n key (reused from the
// vanilla app). Order mirrors the original panel.
//
// Trash is deliberately NOT here (#268): its contents are library records, and
// looking through them / restoring one is browsing, not configuring. It is a
// destination in the left nav now, and the entry point is that one only — a
// second one here would mean two doors to the same destructive actions.
export const SECTIONS: { id: string; titleKey: string; Icon: LucideIcon; Component: ComponentType }[] = [
  { id: 'appearance', titleKey: 'themeTitle', Icon: Palette, Component: Appearance },
  { id: 'language', titleKey: 'langTitle', Icon: Languages, Component: Language },
  { id: 'data', titleKey: 'dataTitle', Icon: Database, Component: Data },
  { id: 'danger', titleKey: 'dangerTitle', Icon: TriangleAlert, Component: Danger },
  { id: 'about', titleKey: 'aboutTitle', Icon: Info, Component: About },
];

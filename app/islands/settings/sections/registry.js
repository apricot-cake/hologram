import { Appearance } from './Appearance.jsx';
import { Language } from './Language.jsx';
import { About } from './About.jsx';

// Section registry — drives BOTH the side TOC and the body panel, so adding a
// section is a one-line change here. titleKey is an i18n key (reused from the
// vanilla app). Phase B appends Data / Trash / Danger.
export const SECTIONS = [
  { id: 'appearance', titleKey: 'themeTitle', Component: Appearance },
  { id: 'language', titleKey: 'langTitle', Component: Language },
  { id: 'about', titleKey: 'aboutTitle', Component: About },
];

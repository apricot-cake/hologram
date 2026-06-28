import { Appearance } from './Appearance.jsx';
import { Language } from './Language.jsx';
import { Data } from './Data.jsx';
import { Trash } from './Trash.jsx';
import { Danger } from './Danger.jsx';
import { About } from './About.jsx';

// Section registry — drives BOTH the side TOC and the body panel, so adding a
// section is a one-line change here. titleKey is an i18n key (reused from the
// vanilla app). Order mirrors the original panel.
export const SECTIONS = [
  { id: 'appearance', titleKey: 'themeTitle', Component: Appearance },
  { id: 'language', titleKey: 'langTitle', Component: Language },
  { id: 'data', titleKey: 'dataTitle', Component: Data },
  { id: 'trash', titleKey: 'trashTitle', Component: Trash },
  { id: 'danger', titleKey: 'dangerTitle', Component: Danger },
  { id: 'about', titleKey: 'aboutTitle', Component: About },
];

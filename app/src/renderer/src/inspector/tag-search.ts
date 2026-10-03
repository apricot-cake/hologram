import { tagNameInputIsSafe } from '../../../../../native-host/tag-normalize.mts';
import { includesNormalized } from '../services/search.ts';

interface SearchableTagItem {
  tag: string;
}

interface SearchableTagGroup<Item extends SearchableTagItem> {
  name: string;
  items: Item[];
}

interface SearchableTagRow {
  name: string;
}

export function filterTagGroups<Group extends SearchableTagGroup<Item>, Item extends SearchableTagItem>(groups: Group[], query: string, itemIsVisible: (item: Item) => boolean): Group[] {
  if (!tagNameInputIsSafe(query)) return [];
  return groups.map((group) => ({ ...group, items: group.items.filter((item) => itemIsVisible(item) && (includesNormalized(group.name, query) || includesNormalized(item.tag, query))) })).filter((group) => group.items.length || (!query && 'id' in group && group.id !== undefined));
}

export function filterTagRows<Row extends SearchableTagRow>(rows: Row[], query: string): Row[] {
  if (!tagNameInputIsSafe(query)) return [];
  return rows.filter((row) => includesNormalized(row.name, query));
}

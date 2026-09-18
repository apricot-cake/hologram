import { CountSchema, PostRecordSchema } from '../../../native-host/post-schemas.mts';
import { z } from 'zod';

// IPC と保存形式で共有するデータ定義。既定値は省略時だけ補い、不正値は拒否する。
export const IdSchema = z.string().min(1);
export const IdsSchema = z.array(IdSchema).transform((ids) => [...new Set(ids)]);
export const PostFlagsSchema = z.object({
  userKind: z.enum(['plain', 'media']).nullable().optional(),
  tagReviewed: z.boolean().nullable().optional(),
  localViewCount: z.number().int().nonnegative().optional(),
  folders: IdsSchema.optional(),
  manualGroups: z.array(z.object({ groupId: z.number().int(), seq: z.number().int() })).optional(),
});
export type PostFlags = z.output<typeof PostFlagsSchema>;
// オブジェクトの省略可能なプロパティは IPC では undefined のまま届く。
// JSON 保存時の省略を許すが、関数・BigInt 等の保存できない値は拒否する。
type JsonValue = string | number | boolean | null | undefined | JsonValue[] | { [key: string]: JsonValue };
export const JsonValueSchema: z.ZodType<JsonValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.undefined(),
  z.array(z.lazy(() => JsonValueSchema)),
  z.record(
    z.string(),
    z.lazy(() => JsonValueSchema),
  ),
]);
export const LabelsSchema = z.record(IdSchema, z.string().trim().min(1)).nullable().default(null);
export const TagVocabRowSchema = z.object({ id: z.number().int().positive(), name: z.string(), groupId: IdSchema.nullable(), reading: z.string().nullable(), postCount: z.number().int().nonnegative(), posterCount: z.number().int().nonnegative(), displayName: z.string(), isOrphan: z.boolean() });
export const TagGroupMemberSchema = z.object({ id: z.number().int().positive(), groupId: IdSchema, name: z.string(), label: z.string() });
export const TagGroupMemberWriteSchema = TagGroupMemberSchema.omit({ name: true, label: true });
export const TagGroupsWriteSchema = z
  .object({ memberships: z.array(TagGroupMemberWriteSchema), labels: LabelsSchema })
  .refine(({ memberships, labels }) => memberships.every((row) => Object.hasOwn(labels || {}, row.groupId)) && new Set(memberships.map((row) => row.id)).size === memberships.length, 'Every tag must belong to one defined group');
export const TagGroupsSchema = z.object({ memberships: z.array(TagGroupMemberSchema), labels: LabelsSchema });
export const TagGroupNamesSchema = z.object({ memberships: z.record(z.string(), IdSchema), labels: LabelsSchema });
export const UngroupedSchema = z.object({ keys: IdsSchema });
export const ManualGroupsSchema = z.object({ groups: z.array(IdsSchema) });
export const FolderSchema = z.object({
  id: IdSchema,
  name: z.string(),
  kind: z.enum(['static', 'dynamic']).default('static'),
  created: z.number().nullable().default(null),
  parentId: IdSchema.nullable().default(null),
  items: IdsSchema.default([]),
  tree: JsonValueSchema.optional(),
});
export const FoldersSchema = z.object({ folders: z.array(FolderSchema), activeId: IdSchema.nullable().default(null) });
export const PosterFolderSchema = z.object({ id: IdSchema, name: z.string(), items: IdsSchema.default([]) });
export const PosterFoldersSchema = z.object({ folders: z.array(PosterFolderSchema) });
export const PosterTagRowSchema = z.object({
  tags: z.array(z.string()),
  tagIds: z.array(z.number().int()),
});
export const PosterTagsSchema = z.object({ tags: z.record(IdSchema, PosterTagRowSchema) });
export const PosterTagNamesSchema = z.object({ tags: z.record(IdSchema, z.array(z.string())) });
export const PosterProfileSchema = z.object({
  posterKey: IdSchema,
  platform: PostRecordSchema.shape.platform,
  userId: PostRecordSchema.shape.userId,
  displayName: PostRecordSchema.shape.displayName,
  screenName: PostRecordSchema.shape.screenName,
  bio: PostRecordSchema.shape.bio,
  links: z.string().nullable().default(null),
  avatar: PostRecordSchema.shape.avatar,
  avatarFile: PostRecordSchema.shape.avatarFile,
  banner: PostRecordSchema.shape.banner,
  bannerFile: PostRecordSchema.shape.bannerFile,
  followers: CountSchema.nullable().default(null),
  following: CountSchema.nullable().default(null),
  authorCreatedAt: PostRecordSchema.shape.authorCreatedAt,
  contentHash: z.string(),
  provenance: z.string(),
  firstObservedAt: z.string(),
  lastObservedAt: z.string(),
});
export const PosterProfilesSchema = z.object({ profiles: z.array(PosterProfileSchema) });
export const QueryLeafSchema = z.object({ kind: z.literal('cond'), type: z.string() }).catchall(JsonValueSchema);
export const QueryGroupSchema = z.object({
  kind: z.literal('group'),
  op: z.enum(['and', 'or']),
  neg: z.boolean(),
  get children() {
    return z.array(z.union([QueryLeafSchema, QueryGroupSchema]));
  },
});
export const TabViewSchema = z.object({
  f: z.array(z.object({ type: z.string() }).catchall(JsonValueSchema)).optional(),
  tree: QueryGroupSchema.nullable().optional(),
  ops: z.record(z.string(), z.enum(['and', 'or'])).optional(),
  folderId: z.string().nullable().optional(),
  search: z.string().optional(),
  sort: z.string().optional(),
  shuffleSeed: z.string().optional(),
  multi: z.boolean().optional(),
  inspectedPosterKey: z.string().nullable().optional(),
});
export const NavEntrySchema = z.discriminatedUnion('kind', [
  z.object({ scrollTop: z.number().nonnegative().optional(), u: z.string().default(''), kind: z.literal('posts'), state: TabViewSchema }),
  z.object({ scrollTop: z.number().nonnegative().optional(), u: z.string().default(''), kind: z.literal('posters'), state: TabViewSchema }),
  z.object({ scrollTop: z.number().nonnegative().optional(), u: z.string().default(''), kind: z.literal('image'), state: z.object({ recs: z.array(IdSchema).min(1), idx: z.number().int().nonnegative().default(0) }) }),
]);
export const TabPersistSchema = z.object({
  view: TabViewSchema.nullable().default(null),
  autoTitle: z.boolean().optional(),
  scrollTop: z.number().optional(),
  nav: z.object({ hist: z.array(NavEntrySchema), idx: z.number().int().optional() }).optional(),
});
export const TabSchema = z.object({ id: IdSchema, pinned: z.boolean().default(false), title: z.string().nullable().default(null), state: TabPersistSchema.default({ view: null }) });
export const TabsSchema = z.object({ tabs: z.array(TabSchema), activeTabId: IdSchema.nullable().default(null) });
export const HistoryEntrySchema = z.object({ ts: z.number().default(() => Date.now()), u: IdSchema, kind: IdSchema, title: z.string().default(''), state: JsonValueSchema.default(null) });
export const HistoryRowSchema = HistoryEntrySchema.extend({ id: z.number().int() });
export const HistoryCursorSchema = z.object({ ts: z.number(), id: z.number().int() });
export const HistoryQuerySchema = z.object({ search: z.string().optional(), before: HistoryCursorSchema.nullable().optional() });
export const HistoryQueryResultSchema = z.object({ rows: z.array(HistoryRowSchema), hasMore: z.boolean() });
export const AppPrefsSchema = z.object({
  language: z.string().default('auto'),
  squareThumbs: z.boolean().default(false),
  showInfo: z.boolean().default(true),
  showAvatar: z.boolean().default(true),
  skipDeleteConfirm: z.boolean().default(false),
  gridSize: z.number().nullable().default(null),
  theme: z.enum(['auto', 'light', 'dark']).default('auto'),
  uiFontFamily: z.string().default(''),
  browseMode: z.enum(['posts', 'posters']).default('posts'),
  posterShowInfo: z.boolean().default(true),
  posterGridSize: z.number().nullable().default(null),
  inspectorOpen: z.boolean().nullable().default(null),
  inspectorWidth: z.number().nullable().default(null),
  panelsHidden: z.boolean().nullable().default(null),
  shortcutOverrides: z.record(z.string(), z.string()).default({}),
});

export type AppPrefs = z.infer<typeof AppPrefsSchema>;
export type TabView = z.infer<typeof TabViewSchema>;
export type NavEntry = z.infer<typeof NavEntrySchema>;
export type FolderRecord = z.infer<typeof FolderSchema>;
export type FoldersState = z.infer<typeof FoldersSchema>;
export type PosterFolderRecord = z.infer<typeof PosterFolderSchema>;
export type PosterFoldersState = z.infer<typeof PosterFoldersSchema>;
export type TagGroupMember = z.infer<typeof TagGroupMemberSchema>;
export type TagGroupsState = z.infer<typeof TagGroupsSchema>;
export type TagGroupNamesState = z.infer<typeof TagGroupNamesSchema>;
export type UngroupedState = z.infer<typeof UngroupedSchema>;
export type ManualGroupsState = z.infer<typeof ManualGroupsSchema>;
export type PosterTagRow = z.infer<typeof PosterTagRowSchema>;
export type PosterTagsState = z.infer<typeof PosterTagsSchema>;
export type PosterTagNamesState = z.infer<typeof PosterTagNamesSchema>;
export type TabRecord = z.infer<typeof TabSchema>;
export type TabsState = z.infer<typeof TabsSchema>;
export type HistoryRow = z.infer<typeof HistoryRowSchema>;
export type HistoryCursor = z.infer<typeof HistoryCursorSchema>;
export type HistoryQueryOptions = z.infer<typeof HistoryQuerySchema>;
export type HistoryQueryResult = z.infer<typeof HistoryQueryResultSchema>;

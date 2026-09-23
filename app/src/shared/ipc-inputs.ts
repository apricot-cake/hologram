import { CropRectSchema } from '../../../native-host/post-schemas.mts';
import { z } from 'zod';
import { ClassifiedTagInput, TagAssignment } from './tag-classification.ts';
import { AppPrefsSchema, FoldersSchema, HistoryEntrySchema, HistoryQuerySchema, IdSchema, IdsSchema, LabelsSchema, ManualGroupsSchema, PosterTagNamesSchema, TabsSchema, TagGroupMemberWriteSchema } from './data-schemas.ts';

const none = z.tuple([]);
const text = z.string();
const id = IdSchema;
const tagId = z.number().int().positive();
const bool = z.boolean();
export const CropSchema = CropRectSchema;
export const TagPatchSchema = z.object({ userKind: z.enum(['plain', 'media']).nullable().optional(), tagReviewed: bool.optional() });
export const PinItemSchema = z.object({ captureId: text, file: id, video: bool });
export const DroppedFileSchema = z.object({
  path: id,
  ext: text,
  folderGroup: z.number().int().nonnegative().optional(),
  folderTitle: z.string().min(1).max(512).optional(),
  folderRoot: z.number().int().nonnegative().optional(),
  folderRootTitle: z.string().min(1).max(512).optional(),
  folderIsRoot: bool.optional(),
});

export const ipcInputs = {
  'apply-cached-metadata': z.tuple([z.string().min(1).max(512)]),
  'take-post-link': none,
  'get-config': none,
  'get-library-status': none,
  'get-extension-contact': none,
  'app-info': none,
  'get-prefs': none,
  'window-control': z.tuple([z.enum(['minimize', 'toggle-maximize', 'close'])]),
  'get-tabs': none,
  'set-tabs': z.tuple([TabsSchema]),
  'set-pref': z.tuple([AppPrefsSchema.keyof(), z.unknown()]).transform(([key, value], ctx) => {
    const result = AppPrefsSchema.shape[key].safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.issues.push({ code: 'custom', path: [1, ...issue.path], message: 'Invalid preference value', input: undefined });
      return z.NEVER;
    }
    return [key, result.data] as [typeof key, typeof result.data];
  }),
  'get-export-reminder': none,
  'set-export-reminder-enabled': z.tuple([bool]),
  'set-export-reminder-threshold': z.tuple([z.number().int().positive()]),
  'get-integrity-status': none,
  'run-orphan-recovery': none,
  'get-tag-groups': none,
  'set-tag-groups': z.tuple([z.array(TagGroupMemberWriteSchema), LabelsSchema.default(null)]),
  'get-ungrouped': none,
  'set-ungrouped': z.tuple([IdsSchema]),
  'get-poster-tags': none,
  'set-poster-tags': z.tuple([PosterTagNamesSchema]),
  'get-manual-groups': none,
  'set-manual-groups': z.tuple([ManualGroupsSchema.shape.groups]),
  'get-folders': none,
  'set-folders': z.tuple([FoldersSchema]),
  'append-history': z.tuple([HistoryEntrySchema]),
  'query-history': z.tuple([HistoryQuerySchema.default({})]),
  'delete-history-row': z.tuple([tagId]),
  'clear-history': none,
  'pin-send': z.tuple([z.array(PinItemSchema), z.object({ newWindow: bool.optional() }).optional()]),
  'pin-get-initial': none,
  'pin-toggle-always-on-top': none,
  'pin-save-as-folder': z.tuple([text, IdsSchema]),
  'list-posts': none,
  'list-posts-delta': z.tuple([bool]),
  'search-candidates': z.tuple([text, z.array(z.object({ id: text, title: text, keywords: text.optional(), screenName: text.optional() })).max(100000)]),
  'search-full-text': z.tuple([text, z.number().int().positive().optional()]),
  'record-post-view': z.tuple([id]),
  'set-media-crop': z.tuple([id, z.number().int().nonnegative(), CropSchema.nullable()]),
  'image-data-url': z.tuple([id]),
  'ugoira-frames-present': z.tuple([id, IdsSchema]),
  'ugoira-frame': z.tuple([id, id]),
  'get-tag-vocab': none,
  'save-classified-tag': z.tuple([ClassifiedTagInput]),
  'get-classified-assignments': z.tuple([IdsSchema]),
  'set-classified-assignments': z.tuple([z.array(TagAssignment)]),
  'rename-tag': z.tuple([tagId, text]),
  'merge-tags': z.tuple([tagId, tagId]),
  'set-tag-group': z.tuple([tagId, text.nullable()]),
  'delete-tags': z.tuple([z.array(tagId)]),
  'clear-all': none,
  'export-save': z.tuple([id, z.union([z.instanceof(Uint8Array), z.instanceof(ArrayBuffer)])]),
  'export-complete': z.tuple([text.optional(), bool.optional()]),
  'import-complete': none,
  'pick-save-folder': none,
  'move-save-folder': z.tuple([id]),
  'pick-repoint-folder': none,
  'apply-repoint': z.tuple([id]),
  'import-images': none,
  'collect-dropped-paths': z.tuple([IdsSchema]),
  'import-dropped-paths': z.tuple([z.array(DroppedFileSchema), bool.default(false)]),
  'import-clipboard': z.tuple([text]),
  'open-new-window': none,
  'open-external': z.tuple([z.url({ protocol: /^https?$/ })]),
  'show-in-folder': z.tuple([id]),
  'open-image-window': z.tuple([id]),
  'copy-image': z.tuple([id]),
  'copy-text': z.tuple([id]),
  'delete-post': z.tuple([id]),
  'list-trash': none,
  'restore-post': z.tuple([id]),
  'empty-trash': none,
  'delete-from-trash': z.tuple([id]),
  'update-tags': z.tuple([id, z.array(text), TagPatchSchema.optional()]),
};
export type IpcChannel = keyof typeof ipcInputs;
export type IpcArgs<C extends IpcChannel> = z.input<(typeof ipcInputs)[C]>;
export type IpcParsedArgs<C extends IpcChannel> = z.output<(typeof ipcInputs)[C]>;

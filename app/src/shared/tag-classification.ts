import { z } from 'zod';

export const ClassifiedTagInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(256),
  category: z.enum(['general', 'work', 'character']),
  workId: z.number().int().positive().nullable().default(null),
});
export const TagAssignment = z.object({ postId: z.string().min(1), tagIds: z.array(z.number().int().positive()) });
export type TagAssignment = z.infer<typeof TagAssignment>;
export type ClassifiedTagInput = z.infer<typeof ClassifiedTagInput>;
export const PortableClassifiedTag = z.object({ name: z.string().min(1), category: z.enum(['work', 'character']), workName: z.string().min(1).nullable() });
export const MAX_CLASSIFIED_TAG_VOCABULARY = 10000;
export const PortableClassifiedTagVocabulary = z.array(PortableClassifiedTag).max(MAX_CLASSIFIED_TAG_VOCABULARY);
export const PortableTagClassification = z.object({ tags: z.array(PortableClassifiedTag), generalTags: z.array(z.string()) });
export type PortableTagClassification = z.infer<typeof PortableTagClassification>;

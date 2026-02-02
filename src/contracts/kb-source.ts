import { z } from 'zod';
import { TenantContextSchema } from './tenant.js';

export const KBSourceTypeSchema = z.enum([
  'markdown',
  'mdx',
  'html',
  'text',
  'json',
]);

export const KBChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  source_id: z.string(),
  start_line: z.number().int().nonnegative(),
  end_line: z.number().int().nonnegative(),
  heading_path: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type KBChunk = z.infer<typeof KBChunkSchema>;

export const KBSourceSchema = z.object({
  ...TenantContextSchema.shape,
  id: z.string().min(1),
  type: KBSourceTypeSchema,
  title: z.string().min(1),
  content: z.string(),
  file_path: z.string().optional(),
  url: z.string().url().optional(),
  chunks: z.array(KBChunkSchema).default([]),
  metadata: z.record(z.unknown()).default({}),
  ingested_at: z.string().datetime().or(z.date()),
});

export type KBSource = z.infer<typeof KBSourceSchema>;
export type KBSourceType = z.infer<typeof KBSourceTypeSchema>;

export const KBSourceArraySchema = z.array(KBSourceSchema);

export function validateKBSource(data: unknown): KBSource {
  return KBSourceSchema.parse(data);
}

export function validateKBSources(data: unknown): KBSource[] {
  return KBSourceArraySchema.parse(data);
}

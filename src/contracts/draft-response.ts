import { z } from 'zod';
import { TenantContextSchema } from './tenant.js';

export const CitationSchema = z.object({
  source_id: z.string(),
  chunk_id: z.string(),
  excerpt: z.string(),
  relevance_score: z.number().min(0).max(1),
});

export type Citation = z.infer<typeof CitationSchema>;

export const DraftStatusSchema = z.enum([
  'draft',
  'review_required',
  'citation_failed',
  'ready',
]);

export const DraftResponseSchema = z.object({
  ...TenantContextSchema.shape,
  id: z.string().min(1),
  ticket_id: z.string().min(1),
  body: z.string(),
  citations: z.array(CitationSchema).default([]),
  status: DraftStatusSchema,
  tone: z.string().default('neutral'),
  missing_claims: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  created_at: z.string().datetime().or(z.date()),
  disclaimer: z.string().optional(),
});

export type DraftResponse = z.infer<typeof DraftResponseSchema>;
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

export function validateDraftResponse(data: unknown): DraftResponse {
  return DraftResponseSchema.parse(data);
}

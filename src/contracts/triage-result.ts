import { z } from 'zod';
import { TenantContextSchema } from './tenant.js';

export const TriageUrgencySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);

export const TriageTopicSchema = z.object({
  category: z.string(),
  confidence: z.number().min(0).max(1),
  keywords: z.array(z.string()).default([]),
});

export const TriageResultSchema = z.object({
  ...TenantContextSchema.shape,
  ticket_id: z.string().min(1),
  urgency: TriageUrgencySchema,
  topics: z.array(TriageTopicSchema),
  missing_info: z.array(z.string()).default([]),
  suggested_priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  suggested_tags: z.array(z.string()).default([]),
  requires_kb_update: z.boolean().default(false),
  requires_human_review: z.boolean().default(false),
  reasoning: z.string().optional(),
  processed_at: z.string().datetime().or(z.date()),
});

export type TriageUrgency = z.infer<typeof TriageUrgencySchema>;
export type TriageTopic = z.infer<typeof TriageTopicSchema>;
export type TriageResult = z.infer<typeof TriageResultSchema>;

export function validateTriageResult(data: unknown): TriageResult {
  return TriageResultSchema.parse(data);
}

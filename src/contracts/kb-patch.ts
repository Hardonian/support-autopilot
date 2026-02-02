import { z } from 'zod';
import { TenantContextSchema } from './tenant.js';

export const KBPatchTypeSchema = z.enum([
  'faq_addition',
  'section_update',
  'new_doc',
  'clarification',
]);

export const KBPatchProposalSchema = z.object({
  ...TenantContextSchema.shape,
  id: z.string().min(1),
  type: KBPatchTypeSchema,
  source_id: z.string().optional(),
  proposed_title: z.string().min(1),
  proposed_content: z.string(),
  diff: z.string().optional(),
  related_ticket_ids: z.array(z.string()).default([]),
  triage_context: z.string().optional(),
  status: z.enum(['pending_review', 'approved', 'rejected', 'merged']).default('pending_review'),
  created_at: z.string().datetime().or(z.date()),
  reasoning: z.string().optional(),
});

export type KBPatchType = z.infer<typeof KBPatchTypeSchema>;
export type KBPatchProposal = z.infer<typeof KBPatchProposalSchema>;

export function validateKBPatchProposal(data: unknown): KBPatchProposal {
  return KBPatchProposalSchema.parse(data);
}

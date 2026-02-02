import { z } from 'zod';
import { TenantContextSchema } from './tenant.js';

export const JobTypeSchema = z.enum([
  'autopilot.support.triage',
  'autopilot.support.draft_reply',
  'autopilot.support.propose_kb_patch',
  'autopilot.support.ingest_kb',
  'autopilot.support.batch_triage',
]);

export const JobPrioritySchema = z.enum([
  'low',
  'normal',
  'high',
  'critical',
]);

export const JobRequestSchema = z.object({
  ...TenantContextSchema.shape,
  job_type: JobTypeSchema,
  job_id: z.string().min(1),
  priority: JobPrioritySchema.default('normal'),
  payload: z.record(z.unknown()),
  created_at: z.string().datetime().or(z.date()),
  scheduled_for: z.string().datetime().or(z.date()).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type JobType = z.infer<typeof JobTypeSchema>;
export type JobPriority = z.infer<typeof JobPrioritySchema>;
export type JobRequest = z.infer<typeof JobRequestSchema>;

export function validateJobRequest(data: unknown): JobRequest {
  return JobRequestSchema.parse(data);
}

export function createJobRequest(
  tenantId: string,
  projectId: string,
  jobType: JobType,
  payload: Record<string, unknown>,
  options?: {
    priority?: JobPriority;
    jobId?: string;
    scheduledFor?: Date | string;
    metadata?: Record<string, unknown>;
  }
): JobRequest {
  const now = new Date().toISOString();
  return validateJobRequest({
    tenant_id: tenantId,
    project_id: projectId,
    job_type: jobType,
    job_id: options?.jobId ?? `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    priority: options?.priority ?? 'normal',
    payload,
    created_at: now,
    scheduled_for: options?.scheduledFor ?
      (typeof options.scheduledFor === 'string' ? options.scheduledFor : options.scheduledFor.toISOString()) :
      undefined,
    metadata: options?.metadata ?? {},
  });
}

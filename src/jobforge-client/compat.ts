import { z } from 'zod';
import {
  JobRequestSchema,
  type JobRequest,
  JobPrioritySchema,
  type JobPriority,
  JobTypeSchema,
  type JobType,
} from '../contracts/compat.js';
import { stableHash } from '../utils/deterministic.js';

export interface RequestBuilderOptions {
  tenantId: string;
  projectId: string;
  traceId?: string;
  moduleId?: 'support';
  priority?: JobPriority;
  requiresPolicyToken?: boolean;
  metadata?: Record<string, unknown>;
}

export interface JobBatch {
  jobs: JobRequest[];
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

const JobRequestInputSchema = z.object({
  job_type: JobTypeSchema,
  payload: z.record(z.unknown()),
  priority: JobPrioritySchema.optional(),
});

export function buildJobRequest(
  input: z.infer<typeof JobRequestInputSchema>,
  options: RequestBuilderOptions
): JobRequest {
  const parsed = JobRequestInputSchema.parse(input);
  const createdAt = new Date().toISOString();
  const idempotencyKey = stableHash({
    tenant_id: options.tenantId,
    project_id: options.projectId,
    job_type: parsed.job_type,
    payload: parsed.payload,
  });

  return JobRequestSchema.parse({
    schema_version: '1.0',
    module_id: options.moduleId ?? 'support',
    tenant_id: options.tenantId,
    project_id: options.projectId,
    trace_id: options.traceId,
    job_type: parsed.job_type,
    job_id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    idempotency_key: idempotencyKey,
    priority: parsed.priority ?? options.priority ?? 'normal',
    payload: parsed.payload,
    created_at: createdAt,
    requires_policy_token: options.requiresPolicyToken ?? false,
    metadata: options.metadata ?? {},
  });
}

export function createJobBatch(jobs: JobRequest[]): JobBatch {
  return { jobs: [...jobs] };
}

export function groupJobsByType(jobs: JobRequest[]): Record<JobType, JobRequest[]> {
  return jobs.reduce((acc, job) => {
    acc[job.job_type] = acc[job.job_type] ?? [];
    acc[job.job_type].push(job);
    return acc;
  }, {} as Record<JobType, JobRequest[]>);
}

export function serializeJobRequest(job: JobRequest): string {
  return JSON.stringify(job, null, 2);
}

export function serializeJobBatch(batch: JobBatch): string {
  return JSON.stringify(batch, null, 2);
}

export function serializeJobsAsJsonLines(jobs: JobRequest[]): string {
  return jobs.map(job => JSON.stringify(job)).join('\n');
}

export function validateJobRequest(job: unknown): ValidationResult {
  const result = JobRequestSchema.safeParse(job);
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, errors: result.error.issues.map(issue => issue.message) };
}

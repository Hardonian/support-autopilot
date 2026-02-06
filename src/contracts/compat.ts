import { z } from 'zod';
import { TenantContextSchema, type TenantContext, validateTenantContext } from './tenant.js';
import { stableHash, withCanonicalHash } from '../utils/deterministic.js';

// Re-export tenant types for compatibility
export { TenantContextSchema, type TenantContext, validateTenantContext };

// Migration note: replace this compat layer with @autopilot/contracts once the package is available.
export const schema_version = '1.0' as const;
const SchemaVersionSchema = z.literal(schema_version).default(schema_version);

export const HashMetadataSchema = z.object({
  algorithm: z.literal('sha256'),
  canonical_json_hash: z.string().min(1),
});

export type HashMetadata = z.infer<typeof HashMetadataSchema>;

export const EventEnvelopeSchema = z.object({
  schema_version: SchemaVersionSchema,
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  ...TenantContextSchema.shape,
  trace_id: z.string().min(1),
  occurred_at: z.string().datetime(),
  payload: z.record(z.unknown()),
  metadata: z.record(z.unknown()).default({}),
});

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const RunManifestSchema = z.object({
  schema_version: SchemaVersionSchema,
  run_id: z.string().min(1),
  module_id: z.enum(['support']),
  ...TenantContextSchema.shape,
  trace_id: z.string().min(1),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().optional(),
  status: z.enum(['success', 'failure', 'partial']),
  metadata: z.record(z.unknown()).default({}),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

export const JobTypeSchema = z.enum([
  'autopilot.support.triage',
  'autopilot.support.draft_reply',
  'autopilot.support.propose_kb_patch',
  'autopilot.support.ingest_kb',
  'autopilot.support.batch_triage',
]);

export const JobPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

export const JobRequestSchema = z.object({
  schema_version: SchemaVersionSchema,
  module_id: z.enum(['support']),
  ...TenantContextSchema.shape,
  trace_id: z.string().min(1).optional(),
  job_type: JobTypeSchema,
  job_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  priority: JobPrioritySchema.default('normal'),
  payload: z.record(z.unknown()),
  created_at: z.string().datetime(),
  scheduled_for: z.string().datetime().optional(),
  requires_policy_token: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

export type JobType = z.infer<typeof JobTypeSchema>;
export type JobPriority = z.infer<typeof JobPrioritySchema>;
export type JobRequest = z.infer<typeof JobRequestSchema>;

export const JobRequestBundleSchema = z.object({
  schema_version: SchemaVersionSchema,
  module_id: z.enum(['support']),
  ...TenantContextSchema.shape,
  trace_id: z.string().min(1),
  jobs: z.array(JobRequestSchema),
  hash: HashMetadataSchema,
});

export type JobRequestBundle = z.infer<typeof JobRequestBundleSchema>;

export const EvidenceLinkSchema = z.object({
  label: z.string().min(1),
  url: z.string().url(),
});

export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  title: z.string().min(1),
  description: z.string().min(1),
  evidence: z.array(EvidenceLinkSchema).default([]),
});

export type Finding = z.infer<typeof FindingSchema>;

export const ReportEnvelopeSchema = z.object({
  schema_version: SchemaVersionSchema,
  module_id: z.enum(['support']),
  report_type: z.string().min(1),
  ...TenantContextSchema.shape,
  trace_id: z.string().min(1),
  summary: z.string().min(1),
  findings: z.array(FindingSchema),
  metadata: z.record(z.unknown()).default({}),
  hash: HashMetadataSchema,
});

export type ReportEnvelope = z.infer<typeof ReportEnvelopeSchema>;
export type Severity = Finding['severity'];

export function createEventEnvelope(input: EventEnvelope): EventEnvelope {
  return EventEnvelopeSchema.parse(input);
}

export function createRunManifest(input: RunManifest): RunManifest {
  return RunManifestSchema.parse(input);
}

export function createJobRequest(
  tenantIdOrInput: string | (Omit<JobRequest, 'idempotency_key'> & { idempotency_key?: string }),
  projectId?: string,
  jobType?: JobType,
  payload?: Record<string, unknown>,
  options?: {
    priority?: JobPriority;
    jobId?: string;
    scheduledFor?: Date | string;
    metadata?: Record<string, unknown>;
    traceId?: string;
    moduleId?: 'support';
    createdAt?: string;
    requiresPolicyToken?: boolean;
    idempotencyKey?: string;
  }
): JobRequest {
  if (typeof tenantIdOrInput !== 'string') {
    const idempotencyKey = tenantIdOrInput.idempotency_key ?? stableHash({
      tenant_id: tenantIdOrInput.tenant_id,
      project_id: tenantIdOrInput.project_id,
      job_type: tenantIdOrInput.job_type,
      payload: tenantIdOrInput.payload,
    });

    return JobRequestSchema.parse({
      ...tenantIdOrInput,
      idempotency_key: idempotencyKey,
    });
  }

  if (projectId == null || jobType == null || payload == null) {
    throw new Error('createJobRequest requires tenant, project, job type, and payload');
  }

  const createdAt = options?.createdAt ?? new Date().toISOString();
  const idempotencyKey = options?.idempotencyKey ?? stableHash({
    tenant_id: tenantIdOrInput,
    project_id: projectId,
    job_type: jobType,
    payload,
  });

  return JobRequestSchema.parse({
    schema_version,
    module_id: options?.moduleId ?? 'support',
    tenant_id: tenantIdOrInput,
    project_id: projectId,
    trace_id: options?.traceId,
    job_type: jobType,
    job_id: options?.jobId ?? `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    idempotency_key: idempotencyKey,
    priority: options?.priority ?? 'normal',
    payload,
    created_at: createdAt,
    scheduled_for: options?.scheduledFor != null
      ? (typeof options.scheduledFor === 'string' ? options.scheduledFor : options.scheduledFor.toISOString())
      : undefined,
    requires_policy_token: options?.requiresPolicyToken ?? false,
    metadata: options?.metadata ?? {},
  });
}

export function createJobRequestBundle(input: Omit<JobRequestBundle, 'hash'>): JobRequestBundle {
  return JobRequestBundleSchema.parse(withCanonicalHash(input));
}

export function createReportEnvelope(input: Omit<ReportEnvelope, 'hash'>): ReportEnvelope {
  return ReportEnvelopeSchema.parse(withCanonicalHash(input));
}

export function validateJobRequestBundle(data: unknown): JobRequestBundle {
  return JobRequestBundleSchema.parse(data);
}

export function validateReportEnvelope(data: unknown): ReportEnvelope {
  return ReportEnvelopeSchema.parse(data);
}

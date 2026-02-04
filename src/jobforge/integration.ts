import { z } from 'zod';
import type { Ticket } from '../contracts/ticket.js';
import { TicketSchema } from '../contracts/ticket.js';
import { TriageResultSchema, type TriageResult } from '../contracts/triage-result.js';
import { KBSourceSchema } from '../contracts/kb-source.js';
import {
  EventEnvelopeSchema,
  RunManifestSchema,
  JobRequestBundleSchema,
  ReportEnvelopeSchema,
  schema_version,
  type JobRequest,
  type JobRequestBundle,
  type ReportEnvelope,
  type Finding,
} from '../contracts/compat.js';
import { stableHash, withCanonicalHash } from '../utils/deterministic.js';

const MODULE_ID = 'support' as const;
const SCHEMA_VERSION = schema_version;
const STABLE_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export const AnalyzeInputSchema = z.object({
  tenant_id: z.string().min(1).optional(),
  project_id: z.string().min(1).optional(),
  trace_id: z.string().min(1).optional(),
  events: z.array(EventEnvelopeSchema).optional(),
  run_manifests: z.array(RunManifestSchema).optional(),
  tickets: z.array(TicketSchema).optional(),
  triage_results: z.array(TriageResultSchema).optional(),
  kb_sources: z.array(KBSourceSchema).optional(),
});

export type AnalyzeInputs = z.infer<typeof AnalyzeInputSchema>;

export interface AnalyzeOptions {
  tenantId: string;
  projectId: string;
  traceId: string;
  stableOutput?: boolean;
  now?: Date;
}

export interface AnalyzeResult {
  reportEnvelope: ReportEnvelope;
  jobRequestBundle: JobRequestBundle;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export interface FinOpsMetadata {
  cost_center: string;
  cost_object: string;
  max_cost_usd: number;
  max_runtime_seconds: number;
  max_output_bytes: number;
}

export interface MetricsInput {
  jobRequestBundle: JobRequestBundle;
  reportEnvelope: ReportEnvelope;
  validation: ValidationResult;
}

const ACTION_JOB_TYPES = new Set([
  'autopilot.support.propose_kb_patch',
  'autopilot.support.ingest_kb',
]);

const FINOPS_DEFAULTS: Omit<FinOpsMetadata, 'cost_object'> = {
  cost_center: 'support-autopilot',
  max_cost_usd: 0.25,
  max_runtime_seconds: 60,
  max_output_bytes: 20000,
};

function buildFinOpsMetadata(jobType: JobRequest['job_type']): FinOpsMetadata {
  return {
    ...FINOPS_DEFAULTS,
    cost_object: jobType,
  };
}

function ensureTenantScope(
  items: Array<{ tenant_id: string; project_id: string }>,
  tenantId: string,
  projectId: string
): void {
  for (const item of items) {
    if (item.tenant_id !== tenantId || item.project_id !== projectId) {
      throw new Error(`Tenant/project mismatch: expected ${tenantId}/${projectId}`);
    }
  }
}

function buildJobRequest(
  jobType: JobRequest['job_type'],
  payload: Record<string, unknown>,
  options: AnalyzeOptions
): JobRequest {
  const createdAt = options.stableOutput === true
    ? STABLE_TIMESTAMP
    : (options.now ?? new Date()).toISOString();
  const idempotencyKey = stableHash({
    tenant_id: options.tenantId,
    project_id: options.projectId,
    job_type: jobType,
    payload,
  });

  return {
    schema_version: SCHEMA_VERSION,
    module_id: MODULE_ID,
    tenant_id: options.tenantId,
    project_id: options.projectId,
    trace_id: options.traceId,
    job_type: jobType,
    job_id: options.stableOutput === true
      ? `job_${idempotencyKey.slice(0, 12)}`
      : `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    idempotency_key: idempotencyKey,
    priority: 'normal',
    payload,
    created_at: createdAt,
    requires_policy_token: ACTION_JOB_TYPES.has(jobType),
    metadata: {
      finops: buildFinOpsMetadata(jobType),
    },
  };
}

function buildTriageJobs(tickets: Ticket[], options: AnalyzeOptions): JobRequest[] {
  return tickets.map(ticket => buildJobRequest(
    'autopilot.support.triage',
    {
      ticket_id: ticket.id,
      subject: ticket.subject,
      body_preview: ticket.body.slice(0, 500),
      ticket_priority: ticket.priority,
      ticket_status: ticket.status,
    },
    options
  ));
}

function buildFindings(tickets: Ticket[], triageResults: TriageResult[]): Finding[] {
  const findings: Finding[] = [
    {
      id: 'support.jobforge.bundle.created',
      severity: 'info',
      title: 'JobForge bundle prepared',
      description: `Prepared ${tickets.length} triage job request(s) for JobForge.`,
      evidence: [],
    },
  ];

  if (triageResults.length > 0) {
    findings.push({
      id: 'support.triage.results.provided',
      severity: 'info',
      title: 'Triage results provided',
      description: `Received ${triageResults.length} triage result(s) for context.`,
      evidence: [],
    });
  }

  if (tickets.length === 0) {
    findings.push({
      id: 'support.inputs.empty',
      severity: 'low',
      title: 'No tickets provided',
      description: 'No ticket inputs were provided; no job requests were created.',
      evidence: [],
    });
  }

  return findings.sort((left, right) => left.id.localeCompare(right.id));
}

function buildReportEnvelope(
  tenantId: string,
  projectId: string,
  traceId: string,
  tickets: Ticket[],
  triageResults: TriageResult[]
): ReportEnvelope {
  const findings = buildFindings(tickets, triageResults);

  return ReportEnvelopeSchema.parse(withCanonicalHash({
    schema_version: SCHEMA_VERSION,
    module_id: MODULE_ID,
    report_type: 'autopilot.support.analysis',
    tenant_id: tenantId,
    project_id: projectId,
    trace_id: traceId,
    summary: `Support autopilot analyzed ${tickets.length} ticket(s) and prepared ${tickets.length} job request(s).`,
    findings,
    metadata: {
      ticket_count: tickets.length,
      triage_result_count: triageResults.length,
    },
  }));
}

function buildBundle(
  tenantId: string,
  projectId: string,
  traceId: string,
  jobs: JobRequest[]
): JobRequestBundle {
  const orderedJobs = [...jobs].sort((left, right) => {
    const typeCompare = left.job_type.localeCompare(right.job_type);
    if (typeCompare !== 0) {
      return typeCompare;
    }
    return left.idempotency_key.localeCompare(right.idempotency_key);
  });

  return JobRequestBundleSchema.parse(withCanonicalHash({
    schema_version: SCHEMA_VERSION,
    module_id: MODULE_ID,
    tenant_id: tenantId,
    project_id: projectId,
    trace_id: traceId,
    jobs: orderedJobs,
  }));
}

export function analyze(inputs: AnalyzeInputs, options: AnalyzeOptions): AnalyzeResult {
  const parsedInputs = AnalyzeInputSchema.parse(inputs);
  const tenantId = options.tenantId;
  const projectId = options.projectId;
  const traceId = options.traceId;

  if (parsedInputs.tenant_id != null && parsedInputs.tenant_id !== tenantId) {
    throw new Error('Tenant ID mismatch between inputs and options');
  }
  if (parsedInputs.project_id != null && parsedInputs.project_id !== projectId) {
    throw new Error('Project ID mismatch between inputs and options');
  }
  if (parsedInputs.trace_id != null && parsedInputs.trace_id !== traceId) {
    throw new Error('Trace ID mismatch between inputs and options');
  }

  const tickets = parsedInputs.tickets ?? [];
  const triageResults = parsedInputs.triage_results ?? [];
  const events = parsedInputs.events ?? [];
  const runManifests = parsedInputs.run_manifests ?? [];
  const kbSources = parsedInputs.kb_sources ?? [];

  ensureTenantScope(tickets, tenantId, projectId);
  ensureTenantScope(triageResults, tenantId, projectId);
  ensureTenantScope(events, tenantId, projectId);
  ensureTenantScope(runManifests, tenantId, projectId);
  ensureTenantScope(kbSources, tenantId, projectId);

  const jobs = buildTriageJobs(tickets, options);

  return {
    reportEnvelope: buildReportEnvelope(tenantId, projectId, traceId, tickets, triageResults),
    jobRequestBundle: buildBundle(tenantId, projectId, traceId, jobs),
  };
}

export function validateBundle(bundle: unknown): ValidationResult {
  const schemaResult = JobRequestBundleSchema.safeParse(bundle);
  if (!schemaResult.success) {
    return {
      valid: false,
      errors: schemaResult.error.issues.map(issue => issue.message),
    };
  }

  const errors: string[] = [];
  for (const job of schemaResult.data.jobs) {
    if (!job.idempotency_key) {
      errors.push(`Job ${job.job_id} is missing idempotency_key`);
    }

    const finops = (job.metadata as { finops?: FinOpsMetadata | null } | undefined)?.finops;
    if (!finops) {
      errors.push(`Job ${job.job_id} is missing finops metadata`);
    } else {
      if (!finops.cost_center) {
        errors.push(`Job ${job.job_id} finops.cost_center is required`);
      }
      if (!finops.cost_object) {
        errors.push(`Job ${job.job_id} finops.cost_object is required`);
      }
      if (finops.max_cost_usd == null || finops.max_cost_usd <= 0) {
        errors.push(`Job ${job.job_id} finops.max_cost_usd must be > 0`);
      }
      if (finops.max_runtime_seconds == null || finops.max_runtime_seconds <= 0) {
        errors.push(`Job ${job.job_id} finops.max_runtime_seconds must be > 0`);
      }
      if (finops.max_output_bytes == null || finops.max_output_bytes <= 0) {
        errors.push(`Job ${job.job_id} finops.max_output_bytes must be > 0`);
      }
    }

    if (job.tenant_id !== schemaResult.data.tenant_id || job.project_id !== schemaResult.data.project_id) {
      errors.push(`Job ${job.job_id} has tenant/project mismatch`);
    }

    if (ACTION_JOB_TYPES.has(job.job_type) && !job.requires_policy_token) {
      errors.push(`Job ${job.job_id} of type ${job.job_type} requires policy token annotation`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

function formatMetricLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return '';
  }
  const serialized = entries
    .map(([key, value]) => `${key}="${value}"`)
    .join(',');
  return `{${serialized}}`;
}

function renderMetricSample(
  name: string,
  value: number,
  labels: Record<string, string> = {}
): string {
  return `${name}${formatMetricLabels(labels)} ${value}`;
}

export function renderMetrics(input: MetricsInput): string {
  const { jobRequestBundle, reportEnvelope, validation } = input;
  const ticketCount = Number(reportEnvelope.metadata?.ticket_count ?? 0);
  const triageResultCount = Number(reportEnvelope.metadata?.triage_result_count ?? 0);
  const jobTypeCounts = jobRequestBundle.jobs.reduce<Record<string, number>>((counts, job) => {
    counts[job.job_type] = (counts[job.job_type] ?? 0) + 1;
    return counts;
  }, {});

  const lines = [
    '# HELP support_autopilot_runner_runs_total Total runner invocations by outcome.',
    '# TYPE support_autopilot_runner_runs_total counter',
    renderMetricSample('support_autopilot_runner_runs_total', 1, {
      runner: 'bundle_emitter',
      outcome: validation.valid ? 'success' : 'failure',
    }),
    '# HELP support_autopilot_tickets_total Total tickets analyzed.',
    '# TYPE support_autopilot_tickets_total counter',
    renderMetricSample('support_autopilot_tickets_total', ticketCount, { outcome: 'processed' }),
    '# HELP support_autopilot_triage_results_total Total triage results received.',
    '# TYPE support_autopilot_triage_results_total counter',
    renderMetricSample('support_autopilot_triage_results_total', triageResultCount, { outcome: 'received' }),
    '# HELP support_autopilot_job_requests_total Total job requests emitted.',
    '# TYPE support_autopilot_job_requests_total counter',
  ];

  for (const [jobType, count] of Object.entries(jobTypeCounts)) {
    lines.push(renderMetricSample('support_autopilot_job_requests_total', count, {
      job_type: jobType,
      outcome: 'emitted',
    }));
  }

  if (!validation.valid) {
    const errorCount = validation.errors?.length ?? 0;
    lines.push(
      '# HELP support_autopilot_validation_errors_total Total validation errors.',
      '# TYPE support_autopilot_validation_errors_total counter',
      renderMetricSample('support_autopilot_validation_errors_total', errorCount, { stage: 'bundle_validation' })
    );
  }

  lines.push('# EOF');
  return lines.join('\n');
}

export function renderReport(reportEnvelope: ReportEnvelope, format: 'markdown' | 'json' = 'json'): string {
  if (format === 'json') {
    return JSON.stringify(reportEnvelope, null, 2);
  }

  const lines = [
    `# Support Autopilot Report`,
    ``,
    `- Module: ${reportEnvelope.module_id}`,
    `- Tenant: ${reportEnvelope.tenant_id}`,
    `- Project: ${reportEnvelope.project_id}`,
    `- Trace: ${reportEnvelope.trace_id}`,
    ``,
    `## Summary`,
    reportEnvelope.summary,
    ``,
    `## Findings`,
  ];

  if (reportEnvelope.findings.length === 0) {
    lines.push('', '_No findings available._');
  } else {
    for (const finding of reportEnvelope.findings) {
      lines.push(
        ``,
        `### ${finding.title}`,
        `Severity: ${finding.severity}`,
        ``,
        finding.description
      );
    }
  }

  return lines.join('\n');
}

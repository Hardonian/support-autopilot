import { type JobRequest, createJobRequest } from '@autopilot/contracts';
import type { Ticket } from '../contracts/ticket.js';
import type { TriageResult } from '../contracts/triage-result.js';
import type { KBPatchProposal } from '../contracts/kb-patch.js';

export interface JobForgeOptions {
  tenantId: string;
  projectId: string;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  scheduledFor?: Date | string;
  metadata?: Record<string, unknown>;
}

function formatScheduledFor(scheduledFor?: Date | string): string | undefined {
  if (scheduledFor instanceof Date) {
    return scheduledFor.toISOString();
  }
  return scheduledFor;
}

export function createTriageJob(
  ticket: Ticket,
  options: JobForgeOptions
): JobRequest {
  return createJobRequest(
    options.tenantId,
    options.projectId,
    'autopilot.support.triage',
    {
      ticket_id: ticket.id,
      subject: ticket.subject,
      body_preview: ticket.body.slice(0, 500),
      ...(options.metadata && { _metadata: options.metadata }),
    },
    {
      priority: options.priority,
      scheduledFor: formatScheduledFor(options.scheduledFor),
    }
  );
}

export function createDraftReplyJob(
  ticket: Ticket,
  triageResult: TriageResult,
  tone: string,
  options: JobForgeOptions
): JobRequest {
  return createJobRequest(
    options.tenantId,
    options.projectId,
    'autopilot.support.draft_reply',
    {
      ticket_id: ticket.id,
      triage_result_id: triageResult.ticket_id,
      tone,
      requires_human_review: triageResult.requires_human_review,
      urgency: triageResult.urgency,
      triage_topics: triageResult.topics,
      ...(options.metadata && { _metadata: options.metadata }),
    },
    {
      priority: triageResult.urgency === 'critical' ? 'critical' : options.priority,
      scheduledFor: formatScheduledFor(options.scheduledFor),
    }
  );
}

export function createKBPatchJob(
  proposal: KBPatchProposal,
  options: JobForgeOptions
): JobRequest {
  return createJobRequest(
    options.tenantId,
    options.projectId,
    'autopilot.support.propose_kb_patch',
    {
      proposal_id: proposal.id,
      patch_type: proposal.type,
      proposed_title: proposal.proposed_title,
      related_ticket_count: proposal.related_ticket_ids.length,
      diff_preview: proposal.diff?.slice(0, 500),
      related_tickets: proposal.related_ticket_ids,
      ...(options.metadata && { _metadata: options.metadata }),
    },
    {
      priority: options.priority,
    }
  );
}

export function createBatchTriageJob(
  tickets: Ticket[],
  options: JobForgeOptions
): JobRequest {
  return createJobRequest(
    options.tenantId,
    options.projectId,
    'autopilot.support.triage',
    {
      ticket_count: tickets.length,
      ticket_ids: tickets.map(t => t.id),
      batch_size: tickets.length,
      is_batch: true,
      ...(options.metadata && { _metadata: options.metadata }),
    },
    {
      priority: options.priority,
      scheduledFor: formatScheduledFor(options.scheduledFor),
    }
  );
}

export function createIngestKBJob(
  sourcePaths: string[],
  options: JobForgeOptions
): JobRequest {
  return createJobRequest(
    options.tenantId,
    options.projectId,
    'autopilot.support.ingest_kb',
    {
      source_paths: sourcePaths,
      source_count: sourcePaths.length,
      ingestion_batch_size: sourcePaths.length,
      ...(options.metadata && { _metadata: options.metadata }),
    },
    {
      priority: options.priority,
    }
  );
}

export function exportJobRequest(job: JobRequest): string {
  return JSON.stringify(job, null, 2);
}

export function exportJobRequests(jobs: JobRequest[]): string {
  return JSON.stringify({ jobs }, null, 2);
}

export function formatJobForgeOutput(
  jobs: JobRequest[],
  dryRun: boolean = true
): string {
  const header = dryRun 
    ? '# JobForge Job Requests (DRAFT ONLY - Not Executed)\n\n'
    : '# JobForge Job Requests\n\n';
    
  const summary = `Generated ${jobs.length} job request(s):\n` +
    jobs.map(j => `- ${j.job_type} (${j.priority})`).join('\n') +
    '\n\n';
    
  const jobDetails = jobs.map(job => 
    `## ${job.job_id}\n` +
    `Type: ${job.job_type}\n` +
    `Priority: ${job.priority}\n` +
    `Tenant: ${job.tenant_id}\n` +
    `Project: ${job.project_id}\n` +
    `Created: ${job.created_at}\n\n` +
    'Payload:\n' +
    '```json\n' +
    JSON.stringify(job.payload, null, 2) +
    '\n```\n'
  ).join('\n');
  
  return header + summary + jobDetails;
}

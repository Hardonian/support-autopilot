// Re-export from @autopilot suite packages (selective to avoid naming conflicts)
export {
  // Tenant and base types
  type TenantContext,
  TenantContextSchema,
  validateTenantContext,
  
  // Event types
  type EventEnvelope,
  type EventMetadata,
  EventEnvelopeSchema,
  createEventEnvelope,
  
  // Job request types  
  type JobRequest,
  type JobType,
  type JobPriority,
  JobRequestSchema,
  createJobRequest,
  
  // Report types
  type ReportEnvelope,
  type ReportType,
  type Severity,
  ReportEnvelopeSchema,
  createReportEnvelope,
  
  // Evidence and findings
  type EvidenceLink,
  type Finding,
  EvidenceLinkSchema,
  FindingSchema,
  
  // Utilities
  canonicalizeForHash,
  stableHash,
  serializeDeterministic,
} from '@autopilot/contracts';

// JobForge client (selective exports)
export {
  buildJobRequest,
  createJobBatch,
  groupJobsByType,
  serializeJobRequest,
  serializeJobBatch,
  serializeJobsAsJsonLines,
  validateJobRequest,
  type RequestBuilderOptions,
  type JobBatch,
  type ValidationResult,
} from '@autopilot/jobforge-client';

// Domain-specific exports
export * from './contracts/ticket.js';
export * from './contracts/triage-result.js';
export * from './contracts/kb-source.js';
export * from './contracts/draft-response.js';
export * from './contracts/kb-patch.js';
export * from './kb/index.js';
export * from './triage/index.js';
export * from './draft/index.js';
export * from './kb-proposals/index.js';
export * from './jobforge/index.js';
export * from './utils/index.js';

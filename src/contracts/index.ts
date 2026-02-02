// Domain-specific contracts (shared contracts come from @autopilot/contracts)
export * from './ticket.js';
export * from './kb-source.js';
export * from './draft-response.js';
export * from './triage-result.js';
export * from './kb-patch.js';

// Re-export suite contracts for compatibility
export {
  // Tenant Context
  TenantContextSchema,
  type TenantContext,
  validateTenantContext,
  
  // Event Envelope
  EventEnvelopeSchema,
  type EventEnvelope,
  createEventEnvelope,
  
  // Run Manifest
  RunManifestSchema,
  type RunManifest,
  createRunManifest,
  
  // Job Request
  JobRequestSchema,
  type JobRequest,
  type JobType,
  type JobPriority,
  createJobRequest,
  
  // Report Envelope
  ReportEnvelopeSchema,
  type ReportEnvelope,
  type Severity,
  type EvidenceLink,
  createReportEnvelope,
  
  // Redaction
  createRedactionHints,
  redactObject,
  DEFAULT_REDACTION_PATTERNS,
  
  // Utilities
  serializeDeterministic,
} from '@autopilot/contracts';

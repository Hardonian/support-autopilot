export {
  type TenantContext,
  TenantContextSchema,
  validateTenantContext,
  type EventEnvelope,
  EventEnvelopeSchema,
  createEventEnvelope,
  type RunManifest,
  RunManifestSchema,
  createRunManifest,
  type JobRequest,
  type JobType,
  type JobPriority,
  JobRequestSchema,
  JobTypeSchema,
  JobPrioritySchema,
  createJobRequest,
  type JobRequestBundle,
  JobRequestBundleSchema,
  createJobRequestBundle,
  type ReportEnvelope,
  ReportEnvelopeSchema,
  createReportEnvelope,
  type Severity,
  type EvidenceLink,
  type Finding,
  EvidenceLinkSchema,
  FindingSchema,
  type HashMetadata,
  HashMetadataSchema,
  validateJobRequestBundle,
  validateReportEnvelope,
  schema_version,
} from './contracts/compat.js';

export {
  canonicalizeForHash,
  stableHash,
  serializeDeterministic,
  withCanonicalHash,
} from './utils/deterministic.js';

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
} from './jobforge-client/compat.js';

// Domain-specific exports
export * from './contracts/ticket.js';
export * from './contracts/triage-result.js';
export * from './contracts/kb-source.js';
export * from './contracts/draft-response.js';
export * from './contracts/kb-patch.js';
export * from './contracts/log-event.js';
export {
  ErrorEnvelopeSchema,
  type ErrorEnvelope,
  createErrorEnvelope,
  TriagePacketSchema,
  type TriagePacket,
  validateTriagePacket,
} from './contracts/triage-packet.js';
export * from './kb/index.js';
export * from './triage/index.js';
export * from './draft/index.js';
export * from './kb-proposals/index.js';
export * from './jobforge/index.js';
export * from './utils/index.js';
export * from './jobforge/integration.js';

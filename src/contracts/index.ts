// Domain-specific contracts (shared contracts provided via compat layer)
export * from './ticket.js';
export * from './kb-source.js';
export * from './draft-response.js';
export * from './triage-result.js';
export * from './kb-patch.js';
export * from './triage-packet.js';

export {
  TenantContextSchema,
  type TenantContext,
  validateTenantContext,
} from './tenant.js';

export {
  EventEnvelopeSchema,
  type EventEnvelope,
  createEventEnvelope,
  RunManifestSchema,
  type RunManifest,
  createRunManifest,
  JobRequestSchema,
  type JobRequest,
  JobTypeSchema,
  type JobType,
  JobPrioritySchema,
  type JobPriority,
  createJobRequest,
  JobRequestBundleSchema,
  type JobRequestBundle,
  createJobRequestBundle,
  ReportEnvelopeSchema,
  type ReportEnvelope,
  type Severity,
  type EvidenceLink,
  EvidenceLinkSchema,
  FindingSchema,
  type Finding,
  createReportEnvelope,
  HashMetadataSchema,
  type HashMetadata,
  validateJobRequestBundle,
  validateReportEnvelope,
} from './compat.js';

export {
  serializeDeterministic,
  stableHash,
  canonicalizeForHash,
} from '../utils/deterministic.js';

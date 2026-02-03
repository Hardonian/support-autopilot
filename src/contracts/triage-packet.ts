import { z } from 'zod';
import { TenantContextSchema } from './tenant.js';
import { TriageTopicSchema, TriageUrgencySchema } from './triage-result.js';

/**
 * Error envelope for triage packet operations.
 * Ensures consistent error handling across all triage outputs.
 */
export const ErrorEnvelopeSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['warning', 'error', 'critical']),
  details: z.record(z.unknown()).optional(),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/**
 * PII redaction metadata tracking what was redacted.
 */
export const RedactionMetadataSchema = z.object({
  type: z.string(),
  count: z.number().int().nonnegative(),
  fields: z.array(z.string()),
});

export type RedactionMetadata = z.infer<typeof RedactionMetadataSchema>;

/**
 * Ticket data within triage packet (with optional redaction).
 */
export const TriagePacketTicketSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  body: z.string(),
  status: z.enum(['open', 'pending', 'resolved', 'closed']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  customer_email: z.string().optional(),
  customer_name: z.string().optional(),
  created_at: z.string().datetime(),
  tags: z.array(z.string()).default([]),
});

export type TriagePacketTicket = z.infer<typeof TriagePacketTicketSchema>;

/**
 * Classification result within triage packet.
 */
export const TriagePacketClassificationSchema = z.object({
  urgency: TriageUrgencySchema,
  topics: z.array(TriageTopicSchema),
  missing_info: z.array(z.string()).default([]),
  suggested_tags: z.array(z.string()).default([]),
  requires_human_review: z.boolean().default(false),
  requires_kb_update: z.boolean().default(false),
});

export type TriagePacketClassification = z.infer<typeof TriagePacketClassificationSchema>;

/**
 * Metadata about triage packet generation.
 */
export const TriagePacketMetadataSchema = z.object({
  processed_at: z.string().datetime(),
  version: z.string().default('1.0'),
  classifier_version: z.string().optional(),
  redaction_applied: z.boolean().default(false),
  redaction_summary: z.array(RedactionMetadataSchema).default([]),
  total_redactions: z.number().int().nonnegative().default(0),
});

export type TriagePacketMetadata = z.infer<typeof TriagePacketMetadataSchema>;

/**
 * Main triage packet schema.
 * Structured output for support.triage_packet capability.
 */
export const TriagePacketSchema = z.object({
  ...TenantContextSchema.shape,
  schema_version: z.literal('1.0').default('1.0'),
  packet_id: z.string().min(1),
  ticket: TriagePacketTicketSchema,
  classification: TriagePacketClassificationSchema,
  metadata: TriagePacketMetadataSchema,
  errors: z.array(ErrorEnvelopeSchema).default([]),
});

export type TriagePacket = z.infer<typeof TriagePacketSchema>;

/**
 * Validate a triage packet against schema.
 */
export function validateTriagePacket(data: unknown): TriagePacket {
  return TriagePacketSchema.parse(data);
}

/**
 * Check if triage packet has any errors.
 */
export function hasErrors(packet: TriagePacket): boolean {
  return packet.errors.length > 0;
}

/**
 * Get critical errors from triage packet.
 */
export function getCriticalErrors(packet: TriagePacket): ErrorEnvelope[] {
  return packet.errors.filter(e => e.severity === 'critical');
}

/**
 * Create error envelope for consistent error handling.
 */
export function createErrorEnvelope(
  code: string,
  message: string,
  severity: ErrorEnvelope['severity'] = 'error',
  details?: Record<string, unknown>
): ErrorEnvelope {
  return ErrorEnvelopeSchema.parse({
    code,
    message,
    severity,
    details,
  });
}

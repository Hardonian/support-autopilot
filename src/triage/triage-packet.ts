import type { Ticket } from '../contracts/ticket.js';
import type { TriageResult } from '../contracts/triage-result.js';
import {
  TriagePacketSchema,
  ErrorEnvelopeSchema,
  type TriagePacket,
  type ErrorEnvelope,
  type RedactionMetadata,
} from '../contracts/triage-packet.js';
import { redactPII, hasPII, type RedactionResult } from '../utils/pii.js';
import { stableHash } from '../utils/deterministic.js';

/**
 * Options for creating a triage packet.
 */
export interface TriagePacketOptions {
  classifierVersion?: string;
  applyRedaction?: boolean;
  redactFields?: string[];
}

/**
 * Default fields to redact if PII is detected.
 */
const DEFAULT_REDACT_FIELDS = ['subject', 'body', 'customer_email', 'customer_name'];

/**
 * Redact PII from ticket fields.
 */
function redactTicketFields(
  ticket: Ticket,
  fields: string[]
): { redacted: Partial<Ticket>; redactions: RedactionMetadata[]; totalRedactions: number } {
  const redacted: Partial<Ticket> = {};
  const redactionSummary: RedactionMetadata[] = [];
  let totalRedactions = 0;

  for (const field of fields) {
    const value = ticket[field as keyof Ticket];
    if (typeof value === 'string') {
      if (hasPII(value)) {
        const result: RedactionResult = redactPII(value);
        redacted[field as keyof Ticket] = result.redacted as never;
        redactionSummary.push({
          type: 'pii',
          count: result.redactionCount,
          fields: [field],
        });
        totalRedactions += result.redactionCount;
      }
    }
  }

  return { redacted, redactions: redactionSummary, totalRedactions };
}

/**
 * Create a triage packet from a ticket and triage result.
 * Applies PII redaction if enabled.
 */
export function createTriagePacket(
  ticket: Ticket,
  triageResult: TriageResult,
  options: TriagePacketOptions = {}
): TriagePacket {
  const {
    classifierVersion = '1.0.0',
    applyRedaction = true,
    redactFields = DEFAULT_REDACT_FIELDS,
  } = options;

  const errors: ErrorEnvelope[] = [];
  let redactionSummary: RedactionMetadata[] = [];
  let totalRedactions = 0;
  let redactedTicket = ticket;

  if (applyRedaction) {
    const redactionResult = redactTicketFields(ticket, redactFields);
    if (redactionResult.totalRedactions > 0) {
      redactedTicket = { ...ticket, ...redactionResult.redacted };
      redactionSummary = redactionResult.redactions;
      totalRedactions = redactionResult.totalRedactions;
    }
  }

  const packetId = `packet_${stableHash({
    tenant_id: ticket.tenant_id,
    project_id: ticket.project_id,
    ticket_id: ticket.id,
    timestamp: new Date().toISOString(),
  })}`;

  const packet: TriagePacket = {
    tenant_id: ticket.tenant_id,
    project_id: ticket.project_id,
    schema_version: '1.0',
    packet_id: packetId,
    ticket: {
      id: redactedTicket.id,
      subject: redactedTicket.subject,
      body: redactedTicket.body,
      status: redactedTicket.status,
      priority: redactedTicket.priority,
      customer_email: redactedTicket.customer_email,
      customer_name: redactedTicket.customer_name,
      created_at: typeof redactedTicket.created_at === 'string' ? redactedTicket.created_at : redactedTicket.created_at.toISOString(),
      tags: redactedTicket.tags,
    },
    classification: {
      urgency: triageResult.urgency,
      topics: triageResult.topics,
      missing_info: triageResult.missing_info,
      suggested_tags: triageResult.suggested_tags,
      requires_human_review: triageResult.requires_human_review,
      requires_kb_update: triageResult.requires_kb_update,
    },
    metadata: {
      processed_at: new Date().toISOString(),
      version: '1.0',
      classifier_version: classifierVersion,
      redaction_applied: applyRedaction && totalRedactions > 0,
      redaction_summary: redactionSummary,
      total_redactions: totalRedactions,
    },
    errors,
  };

  return TriagePacketSchema.parse(packet);
}

/**
 * Create a triage packet with an error.
 * Used when triage processing fails.
 */
export function createErrorTriagePacket(
  tenantId: string,
  projectId: string,
  ticketId: string,
  error: ErrorEnvelope | Error
): TriagePacket {
  const errorEnvelope = error instanceof Error
    ? ErrorEnvelopeSchema.parse({
        code: 'TRIAGE_ERROR',
        message: error.message,
        severity: 'error',
        details: { stack: error.stack },
      })
    : error;

  // Use placeholders for invalid tenant/project IDs to ensure schema validation passes
  const validTenantId = tenantId && tenantId.length > 0 ? tenantId : 'unknown';
  const validProjectId = projectId && projectId.length > 0 ? projectId : 'unknown';
  const validTicketId = ticketId && ticketId.length > 0 ? ticketId : 'unknown';

  const packetId = `packet_error_${stableHash({
    tenant_id: validTenantId,
    project_id: validProjectId,
    ticket_id: validTicketId,
    timestamp: new Date().toISOString(),
  })}`;

  const packet: TriagePacket = {
    tenant_id: validTenantId,
    project_id: validProjectId,
    schema_version: '1.0',
    packet_id: packetId,
    ticket: {
      id: validTicketId,
      subject: '[ERROR - TRIAGE FAILED]',
      body: '',
      status: 'open',
      priority: 'medium',
      created_at: new Date().toISOString(),
      tags: ['triage-error'],
    },
    classification: {
      urgency: 'high',
      topics: [],
      missing_info: [],
      suggested_tags: ['triage-error', 'requires-investigation'],
      requires_human_review: true,
      requires_kb_update: false,
    },
    metadata: {
      processed_at: new Date().toISOString(),
      version: '1.0',
      redaction_applied: false,
      redaction_summary: [],
      total_redactions: 0,
    },
    errors: [errorEnvelope],
  };

  return TriagePacketSchema.parse(packet);
}

/**
 * Safely create a triage packet with error handling.
 * Wraps createTriagePacket with try-catch for consistent error envelopes.
 */
export function safeCreateTriagePacket(
  ticket: Ticket,
  triageResult: TriageResult,
  options: TriagePacketOptions = {}
): TriagePacket {
  try {
    return createTriagePacket(ticket, triageResult, options);
  } catch (error) {
    const errorEnvelope: ErrorEnvelope = {
      code: 'PACKET_CREATION_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error creating triage packet',
      severity: 'critical',
      details: { error: String(error) },
    };

    return createErrorTriagePacket(
      ticket.tenant_id,
      ticket.project_id,
      ticket.id,
      errorEnvelope
    );
  }
}

/**
 * Serialize triage packet for safe logging (ensures no PII).
 */
export function serializeForLogging(packet: TriagePacket): string {
  const safePacket = {
    packet_id: packet.packet_id,
    tenant_id: packet.tenant_id,
    project_id: packet.project_id,
    schema_version: packet.schema_version,
    metadata: {
      processed_at: packet.metadata.processed_at,
      version: packet.metadata.version,
      redaction_applied: packet.metadata.redaction_applied,
      total_redactions: packet.metadata.total_redactions,
    },
    classification: {
      urgency: packet.classification.urgency,
      requires_human_review: packet.classification.requires_human_review,
    },
    error_count: packet.errors.length,
    has_errors: packet.errors.length > 0,
  };

  return JSON.stringify(safePacket, null, 2);
}

/**
 * Check if triage packet contains any PII in ticket data.
 */
export function packetContainsPII(packet: TriagePacket): boolean {
  const fieldsToCheck = [
    packet.ticket.subject,
    packet.ticket.body,
    packet.ticket.customer_email,
    packet.ticket.customer_name,
  ];

  return fieldsToCheck.some(field => field != null && field.length > 0 && hasPII(field));
}

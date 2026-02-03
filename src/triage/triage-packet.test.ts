import { describe, it, expect } from 'vitest';
import type { Ticket } from '../contracts/ticket.js';
import type { TriageResult } from '../contracts/triage-result.js';
import { validateTriagePacket, hasErrors, getCriticalErrors, createErrorEnvelope } from '../contracts/triage-packet.js';
import {
  createTriagePacket,
  createErrorTriagePacket,
  safeCreateTriagePacket,
  serializeForLogging,
  packetContainsPII,
} from './triage-packet.js';
import { hasPII, getPIITypes } from '../utils/pii.js';

const createMockTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  tenant_id: 't1',
  project_id: 'p1',
  id: 'ticket_123',
  subject: 'Test subject',
  body: 'Test body content',
  status: 'open',
  priority: 'medium',
  created_at: new Date().toISOString(),
  tags: [],
  metadata: {},
  ...overrides,
});

const createMockTriageResult = (overrides: Partial<TriageResult> = {}): TriageResult => ({
  tenant_id: 't1',
  project_id: 'p1',
  ticket_id: 'ticket_123',
  urgency: 'medium',
  topics: [{ category: 'technical', confidence: 0.8, keywords: ['api'] }],
  missing_info: [],
  suggested_tags: ['technical'],
  requires_kb_update: false,
  requires_human_review: false,
  processed_at: new Date().toISOString(),
  ...overrides,
});

describe('Triage Packet Creation', () => {
  it('should create a valid triage packet', () => {
    const ticket = createMockTicket();
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.schema_version).toBe('1.0');
    expect(packet.tenant_id).toBe('t1');
    expect(packet.project_id).toBe('p1');
    expect(packet.packet_id).toMatch(/^packet_/);
    expect(packet.ticket.id).toBe('ticket_123');
    expect(packet.classification.urgency).toBe('medium');
    expect(packet.errors).toHaveLength(0);
  });

  it('should validate packet schema', () => {
    const ticket = createMockTicket();
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);
    const validated = validateTriagePacket(packet);

    expect(validated).toEqual(packet);
  });

  it('should include classifier version in metadata', () => {
    const ticket = createMockTicket();
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage, { classifierVersion: '2.0.0' });

    expect(packet.metadata.classifier_version).toBe('2.0.0');
  });
});

describe('PII Redaction in Triage Packets', () => {
  it('should redact email addresses from ticket subject', () => {
    const ticket = createMockTicket({
      subject: 'Help with account user@example.com',
      body: 'My api_key=sk-abc1234567890abcdef is not working',
    });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.ticket.subject).toContain('[EMAIL_REDACTED]');
    expect(packet.ticket.subject).not.toContain('user@example.com');
    expect(packet.ticket.body).toContain('[API_KEY_REDACTED]');
    expect(packet.metadata.redaction_applied).toBe(true);
    expect(packet.metadata.total_redactions).toBeGreaterThanOrEqual(2);
  });

  it('should redact phone numbers from ticket body', () => {
    const ticket = createMockTicket({
      body: 'Please call me at 555-123-4567 for support',
    });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.ticket.body).toContain('[PHONE_REDACTED]');
    expect(packet.metadata.redaction_summary.some(r => r.fields.includes('body'))).toBe(true);
  });

  it('should redact credit card numbers', () => {
    const ticket = createMockTicket({
      body: 'My card 4111-1111-1111-1111 was declined',
    });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.ticket.body).toContain('[CC_REDACTED]');
    expect(packet.ticket.body).not.toContain('4111');
  });

  it('should redact passwords', () => {
    const ticket = createMockTicket({
      body: 'My password is supersecret12345 and I cannot login',
    });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.ticket.body).toContain('[PASSWORD_REDACTED]');
    expect(packet.ticket.body).not.toContain('supersecret12345');
  });

  it('should not apply redaction when disabled', () => {
    const ticket = createMockTicket({
      subject: 'Help with user@example.com',
    });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage, { applyRedaction: false });

    expect(packet.ticket.subject).toContain('user@example.com');
    expect(packet.metadata.redaction_applied).toBe(false);
  });

  it('should track redaction metadata correctly', () => {
    const ticket = createMockTicket({
      subject: 'Email: user@example.com',
      body: 'API Key: sk-1234567890abcdef',
      customer_email: 'customer@example.com',
    });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.metadata.redaction_summary.length).toBeGreaterThan(0);
    expect(packet.metadata.total_redactions).toBeGreaterThanOrEqual(2);
  });
});

describe('Triage Packet Error Handling', () => {
  it('should create error triage packet', () => {
    const error = createErrorEnvelope('TEST_ERROR', 'Test error message', 'error');
    const packet = createErrorTriagePacket('t1', 'p1', 'ticket_123', error);

    expect(packet.errors).toHaveLength(1);
    expect(packet.errors[0].code).toBe('TEST_ERROR');
    expect(packet.errors[0].severity).toBe('error');
    expect(packet.classification.requires_human_review).toBe(true);
    expect(packet.ticket.subject).toBe('[ERROR - TRIAGE FAILED]');
  });

  it('should create error packet from Error object', () => {
    const error = new Error('Something went wrong');
    const packet = createErrorTriagePacket('t1', 'p1', 'ticket_123', error);

    expect(packet.errors).toHaveLength(1);
    expect(packet.errors[0].code).toBe('TRIAGE_ERROR');
    expect(packet.errors[0].message).toBe('Something went wrong');
  });

  it('should detect hasErrors correctly', () => {
    const errorPacket = createErrorTriagePacket('t1', 'p1', 'ticket_123', new Error('Test'));
    expect(hasErrors(errorPacket)).toBe(true);

    const ticket = createMockTicket();
    const triage = createMockTriageResult();
    const validPacket = createTriagePacket(ticket, triage);
    expect(hasErrors(validPacket)).toBe(false);
  });

  it('should get critical errors only', () => {
    const criticalError = createErrorEnvelope('CRITICAL', 'Critical issue', 'critical');
    const warningError = createErrorEnvelope('WARNING', 'Warning message', 'warning');

    const packet = createErrorTriagePacket('t1', 'p1', 'ticket_123', criticalError);
    packet.errors.push(warningError);

    const criticalErrors = getCriticalErrors(packet);
    expect(criticalErrors).toHaveLength(1);
    expect(criticalErrors[0].severity).toBe('critical');
  });

  it('should handle packet creation errors gracefully', () => {
    const ticket = createMockTicket({ tenant_id: '' }); // Invalid tenant
    const triage = createMockTriageResult();

    const packet = safeCreateTriagePacket(ticket, triage);

    expect(hasErrors(packet)).toBe(true);
    expect(packet.errors[0].code).toBe('PACKET_CREATION_ERROR');
    expect(packet.errors[0].severity).toBe('critical');
  });
});

describe('Safe Logging - No Secrets/PII', () => {
  it('should serialize packet for logging without ticket body', () => {
    const ticket = createMockTicket({ body: 'Sensitive content with user@example.com' });
    const triage = createMockTriageResult();
    const packet = createTriagePacket(ticket, triage, { applyRedaction: false });

    const serialized = serializeForLogging(packet);
    const parsed = JSON.parse(serialized);

    expect(parsed).not.toHaveProperty('ticket');
    expect(parsed).not.toHaveProperty('classification.topics');
    expect(parsed).toHaveProperty('packet_id');
    expect(parsed).toHaveProperty('metadata.redaction_applied');
  });

  it('should not expose PII in log serialization', () => {
    const ticket = createMockTicket({
      subject: 'user@example.com needs help',
      body: 'password: secret123',
    });
    const triage = createMockTriageResult();
    const packet = createTriagePacket(ticket, triage, { applyRedaction: false });

    const serialized = serializeForLogging(packet);

    expect(serialized).not.toContain('user@example.com');
    expect(serialized).not.toContain('secret123');
    expect(serialized).not.toContain('password');
  });

  it('should include error count in log output', () => {
    const errorPacket = createErrorTriagePacket('t1', 'p1', 'ticket_123', new Error('Test'));
    const serialized = serializeForLogging(errorPacket);
    const parsed = JSON.parse(serialized);

    expect(parsed.error_count).toBe(1);
    expect(parsed.has_errors).toBe(true);
  });
});

describe('PII Detection in Packets', () => {
  it('should detect PII in packet', () => {
    const ticket = createMockTicket({
      subject: 'Help user@example.com',
    });
    const triage = createMockTriageResult();
    const packet = createTriagePacket(ticket, triage, { applyRedaction: false });

    expect(packetContainsPII(packet)).toBe(true);
  });

  it('should not detect PII in clean packet', () => {
    const ticket = createMockTicket({
      subject: 'General feature question',
      body: 'How do I use the dashboard?',
    });
    const triage = createMockTriageResult();
    const packet = createTriagePacket(ticket, triage);

    expect(packetContainsPII(packet)).toBe(false);
  });

  it('should detect multiple PII types', () => {
    const ticket = createMockTicket({
      subject: 'user@example.com',
      body: 'Call me 555-123-4567',
      customer_email: 'another@example.com',
    });

    const checkSubject = hasPII(ticket.subject);
    const checkBody = hasPII(ticket.body);
    const checkEmail = ticket.customer_email ? hasPII(ticket.customer_email) : false;

    expect(checkSubject || checkBody || checkEmail).toBe(true);
  });
});

describe('Schema Validation Enforcement', () => {
  it('should reject invalid packet without tenant_id', () => {
    const invalidPacket = {
      project_id: 'p1',
      schema_version: '1.0',
      packet_id: 'packet_123',
      ticket: { id: 't1', subject: 'Test', body: 'Body', status: 'open', priority: 'medium', created_at: new Date().toISOString(), tags: [] },
      classification: { urgency: 'medium', topics: [], missing_info: [], suggested_tags: [], requires_human_review: false, requires_kb_update: false },
      metadata: { processed_at: new Date().toISOString(), redaction_applied: false, redaction_summary: [], total_redactions: 0 },
      errors: [],
    };

    expect(() => validateTriagePacket(invalidPacket)).toThrow();
  });

  it('should reject packet with invalid urgency', () => {
    const ticket = createMockTicket();
    const triage = createMockTriageResult({ urgency: 'invalid' as never });

    expect(() => createTriagePacket(ticket, triage)).toThrow();
  });

  it('should reject packet with missing required fields', () => {
    const incompletePacket = {
      tenant_id: 't1',
      project_id: 'p1',
      schema_version: '1.0',
      // Missing packet_id
    };

    expect(() => validateTriagePacket(incompletePacket)).toThrow();
  });

  it('should enforce error envelope schema', () => {
    const invalidError = {
      code: 'TEST',
      // Missing required message and severity
    };

    expect(() => createErrorEnvelope('TEST', '', 'error')).toThrow();
    expect(() => createErrorEnvelope('', 'Test message', 'error')).toThrow();
  });
});

describe('Edge Cases', () => {
  it('should handle empty ticket body', () => {
    const ticket = createMockTicket({ body: '' });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.ticket.body).toBe('');
    expect(packet.metadata.total_redactions).toBe(0);
  });

  it('should handle tickets with many PII instances', () => {
    const ticket = createMockTicket({
      body: 'Email: user1@example.com, user2@test.org, Phone: 555-111-2222, 555-333-4444',
    });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.metadata.total_redactions).toBeGreaterThanOrEqual(3);
    expect(packet.ticket.body).toContain('[EMAIL_REDACTED]');
    expect(packet.ticket.body).toContain('[PHONE_REDACTED]');
  });

  it('should handle very long ticket bodies', () => {
    const longBody = 'A'.repeat(10000) + ' user@example.com ' + 'B'.repeat(10000);
    const ticket = createMockTicket({ body: longBody });
    const triage = createMockTriageResult();

    const packet = createTriagePacket(ticket, triage);

    expect(packet.ticket.body).toContain('[EMAIL_REDACTED]');
    expect(packet.metadata.redaction_applied).toBe(true);
  });
});

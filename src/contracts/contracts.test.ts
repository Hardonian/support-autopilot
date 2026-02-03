import { describe, it, expect } from 'vitest';
import { 
  validateTicket, 
  validateTickets,
  TicketSchema 
} from '../contracts/ticket.js';
import { 
  validateKBSource,
  KBSourceSchema 
} from '../contracts/kb-source.js';
import {
  validateDraftResponse,
  DraftResponseSchema
} from '../contracts/draft-response.js';
import {
  validateTriageResult,
  TriageResultSchema
} from '../contracts/triage-result.js';
import {
  JobRequestSchema,
  createJobRequest
} from '../contracts/compat.js';

describe('Ticket Schema', () => {
  it('should validate valid ticket', () => {
    const ticket = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'ticket1',
      subject: 'Test',
      body: 'Body',
      status: 'open',
      priority: 'medium',
      created_at: new Date().toISOString(),
      tags: [],
      metadata: {},
    };
    
    expect(() => validateTicket(ticket)).not.toThrow();
  });
  
  it('should reject missing tenant_id', () => {
    const ticket = {
      project_id: 'p1',
      id: 'ticket1',
      subject: 'Test',
      body: 'Body',
      status: 'open',
      priority: 'medium',
      created_at: new Date().toISOString(),
      tags: [],
      metadata: {},
    };
    
    expect(() => validateTicket(ticket)).toThrow();
  });
  
  it('should reject invalid status', () => {
    const ticket = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'ticket1',
      subject: 'Test',
      body: 'Body',
      status: 'invalid_status',
      priority: 'medium',
      created_at: new Date().toISOString(),
      tags: [],
      metadata: {},
    };
    
    expect(() => validateTicket(ticket)).toThrow();
  });
  
  it('should validate multiple tickets', () => {
    const tickets = [
      {
        tenant_id: 't1',
        project_id: 'p1',
        id: 'ticket1',
        subject: 'Test',
        body: 'Body',
        status: 'open',
        priority: 'medium',
        created_at: new Date().toISOString(),
        tags: [],
        metadata: {},
      },
      {
        tenant_id: 't1',
        project_id: 'p1',
        id: 'ticket2',
        subject: 'Test 2',
        body: 'Body 2',
        status: 'pending',
        priority: 'high',
        created_at: new Date().toISOString(),
        tags: [],
        metadata: {},
      },
    ];
    
    const result = validateTickets(tickets);
    expect(result).toHaveLength(2);
  });
});

describe('KB Source Schema', () => {
  it('should validate valid KB source', () => {
    const source = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'kb1',
      type: 'markdown',
      title: 'Test Doc',
      content: '# Test',
      chunks: [],
      ingested_at: new Date().toISOString(),
      metadata: {},
    };
    
    expect(() => validateKBSource(source)).not.toThrow();
  });
});

describe('Draft Response Schema', () => {
  it('should validate valid draft', () => {
    const draft = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'draft1',
      ticket_id: 'ticket1',
      body: 'Response body',
      citations: [],
      status: 'draft',
      tone: 'friendly',
      missing_claims: [],
      warnings: [],
      created_at: new Date().toISOString(),
    };
    
    expect(() => validateDraftResponse(draft)).not.toThrow();
  });
});

describe('Triage Result Schema', () => {
  it('should validate valid triage result', () => {
    const result = {
      tenant_id: 't1',
      project_id: 'p1',
      ticket_id: 'ticket1',
      urgency: 'high',
      topics: [{ category: 'technical', confidence: 0.8, keywords: ['api'] }],
      missing_info: [],
      suggested_tags: [],
      requires_kb_update: false,
      requires_human_review: false,
      processed_at: new Date().toISOString(),
    };
    
    expect(() => validateTriageResult(result)).not.toThrow();
  });
});

describe('Job Request Schema', () => {
  it('should validate valid job request', () => {
    const job = {
      schema_version: '1.0',
      module_id: 'support',
      tenant_id: 't1',
      project_id: 'p1',
      trace_id: 'trace1',
      job_type: 'autopilot.support.triage',
      job_id: 'job1',
      idempotency_key: 'idempotency1',
      priority: 'normal',
      payload: { ticket_id: 't1' },
      created_at: new Date().toISOString(),
      requires_policy_token: false,
      metadata: {},
    };
    
    expect(() => JobRequestSchema.parse(job)).not.toThrow();
  });
  
  it('should create job request with defaults', () => {
    const job = createJobRequest(
      't1',
      'p1',
      'autopilot.support.triage',
      { ticket_id: 't1' }
    );
    
    expect(job.tenant_id).toBe('t1');
    expect(job.project_id).toBe('p1');
    expect(job.job_type).toBe('autopilot.support.triage');
    expect(job.priority).toBe('normal');
    expect(job.job_id).toMatch(/^job_/);
    expect(job.idempotency_key).toBeDefined();
  });
  
  it('should create job request with options', () => {
    const job = createJobRequest(
      't1',
      'p1',
      'autopilot.support.draft_reply',
      { ticket_id: 't1' },
      {
        priority: 'high',
        jobId: 'custom-job-id',
        metadata: { source: 'test' },
      }
    );
    
    expect(job.priority).toBe('high');
    expect(job.job_id).toBe('custom-job-id');
    expect(job.metadata).toEqual({ source: 'test' });
  });
});

import { describe, it, expect } from 'vitest';
import { validateCitations, draftResponse } from '../draft/generator.js';
import type { KBChunk } from '../contracts/kb-source.js';
import type { Ticket } from '../contracts/ticket.js';
import type { TriageResult } from '../contracts/triage-result.js';

const createTestKBChunk = (content: string, id: string = 'chunk1'): KBChunk => ({
  id,
  content,
  source_id: 'kb1',
  start_line: 0,
  end_line: 1,
  heading_path: [],
  metadata: {},
});

const createTestTicket = (): Ticket => ({
  tenant_id: 't1',
  project_id: 'p1',
  id: 'ticket1',
  subject: 'Test question',
  body: 'How do I authenticate?',
  status: 'open',
  priority: 'medium',
  created_at: new Date().toISOString(),
  tags: [],
  metadata: {},
});

const createTestTriage = (): TriageResult => ({
  tenant_id: 't1',
  project_id: 'p1',
  ticket_id: 'ticket1',
  urgency: 'medium',
  topics: [{ category: 'technical', confidence: 0.9, keywords: ['api', 'auth'] }],
  missing_info: [],
  suggested_priority: 'medium',
  suggested_tags: ['api', 'authentication'],
  requires_kb_update: false,
  requires_human_review: false,
  processed_at: new Date().toISOString(),
});

describe('validateCitations', () => {
  it('should pass for properly cited claims', () => {
    const chunkContent = 'You can authenticate using API keys';
    const chunks = [createTestKBChunk(chunkContent)];
    // Include citation marker with period to properly delimit the claim
    const draft = `${chunkContent}. [source: kb1]`;

    const result = validateCitations(draft, chunks);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
  
  it('should fail for uncited claims', () => {
    const chunks = [createTestKBChunk('Some other content')];
    const draft = 'You can use OAuth for authentication. This is a fact.';
    
    const result = validateCitations(draft, chunks);
    
    expect(result.valid).toBe(false);
    expect(result.missingClaims.length).toBeGreaterThan(0);
  });
  
  it('should warn when no citations present', () => {
    const chunks: KBChunk[] = [];
    const draft = 'The solution is to restart the server. You need to do this.';
    
    const result = validateCitations(draft, chunks);
    
    expect(result.warnings).toContain('Response contains factual claims but no citations');
  });
  
  it('should identify specific claim patterns', () => {
    const chunks = [createTestKBChunk('Documentation content')];
    const draft = 'Users can configure this in settings. To fix this error, you need to restart.';
    
    const result = validateCitations(draft, chunks);
    
    expect(result.missingClaims.length).toBeGreaterThan(0);
  });
});

describe('draftResponse', () => {
  it('should create draft with citations', () => {
    const ticket = createTestTicket();
    const triage = createTestTriage();
    const chunks = [createTestKBChunk('API authentication is done via tokens')];
    
    const draft = draftResponse(ticket, triage, chunks, { tone: 'friendly' });
    
    expect(draft.ticket_id).toBe(ticket.id);
    expect(draft.citations.length).toBeGreaterThan(0);
    expect(draft.body).toContain('Sources:');
    expect(draft.body).toContain('[source:');
  });
  
  it('should add disclaimer when includeDisclaimer is true', () => {
    const ticket = createTestTicket();
    const triage = createTestTriage();
    const chunks: KBChunk[] = [];
    
    // When includeDisclaimer is explicitly true, we always get a disclaimer
    const draft = draftResponse(ticket, triage, chunks, { 
      tone: 'friendly',
      includeDisclaimer: true 
    });
    
    expect(draft.disclaimer).toBeDefined();
    expect(draft.disclaimer).toContain('AI-generated draft');
  });
  
  it('should use correct tone template', () => {
    const ticket = createTestTicket();
    const triage = createTestTriage();
    const chunks = [createTestKBChunk('Content')];
    
    const friendly = draftResponse(ticket, triage, chunks, { tone: 'friendly' });
    const technical = draftResponse(ticket, triage, chunks, { tone: 'technical' });
    const formal = draftResponse(ticket, triage, chunks, { tone: 'formal' });
    
    expect(friendly.body).toContain('Hi');
    expect(technical.body).toContain('Hello');
    expect(formal.body).toContain('Dear');
  });
  
  it('should include tenant and project context', () => {
    const ticket = createTestTicket();
    const triage = createTestTriage();
    const chunks = [createTestKBChunk('Content')];
    
    const draft = draftResponse(ticket, triage, chunks, { tone: 'concise' });
    
    expect(draft.tenant_id).toBe('t1');
    expect(draft.project_id).toBe('p1');
  });
});

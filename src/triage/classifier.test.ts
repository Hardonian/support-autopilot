import { describe, it, expect } from 'vitest';
import { classifyUrgency, classifyTopics, extractMissingInfo, triageTicket } from '../triage/classifier.js';
import type { Ticket } from '../contracts/ticket.js';

const createTestTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  tenant_id: 't1',
  project_id: 'p1',
  id: 'test-1',
  subject: 'Test subject',
  body: 'Test body',
  status: 'open',
  priority: 'medium',
  created_at: new Date().toISOString(),
  tags: [],
  metadata: {},
  ...overrides,
});

describe('classifyUrgency', () => {
  it('should detect critical keywords', () => {
    const ticket = createTestTicket({
      subject: 'URGENT: System down',
      body: 'Critical outage affecting all users',
    });
    
    expect(classifyUrgency(ticket)).toBe('critical');
  });
  
  it('should detect high priority keywords', () => {
    const ticket = createTestTicket({
      subject: 'Important feature not working',
      body: 'This is blocking our workflow',
    });
    
    expect(classifyUrgency(ticket)).toBe('high');
  });
  
  it('should respect ticket priority', () => {
    const ticket = createTestTicket({
      subject: 'Regular question',
      priority: 'urgent',
    });
    
    expect(classifyUrgency(ticket)).toBe('high');
  });
  
  it('should default to medium for normal tickets', () => {
    const ticket = createTestTicket({
      subject: 'How do I use this feature?',
      body: 'Just a question about usage',
    });
    
    expect(classifyUrgency(ticket)).toBe('medium');
  });
});

describe('classifyTopics', () => {
  it('should identify billing topics', () => {
    const ticket = createTestTicket({
      subject: 'Question about my invoice',
      body: 'I need help with billing',
    });
    
    const topics = classifyTopics(ticket);
    const billingTopic = topics.find(t => t.category === 'billing');
    
    expect(billingTopic).toBeDefined();
    expect(billingTopic!.confidence).toBeGreaterThan(0);
  });
  
  it('should identify technical topics', () => {
    const ticket = createTestTicket({
      subject: 'API integration error',
      body: 'Getting a 500 error from the SDK',
    });
    
    const topics = classifyTopics(ticket);
    const techTopic = topics.find(t => t.category === 'technical');
    
    expect(techTopic).toBeDefined();
  });
  
  it('should return empty for unknown topics', () => {
    const ticket = createTestTicket({
      subject: 'Random thoughts',
      body: 'Just saying hello',
    });
    
    const topics = classifyTopics(ticket);
    
    expect(topics).toHaveLength(0);
  });
});

describe('extractMissingInfo', () => {
  it('should identify missing error messages', () => {
    const ticket = createTestTicket({
      body: 'It is not working',
    });
    
    const missing = extractMissingInfo(ticket);
    
    expect(missing).toContain('error_message');
  });
  
  it('should identify missing steps to reproduce', () => {
    const ticket = createTestTicket({
      body: 'Bug found',
    });
    
    const missing = extractMissingInfo(ticket);
    
    expect(missing).toContain('steps_to_reproduce');
  });
  
  it('should recognize when info is present', () => {
    const ticket = createTestTicket({
      body: 'Error: 404 not found. Steps: 1. Click button 2. See error',
    });
    
    const missing = extractMissingInfo(ticket);
    
    expect(missing).not.toContain('error_message');
    expect(missing).not.toContain('steps_to_reproduce');
  });
});

describe('triageTicket', () => {
  it('should produce complete triage result', () => {
    const ticket = createTestTicket({
      subject: 'API authentication failing',
      body: 'Critical: Cannot access API. Error 401. Need help urgently!',
      priority: 'high',
    });
    
    const result = triageTicket(ticket);
    
    expect(result.ticket_id).toBe(ticket.id);
    expect(result.tenant_id).toBe(ticket.tenant_id);
    expect(result.project_id).toBe(ticket.project_id);
    expect(result.urgency).toBe('critical');
    expect(result.topics.length).toBeGreaterThan(0);
    expect(result.processed_at).toBeDefined();
  });
  
  it('should flag critical for review', () => {
    const ticket = createTestTicket({
      subject: 'SECURITY BREACH',
      body: 'Urgent security issue',
    });
    
    const result = triageTicket(ticket);
    
    expect(result.requires_human_review).toBe(true);
  });
});

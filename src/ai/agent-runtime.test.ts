import { describe, it, expect } from 'vitest';
import {
  SecurityScrubberAgent,
  TriageAgent,
  DraftCopilotAgent,
  KBPatchSynthesizerAgent,
} from './agent-runtime.js';
import type { Ticket } from '../contracts/ticket.js';
import type { KBChunk } from '../contracts/kb-source.js';

describe('AgentRuntime', () => {
  const mockTicket: Ticket = {
    tenant_id: 'test-tenant',
    project_id: 'test-project',
    id: 'TICK-001',
    subject: 'URGENT: Cannot access billing portal',
    body: 'We are receiving 401 errors with API key AKIAIOSFODNN7EXAMPLE. Contact me at admin@example.com or 555-123-4567. SSN is 000-12-3456.',
    status: 'open',
    priority: 'urgent',
    created_at: new Date().toISOString(),
  };


  describe('SecurityScrubberAgent', () => {
    it('should scrub API keys, emails, phone numbers, and SSNs', () => {
      const result = SecurityScrubberAgent.scrub(mockTicket.body);
      expect(result.detectedTypes).toContain('API_KEY');
      expect(result.detectedTypes).toContain('EMAIL');
      expect(result.detectedTypes).toContain('SSN');
      expect(result.cleanText).not.toContain('000-12-3456');
      expect(result.cleanText).not.toContain('admin@example.com');
    });
  });

  describe('TriageAgent', () => {
    it('should calculate negative sentiment and high urgency for critical billing/access issue', async () => {
      const { result } = await TriageAgent.triageTicket(mockTicket, {
        tenantId: 'test-tenant',
        projectId: 'test-project',
        customerTier: 'enterprise',
      });

      expect(result.sentiment).toBeLessThan(0);
      expect(result.urgencyScore).toBeGreaterThanOrEqual(8);
      expect(result.slaDeadlineMinutes).toBeLessThanOrEqual(30);
      expect(result.securityFlags.length).toBeGreaterThan(0);
    });
  });

  describe('DraftCopilotAgent', () => {
    it('should generate draft responses with structured citations', async () => {
      const triaged = await TriageAgent.triageTicket(mockTicket, {
        tenantId: 'test-tenant',
        projectId: 'test-project',
      });

      const kbChunks: KBChunk[] = [
        {
          id: 'chunk-1',
          source_id: 'docs/auth.md',
          content: 'To fix 401 Unauthorized errors, ensure your API keys have admin scope.',
          token_count: 20,
          chunk_index: 0,
        },
      ];

      const { draft } = await DraftCopilotAgent.generateDraft(
        mockTicket,
        triaged.result,
        kbChunks,
        { tenantId: 'test-tenant', projectId: 'test-project' },
        { tone: 'friendly' }
      );

      expect(draft.body).toContain('support');
      expect(draft.citations.length).toBe(1);
      expect(draft.citations[0].source_id).toBe('docs/auth.md');
    });
  });

  describe('KBPatchSynthesizerAgent', () => {
    it('should generate RFC formatted patch proposal for recurring categories', async () => {
      const triaged = await TriageAgent.triageTicket(mockTicket, {
        tenantId: 'test-tenant',
        projectId: 'test-project',
      });

      const { proposal } = await KBPatchSynthesizerAgent.synthesizePatch([triaged.result], {
        tenantId: 'test-tenant',
        projectId: 'test-project',
      });

      expect(proposal).not.toBeNull();
      expect(proposal?.type).toBe('faq_addition');
      expect(proposal?.proposed_title).toContain('Troubleshooting Guide');
      expect(proposal?.diff).toContain('---');
    });
  });
});

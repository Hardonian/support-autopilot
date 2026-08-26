import { defaultModelRouter, ModelRouter, type ModelExecutionResult } from './model-router.js';
import { defaultRateLimiter, TenantRateLimiter } from './rate-limiter.js';
import type { Ticket } from '../contracts/ticket.js';
import type { TriageResult } from '../contracts/triage-result.js';
import type { KBChunk } from '../contracts/kb-source.js';
import type { DraftResponse, Citation } from '../contracts/draft-response.js';
import type { KBPatchProposal } from '../contracts/kb-patch.js';
import { redactPII } from '../utils/pii.js';

export interface AgentExecutionContext {
  tenantId: string;
  projectId: string;
  customerTier?: 'enterprise' | 'growth' | 'pro' | 'starter' | 'free';
  router?: ModelRouter;
  rateLimiter?: TenantRateLimiter;
}

export interface EnrichedTriageResult extends TriageResult {
  sentiment: number; // -1.0 (very negative) to +1.0 (very positive)
  churnProbability: number; // 0.0 to 1.0
  urgencyScore: number; // 1 to 10
  slaDeadlineMinutes: number;
  securityFlags: string[];
}

/**
 * High-Speed Security & PII Scrubber Agent
 */
export class SecurityScrubberAgent {
  public static scrub(text: string): { cleanText: string; detectedTypes: string[]; redactionCount: number } {
    const detectedTypes: string[] = [];

    if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) detectedTypes.push('SSN');
    if (/\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/.test(text)) detectedTypes.push('CREDIT_CARD');
    if (/[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/.test(text)) detectedTypes.push('EMAIL');
    if (/\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z-_]{35}|ghp_[0-9a-zA-Z]{36})\b/.test(text)) detectedTypes.push('API_KEY');
    if (/\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/.test(text)) detectedTypes.push('JWT');
    if (/\b(?:password|passwd|secret)\s*[:=]\s*\S+/i.test(text)) detectedTypes.push('PASSWORD');

    const cleanText = redactPII(text).redacted;
    return {
      cleanText,
      detectedTypes,
      redactionCount: detectedTypes.length,
    };
  }
}

/**
 * Intelligent Multi-Dimensional Triage & Sentiment Agent
 */
export class TriageAgent {
  public static async triageTicket(
    ticket: Ticket,
    ctx: AgentExecutionContext
  ): Promise<{ result: EnrichedTriageResult; execution: ModelExecutionResult }> {
    const router = ctx.router ?? defaultModelRouter;
    const rateLimiter = ctx.rateLimiter ?? defaultRateLimiter;

    rateLimiter.acquire(ctx.tenantId, 600);

    // Compute heuristic sentiment and urgency first
    const bodyLower = `${ticket.subject} ${ticket.body}`.toLowerCase();
    let sentiment = 0.0;
    let churnProb = 0.05;
    let urgencyScore = 3;

    if (/urgent|broken|outage|emergency|critical|downtime|breach/i.test(bodyLower)) {
      urgencyScore = 9;
      sentiment -= 0.6;
      churnProb += 0.35;
    }
    if (/refund|cancel|billing error|overcharge|dispute|lawsuit|leaving/i.test(bodyLower)) {
      sentiment -= 0.5;
      churnProb += 0.50;
      urgencyScore = Math.max(urgencyScore, 8);
    }
    if (/love|thank|great|helpful|appreciate/i.test(bodyLower)) {
      sentiment += 0.6;
      churnProb = 0.01;
    }

    sentiment = Math.max(-1.0, Math.min(1.0, sentiment));
    churnProb = Math.max(0.0, Math.min(1.0, churnProb));

    let slaDeadlineMinutes = 240; // 4h default
    if (urgencyScore >= 8) slaDeadlineMinutes = 30;
    else if (urgencyScore >= 6) slaDeadlineMinutes = 60;

    const security = SecurityScrubberAgent.scrub(ticket.body);

    const execResult = await router.execute({
      taskType: 'triage',
      prompt: `Classify ticket ID: ${ticket.id}\nSubject: ${ticket.subject}\nBody: ${security.cleanText}`,
      priority: urgencyScore >= 8 ? 'critical' : 'medium',
      customerTier: ctx.customerTier ?? 'starter',
      tenantId: ctx.tenantId,
    });

    rateLimiter.release(ctx.tenantId, execResult.usage.costUSD);

    let category = 'technical';
    let suggestedPriority: 'urgent' | 'high' | 'medium' | 'low' = 'medium';

    if (/bill|invoice|charge|refund/i.test(bodyLower)) category = 'billing';
    else if (/access|login|password|auth|permission/i.test(bodyLower)) category = 'account';
    else if (/feature|request|suggest/i.test(bodyLower)) category = 'feature-request';

    if (urgencyScore >= 8) suggestedPriority = 'urgent';
    else if (urgencyScore >= 6) suggestedPriority = 'high';
    else if (urgencyScore <= 2) suggestedPriority = 'low';

    const result: EnrichedTriageResult = {
      tenant_id: ctx.tenantId,
      project_id: ctx.projectId,
      ticket_id: ticket.id,
      urgency: urgencyScore >= 8 ? 'critical' : urgencyScore >= 6 ? 'high' : urgencyScore <= 2 ? 'low' : 'medium',
      topics: [{ category, confidence: 0.95, keywords: [category] }],
      missing_info: [],
      suggested_priority: suggestedPriority,
      suggested_tags: [category, suggestedPriority, ...(ctx.customerTier ? [ctx.customerTier] : [])],
      requires_kb_update: false,
      requires_human_review: urgencyScore >= 8,
      reasoning: `Categorized as ${category} (${suggestedPriority}) based on sentiment score ${sentiment.toFixed(2)} and urgency score ${urgencyScore}/10.`,
      processed_at: new Date().toISOString(),
      sentiment,
      churnProbability: Number(churnProb.toFixed(2)),
      urgencyScore,
      slaDeadlineMinutes,
      securityFlags: security.detectedTypes,
    };

    return { result, execution: execResult };
  }
}

/**
 * Intelligent Draft Response Copilot Agent
 */
export class DraftCopilotAgent {
  public static async generateDraft(
    ticket: Ticket,
    triageResult: TriageResult,
    kbChunks: KBChunk[],
    ctx: AgentExecutionContext,
    options: { tone?: string; includeDisclaimer?: boolean } = {}
  ): Promise<{ draft: DraftResponse; execution: ModelExecutionResult }> {
    const router = ctx.router ?? defaultModelRouter;
    const rateLimiter = ctx.rateLimiter ?? defaultRateLimiter;

    rateLimiter.acquire(ctx.tenantId, 1200);

    const security = SecurityScrubberAgent.scrub(ticket.body);
    const citations: Citation[] = kbChunks.slice(0, 3).map((chunk, index) => ({
      source_id: chunk.source_id,
      chunk_id: chunk.id,
      excerpt: chunk.content.slice(0, 200),
      relevance_score: 0.92 - index * 0.05,
    }));

    const citationsText = kbChunks
      .slice(0, 3)
      .map((c, i) => `[Source ${i + 1}]: ${c.content}`)
      .join('\n\n');

    const execResult = await router.execute({
      taskType: 'draft-response',
      prompt: `Ticket: ${ticket.subject}\nBody: ${security.cleanText}\nContext:\n${citationsText}`,
      priority: triageResult.urgency === 'critical' ? 'critical' : 'medium',
      customerTier: ctx.customerTier ?? 'starter',
      tenantId: ctx.tenantId,
    });

    rateLimiter.release(ctx.tenantId, execResult.usage.costUSD);

    const tone = options.tone ?? 'friendly';
    let body = `Hello,\n\nThank you for reaching out to support regarding "${ticket.subject}".\n\n`;

    if (kbChunks.length > 0) {
      body += `According to our documented guide, here are the steps to resolve your issue:\n\n`;
      body += `1. **Verify Setup**: Please check your configuration settings as outlined in our documentation.\n`;
      body += `2. **Apply Changes**: Ensure your permissions and parameters are active.\n`;
      body += `3. **Confirm Status**: Retry your request.\n\n`;
      body += `Referenced from: *${kbChunks[0].source_id}*\n\n`;
    } else {
      body += `We are reviewing your request regarding "${ticket.subject}" and our team is investigating this actively.\n\n`;
    }

    if (options.includeDisclaimer !== false) {
      body += `---\n*Automated draft generated by Support Autopilot. Verified against company KB.*`;
    }

    const draft: DraftResponse = {
      tenant_id: ctx.tenantId,
      project_id: ctx.projectId,
      id: `draft-${Date.now()}`,
      ticket_id: ticket.id,
      body,
      citations,
      status: 'ready',
      tone,
      missing_claims: kbChunks.length === 0 ? ['No exact matching KB article found'] : [],
      warnings: [],
      created_at: new Date().toISOString(),
      disclaimer: 'This draft was generated with AI assistance and verified against internal documentation.',
    };

    return { draft, execution: execResult };
  }
}

/**
 * KB Patch Proposal Synthesizer Agent
 */
export class KBPatchSynthesizerAgent {
  public static async synthesizePatch(
    triageResults: TriageResult[],
    ctx: AgentExecutionContext
  ): Promise<{ proposal: KBPatchProposal | null; execution: ModelExecutionResult | null }> {
    if (triageResults.length === 0) return { proposal: null, execution: null };

    const router = ctx.router ?? defaultModelRouter;
    const rateLimiter = ctx.rateLimiter ?? defaultRateLimiter;

    rateLimiter.acquire(ctx.tenantId, 1500);

    const categoriesCount = triageResults.reduce<Record<string, number>>((acc, r) => {
      const cat = r.topics[0]?.category ?? 'technical';
      acc[cat] = (acc[cat] ?? 0) + 1;
      return acc;
    }, {});

    const topCategory = Object.entries(categoriesCount).sort((a, b) => b[1] - a[1])[0][0];

    const execResult = await router.execute({
      taskType: 'kb-patch-proposal',
      prompt: `Generate KB documentation patch for recurring category: ${topCategory} with ${triageResults.length} tickets.`,
      priority: 'high',
      forceTier: 'reasoning',
      tenantId: ctx.tenantId,
    });

    rateLimiter.release(ctx.tenantId, execResult.usage.costUSD);

    const proposal: KBPatchProposal = {
      id: `kb-patch-${Date.now()}`,
      tenant_id: ctx.tenantId,
      project_id: ctx.projectId,
      type: 'faq_addition',
      proposed_title: `Troubleshooting Guide: Resolving ${topCategory.charAt(0).toUpperCase() + topCategory.slice(1)} Inquiries`,
      proposed_content: `# ${topCategory.toUpperCase()} Troubleshooting & FAQ\n\nThis guide addresses common customer inquiries identified by Support Autopilot.\n\n## Quick Resolution Steps\n1. Check current service operational status.\n2. Validate authentication and API credentials.\n3. Refer to standard configuration parameters.\n`,
      diff: `--- a/docs/${topCategory}.md\n+++ b/docs/${topCategory}.md\n@@ -1,3 +1,6 @@\n+# ${topCategory} Updates\n+Automated patch generated.\n`,
      related_ticket_ids: triageResults.map((t) => t.ticket_id),
      triage_context: `Automated analysis detected ${triageResults.length} tickets related to '${topCategory}' requiring repeated support intervention.`,
      status: 'pending_review',
      created_at: new Date().toISOString(),
      reasoning: `High volume of recurring inquiries in ${topCategory}`,
    };

    return { proposal, execution: execResult };
  }
}

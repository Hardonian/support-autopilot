import type { Ticket } from '../contracts/ticket.js';
import type { DraftResponse, DraftStatus } from '../contracts/draft-response.js';
import type { KBChunk } from '../contracts/kb-source.js';
import type { TriageResult } from '../contracts/triage-result.js';
import { createCitation } from './citations.js';

export type TonePreset = 'concise' | 'friendly' | 'technical' | 'empathetic' | 'formal';

export interface DraftOptions {
  tone: TonePreset;
  includeDisclaimer?: boolean;
  maxLength?: number;
  customInstructions?: string;
}

interface DraftTemplate {
  greeting: string;
  body: string;
  closing: string;
  signature: string;
}

const TONE_TEMPLATES: Record<TonePreset, Partial<DraftTemplate>> = {
  concise: {
    greeting: 'Hi',
    closing: 'Let me know if you need more help.',
    signature: '',
  },
  friendly: {
    greeting: 'Hi there',
    closing: 'Happy to help further if needed!',
    signature: 'Best',
  },
  technical: {
    greeting: 'Hello',
    closing: 'Please provide additional technical details if the issue persists.',
    signature: 'Regards',
  },
  empathetic: {
    greeting: 'Hi',
    closing: 'I understand how frustrating this must be. I am here to help.',
    signature: 'Take care',
  },
  formal: {
    greeting: 'Dear',
    closing: 'Please do not hesitate to contact us if you require further assistance.',
    signature: 'Sincerely',
  },
};

function getGreeting(ticket: Ticket, tone: TonePreset): string {
  const template = TONE_TEMPLATES[tone];
  const name = ticket.customer_name ?? 'there';
  return `${template.greeting} ${name},`;
}

function identifyFactualClaims(text: string): string[] {
  const claims: string[] = [];
  const patterns = [
    /(?:you can|users? can|it is possible to)\s+([^.]+)/gi,
    /(?:to fix this|the solution is|you need to)\s+([^.]+)/gi,
    /(?:according to|as per)\s+([^.]+)/gi,
    /(?:the|this|that)\s+(?:feature|function|api|endpoint|setting)\s+(?:is|allows|supports|requires)\s+([^.]+)/gi,
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const claim = match[1].trim();
      if (claim.length > 10) {
        claims.push(claim);
      }
    }
  }
  
  return [...new Set(claims)];
}

export function validateCitations(
  draftBody: string,
  citations: KBChunk[]
): {
  valid: boolean;
  missingClaims: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const claims = identifyFactualClaims(draftBody);
  const missingClaims: string[] = [];
  
  for (const claim of claims) {
    const claimLower = claim.toLowerCase();
    const hasCitation = citations.some(chunk => 
      chunk.content.toLowerCase().includes(claimLower.slice(0, 50)) ||
      claimLower.includes(chunk.content.toLowerCase().slice(0, 50))
    );
    
    if (!hasCitation) {
      missingClaims.push(claim);
    }
  }
  
  const citationCount = (draftBody.match(/\[source:/g) ?? []).length;
  if (citationCount === 0 && claims.length > 0) {
    warnings.push('Response contains factual claims but no citations');
  }
  
  if (missingClaims.length > 2) {
    warnings.push(`Multiple uncited claims detected (${missingClaims.length})`);
  }
  
  return {
    valid: missingClaims.length === 0,
    missingClaims,
    warnings,
  };
}

export function draftResponse(
  ticket: Ticket,
  triageResult: TriageResult,
  kbChunks: KBChunk[],
  options: DraftOptions
): DraftResponse {
  const greeting = getGreeting(ticket, options.tone);
  const template = TONE_TEMPLATES[options.tone];
  
  let body = '';
  
  if (triageResult.topics.length > 0) {
    body += `I see you're asking about ${triageResult.topics.map(t => t.category).join(', ')}. `;
  }
  
  const relevantChunks = kbChunks.slice(0, 3);
  
  if (relevantChunks.length > 0) {
    body += '\n\nBased on our documentation:\n\n';
    
    for (const chunk of relevantChunks) {
      body += `${chunk.content}\n\n`;
    }
  }
  
  if (triageResult.missing_info.length > 0) {
    body += `\nTo help you further, could you provide: ${triageResult.missing_info.join(', ')}?`;
  }
  
  const citations = relevantChunks.map(chunk => createCitation(chunk, 0.8));
  
  const citationSection = citations.length > 0
    ? '\n\nSources:\n' + citations.map((c, i) => `[${i + 1}] ${c.excerpt.slice(0, 100)}... [source: ${c.source_id}]`).join('\n')
    : '';
  
  const closing = template.closing ?? 'Let me know if you need more help.';
  const signature = template.signature != null && template.signature !== ''
    ? `\n\n${template.signature},\nSupport Team`
    : '\n\nSupport Team';

  const fullBody = `${greeting}\n\n${body}\n\n${closing}${signature}${citationSection}`;

  const validation = validateCitations(fullBody, relevantChunks);

  let status: DraftStatus;
  let disclaimer: string | undefined;

  if (!validation.valid && options.includeDisclaimer !== false) {
    status = 'citation_failed';
    disclaimer = 'Some information in this draft could not be verified against our knowledge base. Please review before sending.';
  } else if (validation.warnings.length > 0) {
    status = 'review_required';
    disclaimer = 'This draft requires review before sending.';
  } else {
    status = 'ready';
  }

  if (options.includeDisclaimer === true && (disclaimer == null || disclaimer === '')) {
    disclaimer = 'This is an AI-generated draft. Please review before sending.';
  }
  
  return {
    tenant_id: ticket.tenant_id,
    project_id: ticket.project_id,
    id: `draft_${ticket.id}_${Date.now()}`,
    ticket_id: ticket.id,
    body: fullBody,
    citations,
    status,
    tone: options.tone,
    missing_claims: validation.missingClaims,
    warnings: validation.warnings,
    created_at: new Date().toISOString(),
    disclaimer,
  };
}

export function draftResponseNoLLM(
  ticket: Ticket,
  triageResult: TriageResult,
  kbChunks: KBChunk[],
  options: DraftOptions
): DraftResponse {
  return draftResponse(ticket, triageResult, kbChunks, options);
}

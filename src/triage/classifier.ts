import type { Ticket } from '../contracts/ticket.js';
import type { TriageResult, TriageUrgency, TriageTopic } from '../contracts/triage-result.js';

export interface TriageOptions {
  criticalKeywords?: string[];
  highPriorityKeywords?: string[];
  topicCategories?: Record<string, string[]>;
}

const DEFAULT_CRITICAL_KEYWORDS = [
  'urgent', 'critical', 'down', 'outage', 'broken', 'error',
  'failure', 'crash', 'security', 'breach', 'hack', 'leak',
  'data loss', 'corrupted', 'cannot access', 'emergency',
];

const DEFAULT_HIGH_PRIORITY_KEYWORDS = [
  'important', 'high priority', 'asap', 'blocking', 'stuck',
  'help needed', 'not working', 'bug', 'issue', 'problem',
];

const DEFAULT_TOPIC_CATEGORIES: Record<string, string[]> = {
  'billing': ['payment', 'invoice', 'billing', 'charge', 'refund', 'subscription', 'plan', 'price'],
  'technical': ['api', 'sdk', 'integration', 'code', 'error', 'bug', 'crash', 'deployment'],
  'account': ['login', 'password', 'account', 'access', 'authentication', 'signup', 'registration'],
  'feature-request': ['feature', 'request', 'enhancement', 'suggestion', 'improvement', 'add'],
  'how-to': ['how', 'guide', 'tutorial', 'documentation', 'help', 'setup', 'configure'],
};

// Cache for pre-normalized keyword arrays to avoid repeated toLowerCase()
const normalizedCache = new Map<string, string[]>();

function getNormalizedKeywords(keywords: string[]): string[] {
  const cacheKey = keywords.join('|');
  if (!normalizedCache.has(cacheKey)) {
    normalizedCache.set(cacheKey, keywords.map(k => k.toLowerCase()));
  }
  return normalizedCache.get(cacheKey)!;
}

export function classifyUrgency(
  ticket: Ticket,
  options: TriageOptions = {}
): TriageUrgency {
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  
  const criticalKeywords = options.criticalKeywords ?? DEFAULT_CRITICAL_KEYWORDS;
  const highPriorityKeywords = options.highPriorityKeywords ?? DEFAULT_HIGH_PRIORITY_KEYWORDS;

  // Use cached normalized keywords for better performance
  const normalizedCritical = getNormalizedKeywords(criticalKeywords);
  const normalizedHigh = getNormalizedKeywords(highPriorityKeywords);

  if (normalizedCritical.some(kw => text.includes(kw))) {
    return 'critical';
  }

  if (normalizedHigh.some(kw => text.includes(kw))) {
    return 'high';
  }

  if (ticket.priority === 'urgent' || ticket.priority === 'high') {
    return 'high';
  }

  return 'medium';
}

export function classifyTopics(
  ticket: Ticket,
  options: TriageOptions = {}
): TriageTopic[] {
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  const categories = options.topicCategories ?? DEFAULT_TOPIC_CATEGORIES;
  
  const topics: TriageTopic[] = [];

  for (const [category, keywords] of Object.entries(categories)) {
    // Use cached normalized keywords
    const normalizedKeywords = getNormalizedKeywords(keywords);
    const matches: string[] = [];
    
    for (let i = 0; i < normalizedKeywords.length; i++) {
      if (text.includes(normalizedKeywords[i])) {
        matches.push(keywords[i]); // Use original case for output
      }
    }
    
    if (matches.length > 0) {
      topics.push({
        category,
        confidence: Math.min(matches.length / 2, 1),
        keywords: matches,
      });
    }
  }

  topics.sort((a, b) => b.confidence - a.confidence);
  
  return topics.slice(0, 3);
}

export function extractMissingInfo(ticket: Ticket): string[] {
  const missing: string[] = [];
  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();

  const checkPatterns: Record<string, RegExp[]> = {
    'account_id': [/account\s*id/i, /user\s*id/i, /org\s*id/i],
    'error_message': [/error[:\s]/i, /exception/i, /stack\s*trace/i],
    'steps_to_reproduce': [/step/i, /reproduce/i, /how\s*to/i],
    'environment': [/browser/i, /version/i, /os/i, /platform/i, /environment/i],
    'expected_behavior': [/expected/i, /should/i, /supposed\s*to/i],
    'actual_behavior': [/actually/i, /instead/i, /but\s*got/i],
  };

  for (const [info, patterns] of Object.entries(checkPatterns)) {
    const found = patterns.some(pattern => pattern.test(text));
    if (!found) {
      missing.push(info);
    }
  }

  return missing;
}

export function suggestTags(
  ticket: Ticket,
  topics: TriageTopic[]
): string[] {
  const tags = new Set(ticket.tags);
  
  for (const topic of topics) {
    tags.add(topic.category);
    
    if (topic.confidence > 0.7) {
      tags.add(`high-confidence-${topic.category}`);
    }
  }

  const text = `${ticket.subject} ${ticket.body}`.toLowerCase();
  
  if (/bug|error|crash|exception/.test(text)) {
    tags.add('bug-report');
  }
  
  if (/feature|enhancement|request|suggestion/.test(text)) {
    tags.add('feature-request');
  }
  
  if (/question|how|what|help/.test(text)) {
    tags.add('question');
  }

  return [...tags];
}

export function triageTicket(
  ticket: Ticket,
  options: TriageOptions = {}
): TriageResult {
  const urgency = classifyUrgency(ticket, options);
  const topics = classifyTopics(ticket, options);
  const missingInfo = extractMissingInfo(ticket);
  const suggestedTags = suggestTags(ticket, topics);

  const suggestedPriority: TriageResult['suggested_priority'] = 
    urgency === 'critical' ? 'urgent' :
    urgency === 'high' ? 'high' :
    urgency === 'medium' ? 'medium' : 'low';

  const requiresHumanReview = 
    urgency === 'critical' || 
    topics.some(t => t.category === 'billing' && t.confidence > 0.8);

  const requiresKbUpdate = 
    missingInfo.length > 0 && 
    topics.some(t => t.confidence > 0.5);

  return {
    tenant_id: ticket.tenant_id,
    project_id: ticket.project_id,
    ticket_id: ticket.id,
    urgency,
    topics,
    missing_info: missingInfo,
    suggested_priority: suggestedPriority,
    suggested_tags: suggestedTags,
    requires_kb_update: requiresKbUpdate,
    requires_human_review: requiresHumanReview,
    reasoning: `Classified as ${urgency} urgency based on keywords. Topics: ${topics.map(t => t.category).join(', ') || 'none detected'}. Missing: ${missingInfo.join(', ') || 'none'}.`,
    processed_at: new Date().toISOString(),
  };
}

import type { Ticket } from '../contracts/ticket.js';
import type { TriageResult } from '../contracts/triage-result.js';
import { triageTicket, type TriageOptions } from './classifier.js';

export interface BatchTriageResult {
  results: TriageResult[];
  stats: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    needsHumanReview: number;
    needsKbUpdate: number;
  };
}

// Default chunk size for processing large batches
const DEFAULT_CHUNK_SIZE = 100;

// Process tickets in chunks to avoid blocking event loop
function* chunkArray<T>(arr: T[], chunkSize: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += chunkSize) {
    yield arr.slice(i, i + chunkSize);
  }
}

export function triageBatch(
  tickets: Ticket[],
  options: TriageOptions = {},
  chunkSize: number = DEFAULT_CHUNK_SIZE
): BatchTriageResult {
  // Process in chunks for better performance with large batches
  const results: TriageResult[] = [];
  
  for (const chunk of chunkArray(tickets, chunkSize)) {
    const chunkResults = chunk.map(ticket => triageTicket(ticket, options));
    results.push(...chunkResults);
  }
  
  // Calculate stats in a single pass for efficiency
  let critical = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let needsHumanReview = 0;
  let needsKbUpdate = 0;

  for (const r of results) {
    if (r.urgency === 'critical') critical++;
    else if (r.urgency === 'high') high++;
    else if (r.urgency === 'medium') medium++;
    else low++;
    
    if (r.requires_human_review) needsHumanReview++;
    if (r.requires_kb_update) needsKbUpdate++;
  }

  const stats = {
    total: results.length,
    critical,
    high,
    medium,
    low,
    needsHumanReview,
    needsKbUpdate,
  };

  return { results, stats };
}

export function filterTicketsNeedingAttention(
  triageResults: TriageResult[]
): TriageResult[] {
  return triageResults.filter(
    r => r.urgency === 'critical' || 
         r.urgency === 'high' || 
         r.requires_human_review
  );
}

export function groupByUrgency(
  triageResults: TriageResult[]
): Record<string, TriageResult[]> {
  return triageResults.reduce((groups, result) => {
    const key = result.urgency;
    groups[key] ??= [];
    groups[key].push(result);
    return groups;
  }, {} as Record<string, TriageResult[]>);
}

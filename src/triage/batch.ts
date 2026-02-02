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

export function triageBatch(
  tickets: Ticket[],
  options: TriageOptions = {}
): BatchTriageResult {
  const results = tickets.map(ticket => triageTicket(ticket, options));
  
  const stats = {
    total: results.length,
    critical: results.filter(r => r.urgency === 'critical').length,
    high: results.filter(r => r.urgency === 'high').length,
    medium: results.filter(r => r.urgency === 'medium').length,
    low: results.filter(r => r.urgency === 'low').length,
    needsHumanReview: results.filter(r => r.requires_human_review).length,
    needsKbUpdate: results.filter(r => r.requires_kb_update).length,
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
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(result);
    return groups;
  }, {} as Record<string, TriageResult[]>);
}

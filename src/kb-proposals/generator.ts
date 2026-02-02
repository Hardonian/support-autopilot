import type { TriageResult } from '../contracts/triage-result.js';
import type { KBPatchProposal, KBPatchType } from '../contracts/kb-patch.js';
import type { Ticket } from '../contracts/ticket.js';

export interface KBProposalOptions {
  tenantId: string;
  projectId: string;
  relatedTickets?: Ticket[];
}

function generateFaqContent(triageResults: TriageResult[]): string {
  const topics = new Map<string, number>();
  
  for (const result of triageResults) {
    for (const topic of result.topics) {
      const count = topics.get(topic.category) ?? 0;
      topics.set(topic.category, count + 1);
    }
  }
  
  const sortedTopics = [...topics.entries()].sort((a, b) => b[1] - a[1]);
  const topTopic = sortedTopics[0];
  
  if (!topTopic) {
    return '';
  }
  
  return `# Frequently Asked Questions: ${topTopic[0]}

Based on ${topTopic[1]} recent tickets, here are common questions about ${topTopic[0]}:

${sortedTopics.slice(0, 5).map(([topic, count]) => `- **${topic}**: ${count} tickets`).join('\n')}

## Common Issues

1. [Describe common issue and solution]
2. [Describe another common issue and solution]

## Need More Help?

If your question is not answered here, please submit a ticket with details about:
- What you are trying to accomplish
- What you have already tried
- Any error messages you received
`;
}

function generateClarificationContent(
  triageResult: TriageResult,
  tickets: Ticket[]
): string {
  const relatedTicket = tickets.find(t => t.id === triageResult.ticket_id);
  
  if (!relatedTicket) {
    return '';
  }
  
  return `## Additional Context

The following information would help us provide better support for similar tickets:

${triageResult.missing_info.map(info => `- **${info}**: [description of what is needed]`).join('\n')}

### Example from recent ticket

**Subject**: ${relatedTicket.subject}
**Question**: [What was the user trying to achieve?]
**Missing Info**: ${triageResult.missing_info.join(', ')}
**Recommended**: Ask for the missing information before providing solutions.
`;
}

function determinePatchType(
  triageResults: TriageResult[],
  _options: KBProposalOptions
): KBPatchType {
  if (triageResults.length > 5 && 
      triageResults.every(r => r.topics.length > 0 && r.topics[0].category === triageResults[0].topics[0]?.category)) {
    return 'faq_addition';
  }
  
  if (triageResults.some(r => r.missing_info.length > 0)) {
    return 'clarification';
  }
  
  return 'section_update';
}

export function proposeKBPatch(
  triageResults: TriageResult[],
  options: KBProposalOptions
): KBPatchProposal | null {
  if (triageResults.length === 0) {
    return null;
  }
  
  const type = determinePatchType(triageResults, options);
  const relatedTicketIds = triageResults.map(r => r.ticket_id);
  
  let proposedTitle: string;
  let proposedContent: string;
  
  switch (type) {
    case 'faq_addition': {
      proposedTitle = `FAQ: Common ${triageResults[0].topics[0]?.category ?? 'Support'} Questions`;
      proposedContent = generateFaqContent(triageResults);
      break;
    }
    
    case 'clarification': {
      const resultWithMissing = triageResults.find(r => r.missing_info.length > 0);
      proposedTitle = `Documentation Update: Required Information for ${resultWithMissing?.topics[0]?.category ?? 'Support'} Tickets`;
      proposedContent = resultWithMissing 
        ? generateClarificationContent(resultWithMissing, options.relatedTickets ?? [])
        : '';
      break;
    }
    
    case 'section_update': {
      const commonTopic = triageResults[0].topics[0]?.category ?? 'General';
      proposedTitle = `Update: ${commonTopic} Documentation`;
      proposedContent = `## Recommended Updates

Based on ${triageResults.length} recent tickets, consider adding:

${triageResults.flatMap(r => r.topics.map(t => `- Information about ${t.category}`)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5).join('\n')}

## Missing Information Patterns

Tickets often lack:
${[...new Set(triageResults.flatMap(r => r.missing_info))].slice(0, 5).map(info => `- ${info}`).join('\n')}
`;
      break;
    }
    
    case 'new_doc': {
      proposedTitle = 'New Documentation: [Topic]';
      proposedContent = '## Overview\n\n[Describe what this documentation covers]\n\n## Common Questions\n\n[List questions based on ticket analysis]\n';
      break;
    }
    
    default: {
      proposedTitle = 'Documentation Update';
      proposedContent = '';
    }
  }
  
  return {
    tenant_id: options.tenantId,
    project_id: options.projectId,
    id: `kbpatch_${Date.now()}`,
    type,
    proposed_title: proposedTitle,
    proposed_content: proposedContent,
    related_ticket_ids: relatedTicketIds,
    triage_context: `Generated from ${triageResults.length} triage results. Topics: ${[...new Set(triageResults.flatMap(r => r.topics.map(t => t.category)))].join(', ')}`,
    status: 'pending_review',
    created_at: new Date().toISOString(),
    reasoning: `Proposed ${type} based on ${triageResults.length} tickets with common patterns`,
  };
}

export function batchProposePatches(
  triageResults: TriageResult[],
  options: KBProposalOptions,
  groupByTopic: boolean = true
): KBPatchProposal[] {
  if (!groupByTopic) {
    const single = proposeKBPatch(triageResults, options);
    return single ? [single] : [];
  }
  
  const grouped = new Map<string, TriageResult[]>();
  
  for (const result of triageResults) {
    const key = result.topics[0]?.category ?? 'general';
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(result);
  }
  
  const proposals: KBPatchProposal[] = [];
  
  for (const [, groupResults] of grouped) {
    const proposal = proposeKBPatch(groupResults, options);
    if (proposal) {
      proposals.push(proposal);
    }
  }
  
  return proposals;
}

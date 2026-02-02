import type { KBChunk } from '../contracts/kb-source.js';
import type { Citation } from '../contracts/draft-response.js';

export function createCitation(chunk: KBChunk, relevanceScore: number): Citation {
  const excerpt = chunk.content.length > 200 
    ? chunk.content.slice(0, 200) + '...'
    : chunk.content;
    
  return {
    source_id: chunk.source_id,
    chunk_id: chunk.id,
    excerpt,
    relevance_score: relevanceScore,
  };
}

export function formatCitations(citations: Citation[]): string {
  if (citations.length === 0) {
    return '';
  }

  const lines = citations.map((c, i) => {
    return `[${i + 1}] ${c.excerpt} (source: ${c.source_id})`;
  });

  return '\n\nSources:\n' + lines.join('\n');
}

export function extractCitedChunks(responseBody: string): string[] {
  const chunkRefs: string[] = [];
  const regex = /\[source:\s*([^\]]+)\]/gi;
  let match;
  
  while ((match = regex.exec(responseBody)) !== null) {
    chunkRefs.push(match[1].trim());
  }
  
  return [...new Set(chunkRefs)];
}

export function hasCitationForClaim(
  responseBody: string,
  claimKeywords: string[]
): boolean {
  const lowerBody = responseBody.toLowerCase();
  
  for (const keyword of claimKeywords) {
    if (lowerBody.includes(keyword.toLowerCase())) {
      const sourcePattern = new RegExp(`\\[source:[^\\]]*${keyword}[^\\]]*\\]`, 'i');
      const hasCitation = sourcePattern.test(responseBody);
      
      if (!hasCitation) {
        return false;
      }
    }
  }
  
  return true;
}

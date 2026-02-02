import type { KBChunk, KBSource } from '../contracts/kb-source.js';

export interface RetrievalResult {
  chunk: KBChunk;
  score: number;
}

export interface RetrievalIndex {
  tenantId: string;
  projectId: string;
  sources: Map<string, KBSource>;
  chunks: KBChunk[];
  termIndex: Map<string, Set<number>>;
}

export function buildIndex(
  tenantId: string,
  projectId: string,
  sources: KBSource[]
): RetrievalIndex {
  const sourceMap = new Map<string, KBSource>();
  const chunks: KBChunk[] = [];
  const termIndex = new Map<string, Set<number>>();

  for (const source of sources) {
    sourceMap.set(source.id, source);
    
    for (const chunk of source.chunks) {
      const chunkIndex = chunks.length;
      chunks.push(chunk);

      const terms = extractTerms(chunk.content);
      for (const term of terms) {
        if (!termIndex.has(term)) {
          termIndex.set(term, new Set());
        }
        termIndex.get(term)!.add(chunkIndex);
      }
    }
  }

  return {
    tenantId,
    projectId,
    sources: sourceMap,
    chunks,
    termIndex,
  };
}

function extractTerms(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = normalized.match(/\b[a-z]+\b/g) ?? [];
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'could', 'should', 'may', 'might', 'must', 'shall',
    'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'and', 'but', 'or', 'yet', 'so',
    'if', 'because', 'although', 'though', 'while', 'where',
    'when', 'that', 'which', 'who', 'whom', 'whose', 'what',
    'this', 'these', 'those', 'i', 'you', 'he', 'she', 'it',
    'we', 'they', 'me', 'him', 'her', 'us', 'them',
  ]);

  return [...new Set(words.filter(w => !stopWords.has(w) && w.length > 2))];
}

export function search(
  index: RetrievalIndex,
  query: string,
  options: {
    topK?: number;
    minScore?: number;
  } = {}
): RetrievalResult[] {
  const { topK = 5, minScore = 0.1 } = options;
  
  const queryTerms = extractTerms(query);
  const chunkScores = new Map<number, number>();

  for (const term of queryTerms) {
    const matchingChunks = index.termIndex.get(term);
    if (!matchingChunks) continue;

    for (const chunkIdx of matchingChunks) {
      const currentScore = chunkScores.get(chunkIdx) ?? 0;
      chunkScores.set(chunkIdx, currentScore + 1);
    }
  }

  const results: RetrievalResult[] = [];
  
  for (const [chunkIdx, score] of chunkScores) {
    const normalizedScore = score / queryTerms.length;
    
    if (normalizedScore >= minScore) {
      results.push({
        chunk: index.chunks[chunkIdx],
        score: normalizedScore,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  
  return results.slice(0, topK);
}

export function retrieveForTicket(
  index: RetrievalIndex,
  ticketSubject: string,
  ticketBody: string,
  options?: {
    topK?: number;
    minScore?: number;
  }
): RetrievalResult[] {
  const query = `${ticketSubject} ${ticketBody}`.slice(0, 500);
  return search(index, query, options);
}

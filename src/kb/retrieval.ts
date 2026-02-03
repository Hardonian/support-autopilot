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

// Cache for term extraction to avoid re-processing same texts
const termCache = new Map<string, string[]>();
const MAX_CACHE_SIZE = 1000;

// Pre-defined stop words Set (created once, not per call)
const STOP_WORDS = new Set([
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

// LRU cache management
function getCachedTerms(text: string): string[] | undefined {
  const cached = termCache.get(text);
  if (cached) {
    // Move to end (most recently used)
    termCache.delete(text);
    termCache.set(text, cached);
  }
  return cached;
}

function setCachedTerms(text: string, terms: string[]): void {
  if (termCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first in Map)
    const firstKey = termCache.keys().next().value;
    if (firstKey !== undefined && typeof firstKey === 'string') {
      termCache.delete(firstKey);
    }
  }
  termCache.set(text, terms);
}

export function buildIndex(
  tenantId: string,
  projectId: string,
  sources: KBSource[]
): RetrievalIndex {
  const sourceMap = new Map<string, KBSource>();
  const chunks: KBChunk[] = [];
  const termIndex = new Map<string, Set<number>>();

  // Batch process sources for better cache locality
  const allContents: string[] = [];
  const chunkIndices: number[] = [];

  for (const source of sources) {
    sourceMap.set(source.id, source);
    
    for (const chunk of source.chunks) {
      const chunkIndex = chunks.length;
      chunks.push(chunk);
      allContents.push(chunk.content);
      chunkIndices.push(chunkIndex);
    }
  }

  // Process all terms with caching
  for (let i = 0; i < allContents.length; i++) {
    const content = allContents[i];
    const chunkIndex = chunkIndices[i];
    
    const terms = extractTerms(content);
    for (const term of terms) {
      if (!termIndex.has(term)) {
        termIndex.set(term, new Set());
      }
      termIndex.get(term)!.add(chunkIndex);
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
  // Check cache first
  const cached = getCachedTerms(text);
  if (cached) {
    return cached;
  }

  const normalized = text.toLowerCase();
  const words = normalized.match(/\b[a-z]+\b/g) ?? [];
  const terms = [...new Set(words.filter(w => !STOP_WORDS.has(w) && w.length > 2))];
  
  // Cache result
  setCachedTerms(text, terms);
  
  return terms;
}

// Clear cache for testing
export function clearTermCache(): void {
  termCache.clear();
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

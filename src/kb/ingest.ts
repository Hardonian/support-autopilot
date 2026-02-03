import { readFile } from 'fs/promises';
import { glob } from 'glob';
import { basename, extname } from 'path';
import type { KBSource, KBSourceType } from '../contracts/kb-source.js';
import { chunkMarkdown, chunkText, type ChunkingOptions } from './chunking.js';

export interface IngestOptions {
  tenantId: string;
  projectId: string;
  chunking?: ChunkingOptions;
  includePatterns?: string[];
  excludePatterns?: string[];
  concurrency?: number;
}

const SUPPORTED_EXTENSIONS: Record<string, KBSourceType> = {
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.html': 'html',
  '.htm': 'html',
  '.txt': 'text',
  '.json': 'json',
};

// Default concurrency limit for parallel file processing
const DEFAULT_CONCURRENCY = 10;

function detectType(filePath: string): KBSourceType {
  const ext = extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] ?? 'text';
}

function extractTitle(content: string, filePath: string): string {
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  return basename(filePath, extname(filePath));
}

export async function ingestFile(
  filePath: string,
  options: IngestOptions
): Promise<KBSource> {
  const content = await readFile(filePath, 'utf-8');
  const type = detectType(filePath);
  const title = extractTitle(content, filePath);
  const id = `kb_${options.tenantId}_${options.projectId}_${Buffer.from(filePath).toString('base64url')}`;

  let chunks;
  if (type === 'markdown' || type === 'mdx') {
    chunks = chunkMarkdown(content, id, options.chunking);
  } else {
    chunks = chunkText(content, id, options.chunking);
  }

  return {
    tenant_id: options.tenantId,
    project_id: options.projectId,
    id,
    type,
    title,
    content,
    file_path: filePath,
    chunks,
    metadata: {
      original_path: filePath,
      file_size: content.length,
      chunk_count: chunks.length,
    },
    ingested_at: new Date().toISOString(),
  };
}

// Process files in batches with controlled concurrency
async function processBatch<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(item => processor(item))
    );
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error('Batch processing error:', result.reason);
      }
    }
  }
  
  return results;
}

export async function ingestDirectory(
  dirPath: string,
  options: IngestOptions
): Promise<KBSource[]> {
  const includePatterns = options.includePatterns ?? ['**/*.{md,mdx,html,txt,json}'];
  const excludePatterns = options.excludePatterns ?? [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
  ];
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // Batch glob operations - run all patterns in parallel
  const globPromises = includePatterns.map(pattern =>
    glob(pattern, {
      cwd: dirPath,
      absolute: true,
      ignore: excludePatterns,
    })
  );

  const globResults = await Promise.all(globPromises);
  const files = [...new Set(globResults.flat())];

  // Process files in parallel batches with controlled concurrency
  const sources = await processBatch(
    files,
    async (file) => ingestFile(file, options),
    concurrency
  );

  return sources;
}

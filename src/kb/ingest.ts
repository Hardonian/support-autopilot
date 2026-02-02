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
}

const SUPPORTED_EXTENSIONS: Record<string, KBSourceType> = {
  '.md': 'markdown',
  '.mdx': 'mdx',
  '.html': 'html',
  '.htm': 'html',
  '.txt': 'text',
  '.json': 'json',
};

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

  const files: string[] = [];
  for (const pattern of includePatterns) {
    const matches = await glob(pattern, {
      cwd: dirPath,
      absolute: true,
      ignore: excludePatterns,
    });
    files.push(...matches);
  }

  const uniqueFiles = [...new Set(files)];
  const sources: KBSource[] = [];

  for (const file of uniqueFiles) {
    try {
      const source = await ingestFile(file, options);
      sources.push(source);
    } catch (error) {
      console.error(`Failed to ingest ${file}:`, error);
    }
  }

  return sources;
}

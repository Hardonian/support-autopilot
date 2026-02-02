import type { KBChunk } from '../contracts/kb-source.js';

export interface ChunkingOptions {
  maxChunkSize: number;
  minChunkSize: number;
  overlap: number;
}

export const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  maxChunkSize: 1000,
  minChunkSize: 100,
  overlap: 50,
};

interface HeadingInfo {
  level: number;
  text: string;
  line: number;
}

export function chunkMarkdown(
  content: string,
  sourceId: string,
  options: ChunkingOptions = DEFAULT_CHUNKING_OPTIONS
): KBChunk[] {
  if (!content || content.trim().length === 0) {
    return [];
  }
  
  const lines = content.split('\n');
  const chunks: KBChunk[] = [];
  let currentChunk: string[] = [];
  let currentStartLine = 0;
  const headingPath: string[] = [];
  const headingStack: HeadingInfo[] = [];

  const flushChunk = (): void => {
    if (currentChunk.length === 0) return;
    
    const chunkText = currentChunk.join('\n').trim();
    if (chunkText.length === 0) return;
    if (chunkText.length < options.minChunkSize && chunks.length > 0) {
      // Merge with previous chunk if too small
      if (chunks.length > 0) {
        const prevChunk = chunks[chunks.length - 1];
        prevChunk.content += '\n' + chunkText;
        prevChunk.end_line = currentStartLine + currentChunk.length;
        prevChunk.metadata.char_count = prevChunk.content.length;
        prevChunk.metadata.word_count = prevChunk.content.split(/\s+/).length;
      }
      currentChunk = [];
      return;
    }

    chunks.push({
      id: `${sourceId}_chunk_${chunks.length}`,
      content: chunkText,
      source_id: sourceId,
      start_line: currentStartLine + 1,
      end_line: currentStartLine + currentChunk.length,
      heading_path: [...headingPath],
      metadata: {
        char_count: chunkText.length,
        word_count: chunkText.split(/\s+/).length,
      },
    });

    const overlapLines = Math.min(options.overlap, currentChunk.length);
    currentChunk = currentChunk.slice(-overlapLines);
    currentStartLine = currentStartLine + currentChunk.length - overlapLines;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      if (currentChunk.length > 0) {
        flushChunk();
      }

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
        headingPath.pop();
      }

      headingStack.push({ level, text, line: i });
      headingPath.push(text);
      
      currentChunk.push(line);
      if (currentStartLine === 0 && chunks.length === 0) {
        currentStartLine = i;
      }
    } else {
      if (currentChunk.length === 0) {
        currentStartLine = i;
      }
      currentChunk.push(line);

      const currentText = currentChunk.join('\n');
      if (currentText.length >= options.maxChunkSize) {
        flushChunk();
      }
    }
  }

  flushChunk();

  return chunks;
}

export function chunkText(
  content: string,
  sourceId: string,
  options: ChunkingOptions = DEFAULT_CHUNKING_OPTIONS
): KBChunk[] {
  const sentences = content.match(/[^.!?]+[.!?]+/g) ?? [content];
  const chunks: KBChunk[] = [];
  let currentChunk: string[] = [];
  let currentLength = 0;
  let currentStartIdx = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    
    if (currentLength + sentence.length > options.maxChunkSize && currentChunk.length > 0) {
      const chunkText = currentChunk.join(' ').trim();
      chunks.push({
        id: `${sourceId}_chunk_${chunks.length}`,
        content: chunkText,
        source_id: sourceId,
        start_line: currentStartIdx,
        end_line: i,
        heading_path: [],
        metadata: {
          char_count: chunkText.length,
          word_count: chunkText.split(/\s+/).length,
        },
      });

      const overlapSentences = Math.min(
        Math.ceil(options.overlap / 50),
        currentChunk.length
      );
      currentChunk = currentChunk.slice(-overlapSentences);
      currentLength = currentChunk.join(' ').length;
      currentStartIdx = i - overlapSentences;
    }

    currentChunk.push(sentence);
    currentLength += sentence.length;
  }

  if (currentChunk.length > 0) {
    const chunkText = currentChunk.join(' ').trim();
    if (chunkText.length >= options.minChunkSize || chunks.length === 0) {
      chunks.push({
        id: `${sourceId}_chunk_${chunks.length}`,
        content: chunkText,
        source_id: sourceId,
        start_line: currentStartIdx,
        end_line: sentences.length,
        heading_path: [],
        metadata: {
          char_count: chunkText.length,
          word_count: chunkText.split(/\s+/).length,
        },
      });
    }
  }

  return chunks;
}

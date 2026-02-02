import { describe, it, expect } from 'vitest';
import { chunkMarkdown, chunkText, DEFAULT_CHUNKING_OPTIONS } from '../kb/chunking.js';

describe('chunkMarkdown', () => {
  it('should chunk by headings', () => {
    const content = `# Title
Some intro text here that is long enough to not be merged with the next chunk because it exceeds the minimum chunk size requirement of one hundred characters minimum.

## Section 1
Content for section 1 that is also long enough to stand alone as its own chunk without being merged into the previous chunk content.
More content here to ensure this section is sufficiently long.

## Section 2
Content for section 2 that meets the minimum length requirements and will not be merged with any other chunk in the output.
`;

    const chunks = chunkMarkdown(content, 'test', DEFAULT_CHUNKING_OPTIONS);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].heading_path).toContain('Title');

    const section1Chunk = chunks.find(c => c.heading_path.includes('Section 1'));
    expect(section1Chunk).toBeDefined();
  });
  
  it('should respect max chunk size', () => {
    const longContent = 'word '.repeat(1000);
    const chunks = chunkMarkdown(longContent, 'test', {
      ...DEFAULT_CHUNKING_OPTIONS,
      maxChunkSize: 500,
    });
    
    expect(chunks.length).toBeGreaterThan(1);
  });
  
  it('should handle empty content', () => {
    const chunks = chunkMarkdown('', 'test');
    expect(chunks).toHaveLength(0);
  });
  
  it('should preserve heading hierarchy', () => {
    const content = `# Main
Introduction content that is sufficiently long to meet the minimum chunk size requirement and not be merged with subsequent chunks in the output.

## Sub 1
Subsection content that is long enough to stand on its own without triggering the merge behavior for small chunks.

### Deep 1
Deep section content here with enough text to exceed the minimum chunk size threshold of one hundred characters for proper chunking.

## Sub 2
More content here that is also long enough to be its own chunk and not merged with previous sections.
`;

    const chunks = chunkMarkdown(content, 'test');
    const deepChunk = chunks.find(c => c.heading_path.includes('Deep 1'));

    expect(deepChunk?.heading_path).toContain('Main');
    expect(deepChunk?.heading_path).toContain('Sub 1');
    expect(deepChunk?.heading_path).toContain('Deep 1');
  });
});

describe('chunkText', () => {
  it('should chunk by sentences', () => {
    const content = 'First sentence. Second sentence. Third sentence.';
    const chunks = chunkText(content, 'test', {
      ...DEFAULT_CHUNKING_OPTIONS,
      maxChunkSize: 50,
    });
    
    expect(chunks.length).toBeGreaterThan(0);
  });
  
  it('should handle single sentence', () => {
    const content = 'This is a single sentence.';
    const chunks = chunkText(content, 'test');
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(content);
  });
});

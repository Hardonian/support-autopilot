import { describe, it, expect } from 'vitest';
import { buildIndex, search, retrieveForTicket } from '../kb/retrieval.js';
import type { KBSource, KBChunk } from '../contracts/kb-source.js';

describe('buildIndex', () => {
  it('should build index from sources', () => {
    const source: KBSource = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'kb1',
      type: 'markdown',
      title: 'Test',
      content: 'This is test content about authentication.',
      chunks: [
        {
          id: 'chunk1',
          content: 'This is test content about authentication.',
          source_id: 'kb1',
          start_line: 0,
          end_line: 1,
          heading_path: [],
          metadata: {},
        },
      ],
      ingested_at: new Date().toISOString(),
      metadata: {},
    };
    
    const index = buildIndex('t1', 'p1', [source]);
    
    expect(index.tenantId).toBe('t1');
    expect(index.projectId).toBe('p1');
    expect(index.chunks).toHaveLength(1);
    expect(index.termIndex.has('authentication')).toBe(true);
  });
  
  it('should handle empty sources', () => {
    const index = buildIndex('t1', 'p1', []);
    
    expect(index.chunks).toHaveLength(0);
    expect(index.termIndex.size).toBe(0);
  });
  
  it('should extract multiple terms from chunks', () => {
    const source: KBSource = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'kb1',
      type: 'markdown',
      title: 'Test',
      content: 'API authentication using tokens.',
      chunks: [
        {
          id: 'chunk1',
          content: 'API authentication using tokens.',
          source_id: 'kb1',
          start_line: 0,
          end_line: 1,
          heading_path: [],
          metadata: {},
        },
      ],
      ingested_at: new Date().toISOString(),
      metadata: {},
    };
    
    const index = buildIndex('t1', 'p1', [source]);
    
    expect(index.termIndex.has('api')).toBe(true);
    expect(index.termIndex.has('authentication')).toBe(true);
    expect(index.termIndex.has('tokens')).toBe(true);
  });
});

describe('search', () => {
  it('should find relevant chunks', () => {
    const chunks: KBChunk[] = [
      {
        id: 'c1',
        content: 'How to authenticate with API keys',
        source_id: 'kb1',
        start_line: 0,
        end_line: 1,
        heading_path: [],
        metadata: {},
      },
      {
        id: 'c2',
        content: 'Pricing information for plans',
        source_id: 'kb2',
        start_line: 0,
        end_line: 1,
        heading_path: [],
        metadata: {},
      },
    ];
    
    const source: KBSource = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'kb1',
      type: 'markdown',
      title: 'Auth',
      content: 'How to authenticate with API keys',
      chunks: [chunks[0]],
      ingested_at: new Date().toISOString(),
      metadata: {},
    };
    
    const source2: KBSource = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'kb2',
      type: 'markdown',
      title: 'Pricing',
      content: 'Pricing information for plans',
      chunks: [chunks[1]],
      ingested_at: new Date().toISOString(),
      metadata: {},
    };
    
    const index = buildIndex('t1', 'p1', [source, source2]);
    const results = search(index, 'API authentication', { topK: 2 });
    
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.content).toContain('authenticate');
  });
  
  it('should respect topK limit', () => {
    const chunks: KBChunk[] = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      content: `Content about topic ${i}`,
      source_id: 'kb1',
      start_line: i,
      end_line: i + 1,
      heading_path: [],
      metadata: {},
    }));
    
    const source: KBSource = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'kb1',
      type: 'markdown',
      title: 'Test',
      content: chunks.map(c => c.content).join(' '),
      chunks,
      ingested_at: new Date().toISOString(),
      metadata: {},
    };
    
    const index = buildIndex('t1', 'p1', [source]);
    const results = search(index, 'topic', { topK: 3 });
    
    expect(results.length).toBeLessThanOrEqual(3);
  });
  
  it('should return empty results for no matches', () => {
    const chunks: KBChunk[] = [
      {
        id: 'c1',
        content: 'Content about authentication',
        source_id: 'kb1',
        start_line: 0,
        end_line: 1,
        heading_path: [],
        metadata: {},
      },
    ];
    
    const source: KBSource = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'kb1',
      type: 'markdown',
      title: 'Test',
      content: 'Content about authentication',
      chunks,
      ingested_at: new Date().toISOString(),
      metadata: {},
    };
    
    const index = buildIndex('t1', 'p1', [source]);
    const results = search(index, 'xyznonexistentquery');
    
    expect(results).toHaveLength(0);
  });
});

describe('retrieveForTicket', () => {
  it('should retrieve relevant chunks for ticket', () => {
    const chunks: KBChunk[] = [
      {
        id: 'c1',
        content: 'API authentication requires a valid token',
        source_id: 'kb1',
        start_line: 0,
        end_line: 1,
        heading_path: [],
        metadata: {},
      },
    ];
    
    const source: KBSource = {
      tenant_id: 't1',
      project_id: 'p1',
      id: 'kb1',
      type: 'markdown',
      title: 'API',
      content: 'API authentication requires a valid token',
      chunks,
      ingested_at: new Date().toISOString(),
      metadata: {},
    };
    
    const index = buildIndex('t1', 'p1', [source]);
    const results = retrieveForTicket(index, 'API key not working', 'I get 401 errors');
    
    expect(results.length).toBeGreaterThan(0);
  });
});

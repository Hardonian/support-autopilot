import { describe, expect, it } from 'vitest';
import { canonicalizeForHash, serializeDeterministic, stableHash, withCanonicalHash } from './deterministic.js';

describe('deterministic utilities', () => {
  it('orders object keys deterministically', () => {
    const value = { b: 1, a: { d: 2, c: 3 } };
    expect(canonicalizeForHash(value)).toEqual({ a: { c: 3, d: 2 }, b: 1 });
  });

  it('serializes deterministically', () => {
    const value = { b: 1, a: 2 };
    expect(serializeDeterministic(value)).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });

  it('creates stable hash and attaches metadata', () => {
    const value = { b: 1, a: 2 };
    const hash = stableHash(value);
    const withHash = withCanonicalHash(value);
    expect(withHash.hash.canonical_json_hash).toBe(hash);
  });
});

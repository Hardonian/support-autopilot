import { createHash } from 'crypto';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

// Cache for hash computations to avoid re-processing identical inputs
const hashCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

// LRU cache management for hashes
function getCachedHash(key: string): string | undefined {
  const cached = hashCache.get(key);
  if (cached !== undefined) {
    // Move to end (most recently used)
    hashCache.delete(key);
    hashCache.set(key, cached);
  }
  return cached;
}

function setCachedHash(key: string, hash: string): void {
  if (hashCache.size >= MAX_CACHE_SIZE) {
    // Remove oldest entry (first in Map)
    const firstKey = hashCache.keys().next().value;
    if (firstKey !== undefined && typeof firstKey === 'string') {
      hashCache.delete(firstKey);
    }
  }
  hashCache.set(key, hash);
}

export function canonicalizeForHash(value: unknown): JsonValue {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(item => canonicalizeForHash(item));
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, canonicalizeForHash(entryValue)] as const);

    return Object.fromEntries(entries) as JsonValue;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  // Handle edge cases that shouldn't occur in practice
  if (value === undefined) {
    return null;
  }

  // For any other type, use JSON.stringify to get a string representation
  return JSON.stringify(value);
}

export function serializeDeterministic(value: unknown): string {
  return JSON.stringify(canonicalizeForHash(value), null, 2);
}

export function stableHash(value: unknown): string {
  // Fast path: check if we've seen this exact JSON string before
  const valueKey = typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : String(value);

  const cached = getCachedHash(valueKey);
  if (cached !== undefined) {
    return cached;
  }

  const canonical = JSON.stringify(canonicalizeForHash(value));
  const hash = createHash('sha256').update(canonical).digest('hex');

  // Cache the result
  setCachedHash(valueKey, hash);

  return hash;
}

// Clear cache for testing
export function clearHashCache(): void {
  hashCache.clear();
}

export function withCanonicalHash<T extends Record<string, unknown>>(
  value: T
): Omit<T, 'hash'> & {
  hash: {
    algorithm: 'sha256';
    canonical_json_hash: string;
  };
} {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hash: _existing, ...rest } = value;
  return {
    ...rest,
    hash: {
      algorithm: 'sha256',
      canonical_json_hash: stableHash(rest),
    },
  } as Omit<T, 'hash'> & { hash: { algorithm: 'sha256'; canonical_json_hash: string } };
}

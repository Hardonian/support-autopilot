import { createHash } from 'crypto';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function canonicalizeForHash(value: unknown): JsonValue {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(item => canonicalizeForHash(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, canonicalizeForHash(entryValue)] as const);

    return Object.fromEntries(entries) as JsonValue;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  return String(value);
}

export function serializeDeterministic(value: unknown): string {
  return JSON.stringify(canonicalizeForHash(value), null, 2);
}

export function stableHash(value: unknown): string {
  const canonical = JSON.stringify(canonicalizeForHash(value));
  return createHash('sha256').update(canonical).digest('hex');
}

export function withCanonicalHash<T extends Record<string, unknown>>(
  value: T
): Omit<T, 'hash'> & {
  hash: {
    algorithm: 'sha256';
    canonical_json_hash: string;
  };
} {
  const { hash: _existing, ...rest } = value;
  return {
    ...rest,
    hash: {
      algorithm: 'sha256',
      canonical_json_hash: stableHash(rest),
    },
  } as Omit<T, 'hash'> & { hash: { algorithm: 'sha256'; canonical_json_hash: string } };
}

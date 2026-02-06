/**
 * Log and evidence redaction utility.
 * Strips sensitive keys from structured data before writing to artifacts.
 */

/** Keys whose values must be redacted from logs and evidence. */
const DENYLIST_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'api_key',
  'apikey',
  'api_secret',
  'access_token',
  'refresh_token',
  'bearer',
  'authorization',
  'auth_token',
  'private_key',
  'credential',
  'credentials',
  'ssn',
  'credit_card',
  'cc_number',
  'cvv',
  'customer_email',
  'customer_name',
]);

const REDACTED = '[REDACTED]';

/**
 * Recursively redact values for keys matching the denylist.
 * Returns a deep copy—never mutates the input.
 */
export function redactObject(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => redactObject(item));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (DENYLIST_KEYS.has(key.toLowerCase())) {
        result[key] = REDACTED;
      } else {
        result[key] = redactObject(val);
      }
    }
    return result;
  }

  return value;
}

/**
 * Check if a string contains any patterns that look like secrets.
 * Returns the list of matched pattern names.
 */
export function detectSecretPatterns(text: string): string[] {
  const patterns: Array<{ name: string; pattern: RegExp }> = [
    { name: 'AWS key', pattern: /AKIA[0-9A-Z]{16}/g },
    { name: 'private key', pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g },
    { name: 'bearer token', pattern: /["']Bearer\s+[A-Za-z0-9\-._~+/]+=*["']/g },
    { name: 'secret assignment', pattern: /(password|secret|api_key|apikey)\s*[:=]\s*["'][^"']{8,}["']/gi },
  ];

  const found: string[] = [];
  for (const { name, pattern } of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Redact a JSON string — parses, redacts, then re-serializes.
 */
export function redactJsonString(json: string): string {
  const parsed: unknown = JSON.parse(json);
  return JSON.stringify(redactObject(parsed));
}

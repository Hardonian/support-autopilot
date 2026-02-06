import { describe, it, expect } from 'vitest';
import { ExitCode, RunnerException, toRunnerException, RunnerErrorSchema } from './errors.js';
import { redactObject, detectSecretPatterns, redactJsonString } from './redact.js';
import { withRetry } from './retry.js';
import { ZodError, z } from 'zod';

// ---------------------------------------------------------------------------
// Error envelope
// ---------------------------------------------------------------------------
describe('RunnerException', () => {
  it('produces a valid RunnerError envelope', () => {
    const ex = new RunnerException({
      code: 'TEST_ERROR',
      message: 'something broke',
      userMessage: 'Please try again.',
      retryable: true,
      context: { key: 'val' },
    });

    const envelope = ex.toEnvelope();
    expect(() => RunnerErrorSchema.parse(envelope)).not.toThrow();
    expect(envelope.code).toBe('TEST_ERROR');
    expect(envelope.retryable).toBe(true);
    expect(envelope.context).toEqual({ key: 'val' });
  });

  it('wraps ZodError into validation envelope', () => {
    const schema = z.object({ name: z.string() });
    let zodErr: ZodError | undefined;
    try {
      schema.parse({ name: 123 });
    } catch (e) {
      zodErr = e as ZodError;
    }
    const re = toRunnerException(zodErr);
    expect(re.exitCode).toBe(ExitCode.ValidationError);
    expect(re.code).toBe('VALIDATION_ERROR');
  });

  it('wraps unknown errors', () => {
    const re = toRunnerException('plain string error');
    expect(re.exitCode).toBe(ExitCode.UnexpectedBug);
    expect(re.code).toBe('UNEXPECTED_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------
describe('ExitCode', () => {
  it('has correct numeric values', () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.ValidationError).toBe(2);
    expect(ExitCode.ExternalDependencyFailure).toBe(3);
    expect(ExitCode.UnexpectedBug).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Redaction — denylist keys
// ---------------------------------------------------------------------------
describe('redactObject', () => {
  it('redacts denylist keys from nested objects', () => {
    const input = {
      user: 'alice',
      password: 'secret123',
      nested: {
        api_key: 'sk-abc',
        data: 'safe',
      },
    };

    const result = redactObject(input) as Record<string, unknown>;
    expect(result.user).toBe('alice');
    expect(result.password).toBe('[REDACTED]');
    expect((result.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect((result.nested as Record<string, unknown>).data).toBe('safe');
  });

  it('redacts inside arrays', () => {
    const input = [
      { token: 'secret', value: 'ok' },
      { secret: 'hidden', value: 'also ok' },
    ];

    const result = redactObject(input) as Array<Record<string, unknown>>;
    expect(result[0].token).toBe('[REDACTED]');
    expect(result[0].value).toBe('ok');
    expect(result[1].secret).toBe('[REDACTED]');
  });

  it('handles null and primitives safely', () => {
    expect(redactObject(null)).toBe(null);
    expect(redactObject(undefined)).toBe(undefined);
    expect(redactObject('hello')).toBe('hello');
    expect(redactObject(42)).toBe(42);
  });

  it('is case-insensitive on key names', () => {
    const input = { PASSWORD: 'x', Api_Key: 'y', normal: 'z' };
    const result = redactObject(input) as Record<string, unknown>;
    expect(result.PASSWORD).toBe('[REDACTED]');
    expect(result.Api_Key).toBe('[REDACTED]');
    expect(result.normal).toBe('z');
  });
});

// ---------------------------------------------------------------------------
// Secret pattern detection
// ---------------------------------------------------------------------------
describe('detectSecretPatterns', () => {
  it('detects AWS keys', () => {
    const hits = detectSecretPatterns('my key is AKIAIOSFODNN7EXAMPLE');
    expect(hits).toContain('AWS key');
  });

  it('detects private key headers', () => {
    const hits = detectSecretPatterns('-----BEGIN RSA PRIVATE KEY-----');
    expect(hits).toContain('private key');
  });

  it('detects secret assignments', () => {
    const hits = detectSecretPatterns('password = "mysecretpassword123"');
    expect(hits).toContain('secret assignment');
  });

  it('returns empty for clean text', () => {
    const hits = detectSecretPatterns('This is a normal support ticket about an API issue.');
    expect(hits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// redactJsonString
// ---------------------------------------------------------------------------
describe('redactJsonString', () => {
  it('round-trips through JSON and redacts', () => {
    const json = JSON.stringify({ password: 'abc', safe: 'ok' });
    const result = JSON.parse(redactJsonString(json)) as Record<string, unknown>;
    expect(result.password).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Forbidden patterns in serialized evidence
// ---------------------------------------------------------------------------
describe('security: no secrets in output', () => {
  const FORBIDDEN = [
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/,
    /(password|secret|api_key)\s*[:=]\s*["'][^"']{8,}["']/i,
  ];

  function assertNoSecrets(text: string): void {
    for (const pattern of FORBIDDEN) {
      pattern.lastIndex = 0;
      expect(pattern.test(text), `Forbidden pattern found: ${pattern.source}`).toBe(false);
    }
  }

  it('redacted object serialization contains no secrets', () => {
    const dirty = {
      user: 'test',
      password: 'supersecret123',
      credentials: { api_key: 'AKIAIOSFODNN7EXAMPLE' },
    };
    const clean = JSON.stringify(redactObject(dirty));
    assertNoSecrets(clean);
  });

  it('redactJsonString removes secrets via key-based redaction', () => {
    const dirty = JSON.stringify({
      secret: 'very_long_secret_value',
      api_key: 'AKIAIOSFODNN7EXAMPLE',
    });
    assertNoSecrets(redactJsonString(dirty));
  });
});

// ---------------------------------------------------------------------------
// Retry with backoff
// ---------------------------------------------------------------------------
describe('withRetry', () => {
  it('returns immediately on success', async () => {
    const result = await withRetry(async () => 'ok', { maxAttempts: 3, initialDelayMs: 1 });
    expect(result.value).toBe('ok');
    expect(result.attempts).toBe(1);
  });

  it('retries on retryable errors', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw new RunnerException({
            code: 'TEMP',
            message: 'transient',
            userMessage: 'transient',
            retryable: true,
          });
        }
        return 'recovered';
      },
      { maxAttempts: 3, initialDelayMs: 1 }
    );
    expect(result.value).toBe('recovered');
    expect(result.attempts).toBe(3);
  });

  it('throws after max attempts', async () => {
    await expect(
      withRetry(
        async () => {
          throw new RunnerException({
            code: 'FAIL',
            message: 'always fails',
            userMessage: 'always fails',
            retryable: true,
          });
        },
        { maxAttempts: 2, initialDelayMs: 1 }
      )
    ).rejects.toThrow('All 2 attempts failed');
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new RunnerException({
            code: 'FATAL',
            message: 'not retryable',
            userMessage: 'fatal',
            retryable: false,
          });
        },
        { maxAttempts: 3, initialDelayMs: 1 }
      )
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('preserves idempotency key in result', async () => {
    const result = await withRetry(async () => 42, {
      maxAttempts: 1,
      idempotencyKey: 'idem-123',
    });
    expect(result.idempotencyKey).toBe('idem-123');
  });
});

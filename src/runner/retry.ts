import { RunnerException, ExitCode } from './errors.js';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxAttempts?: number;
  /** Initial backoff delay in ms (default: 1000). */
  initialDelayMs?: number;
  /** Backoff multiplier (default: 2). */
  multiplier?: number;
  /** Idempotency key for deduplication. */
  idempotencyKey?: string;
  /** Predicate: should we retry this error? Default: retry if retryable. */
  shouldRetry?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
  idempotencyKey?: string;
}

/**
 * Execute an async action with exponential backoff retries.
 * The action receives the current attempt number (1-based).
 */
export async function withRetry<T>(
  action: (attempt: number) => Promise<T>,
  opts?: RetryOptions,
): Promise<RetryResult<T>> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const initialDelay = opts?.initialDelayMs ?? 1000;
  const multiplier = opts?.multiplier ?? 2;
  const shouldRetry = opts?.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await action(attempt);
      return {
        value,
        attempts: attempt,
        idempotencyKey: opts?.idempotencyKey,
      };
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !shouldRetry(error)) {
        break;
      }

      const delay = initialDelay * Math.pow(multiplier, attempt - 1);
      await sleep(delay);
    }
  }

  throw new RunnerException({
    code: 'RETRY_EXHAUSTED',
    message: `All ${maxAttempts} attempts failed`,
    userMessage: 'The operation failed after multiple retries. Please try again later.',
    retryable: true,
    cause: lastError instanceof Error ? lastError : undefined,
    context: {
      maxAttempts,
      idempotencyKey: opts?.idempotencyKey,
    },
    exitCode: ExitCode.ExternalDependencyFailure,
  });
}

function defaultShouldRetry(error: unknown): boolean {
  if (error instanceof RunnerException) {
    return error.retryable;
  }
  // Network-style errors are usually retryable
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('econnreset');
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

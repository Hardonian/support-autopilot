import { z } from 'zod';

/**
 * Standardized exit codes for all runner CLI commands.
 */
export const ExitCode = {
  Success: 0,
  ValidationError: 2,
  ExternalDependencyFailure: 3,
  UnexpectedBug: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Shared error envelope schema.
 * Every error surfaced to users or written to artifacts uses this shape.
 */
export const RunnerErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  userMessage: z.string().min(1),
  retryable: z.boolean(),
  cause: z.string().optional(),
  context: z.record(z.unknown()).default({}),
});

export type RunnerError = z.infer<typeof RunnerErrorSchema>;

/**
 * Typed error class that produces a valid RunnerError envelope.
 */
export class RunnerException extends Error {
  public readonly code: string;
  public readonly userMessage: string;
  public readonly retryable: boolean;
  public readonly context: Record<string, unknown>;
  public readonly exitCode: ExitCodeValue;

  constructor(opts: {
    code: string;
    message: string;
    userMessage: string;
    retryable?: boolean;
    cause?: unknown;
    context?: Record<string, unknown>;
    exitCode?: ExitCodeValue;
  }) {
    super(opts.message);
    this.name = 'RunnerException';
    this.code = opts.code;
    this.userMessage = opts.userMessage;
    this.retryable = opts.retryable ?? false;
    this.context = opts.context ?? {};
    this.exitCode = opts.exitCode ?? ExitCode.UnexpectedBug;
    if (opts.cause instanceof Error) {
      this.cause = opts.cause;
    }
  }

  toEnvelope(): RunnerError {
    return RunnerErrorSchema.parse({
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      retryable: this.retryable,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
      context: this.context,
    });
  }
}

/**
 * Wrap an unknown thrown value into a RunnerException.
 */
export function toRunnerException(error: unknown): RunnerException {
  if (error instanceof RunnerException) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return new RunnerException({
      code: 'VALIDATION_ERROR',
      message: error.issues.map((i: z.ZodIssue) => i.message).join('; '),
      userMessage: 'Input validation failed. Check your data and try again.',
      retryable: false,
      cause: error,
      context: { issues: error.issues },
      exitCode: ExitCode.ValidationError,
    });
  }

  if (error instanceof Error) {
    return new RunnerException({
      code: 'UNEXPECTED_ERROR',
      message: error.message,
      userMessage: 'An unexpected error occurred. Please report this issue.',
      retryable: false,
      cause: error,
      exitCode: ExitCode.UnexpectedBug,
    });
  }

  return new RunnerException({
    code: 'UNEXPECTED_ERROR',
    message: String(error),
    userMessage: 'An unexpected error occurred.',
    retryable: false,
    exitCode: ExitCode.UnexpectedBug,
  });
}

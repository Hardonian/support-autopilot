import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { redactObject } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;
  runId: string;
  context: Record<string, unknown>;
}

/**
 * Structured JSONL logger that writes to an artifact path.
 * Every line is a self-contained JSON object.
 */
export class RunnerLogger {
  private readonly logPath: string;
  private readonly runId: string;
  private readonly jsonOutput: boolean;
  private initialized = false;

  constructor(logPath: string, runId: string, opts?: { json?: boolean }) {
    this.logPath = logPath;
    this.runId = runId;
    this.jsonOutput = opts?.json ?? false;
  }

  private ensureDir(): void {
    if (!this.initialized) {
      mkdirSync(dirname(this.logPath), { recursive: true });
      // Truncate file to start fresh for this run
      writeFileSync(this.logPath, '', 'utf-8');
      this.initialized = true;
    }
  }

  private write(level: LogLevel, event: string, message: string, context: Record<string, unknown> = {}): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      runId: this.runId,
      context: redactObject(context) as Record<string, unknown>,
    };

    // Always append to log file
    this.ensureDir();
    appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');

    // Also emit to stderr for human visibility (unless --json suppresses it)
    if (!this.jsonOutput) {
      const prefix = level === 'error' || level === 'fatal' ? '!' : level === 'warn' ? '?' : '-';
      process.stderr.write(`${prefix} [${level}] ${message}\n`);
    }
  }

  debug(event: string, message: string, context?: Record<string, unknown>): void {
    this.write('debug', event, message, context);
  }

  info(event: string, message: string, context?: Record<string, unknown>): void {
    this.write('info', event, message, context);
  }

  warn(event: string, message: string, context?: Record<string, unknown>): void {
    this.write('warn', event, message, context);
  }

  error(event: string, message: string, context?: Record<string, unknown>): void {
    this.write('error', event, message, context);
  }

  fatal(event: string, message: string, context?: Record<string, unknown>): void {
    this.write('fatal', event, message, context);
  }
}

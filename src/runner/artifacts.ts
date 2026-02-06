import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { serializeDeterministic } from '../utils/deterministic.js';
import { redactObject } from './redact.js';
import { RunnerLogger } from './logger.js';
import { RunnerException } from './errors.js';

/**
 * Standard artifact layout:
 *
 *   ./artifacts/<runId>/logs.jsonl
 *   ./artifacts/<runId>/evidence/*.json
 *   ./artifacts/<runId>/summary.json
 */

export interface ArtifactManagerOptions {
  baseDir: string;
  runId?: string;
  json?: boolean;
}

export interface RunSummary {
  runId: string;
  status: 'success' | 'failure' | 'partial';
  startedAt: string;
  finishedAt?: string;
  command: string;
  dryRun: boolean;
  evidenceFiles: string[];
  errors: unknown[];
}

export class ArtifactManager {
  public readonly runId: string;
  public readonly runDir: string;
  public readonly evidenceDir: string;
  public readonly logsPath: string;
  public readonly summaryPath: string;
  public readonly logger: RunnerLogger;

  private evidenceFiles: string[] = [];
  private errors: unknown[] = [];
  private startedAt: string;

  constructor(opts: ArtifactManagerOptions) {
    this.runId = opts.runId ?? randomUUID();
    this.runDir = resolve(opts.baseDir, this.runId);
    this.evidenceDir = resolve(this.runDir, 'evidence');
    this.logsPath = resolve(this.runDir, 'logs.jsonl');
    this.summaryPath = resolve(this.runDir, 'summary.json');
    this.startedAt = new Date().toISOString();

    // Create directory structure
    mkdirSync(this.evidenceDir, { recursive: true });

    this.logger = new RunnerLogger(this.logsPath, this.runId, { json: opts.json });
  }

  /**
   * Write an evidence file (JSON). Data is redacted before writing.
   */
  writeEvidence(name: string, data: unknown): string {
    const filename = name.endsWith('.json') ? name : `${name}.json`;
    const filePath = resolve(this.evidenceDir, filename);
    const redacted = redactObject(data);
    writeFileSync(filePath, serializeDeterministic(redacted) + '\n', 'utf-8');
    this.evidenceFiles.push(filename);
    this.logger.info('artifact.evidence_written', `Evidence written: ${filename}`, { filename });
    return filePath;
  }

  /**
   * Record an error that occurred during the run.
   */
  recordError(error: unknown): void {
    this.errors.push(error);
  }

  /**
   * Write the summary.json and close out the run.
   */
  finalize(command: string, dryRun: boolean, status?: 'success' | 'failure' | 'partial'): RunSummary {
    const resolvedStatus = status ?? (this.errors.length > 0 ? 'failure' : 'success');
    const summary: RunSummary = {
      runId: this.runId,
      status: resolvedStatus,
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      command,
      dryRun,
      evidenceFiles: this.evidenceFiles,
      errors: this.errors.map(e => {
        if (e instanceof RunnerException) {
          return e.toEnvelope();
        }
        if (e instanceof Error) {
          return { code: 'UNEXPECTED_ERROR', message: e.message };
        }
        return { code: 'UNEXPECTED_ERROR', message: String(e) };
      }),
    };

    writeFileSync(this.summaryPath, serializeDeterministic(summary) + '\n', 'utf-8');
    this.logger.info('artifact.summary_written', `Summary written: ${resolvedStatus}`, {
      status: resolvedStatus,
      evidenceCount: this.evidenceFiles.length,
      errorCount: this.errors.length,
    });

    return summary;
  }
}

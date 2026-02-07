import { z } from 'zod';
import { ArtifactManager } from './artifacts.js';
import { toRunnerException } from './errors.js';
import { triageBatch } from '../triage/index.js';
import { draftResponse } from '../draft/index.js';
import { proposeKBPatch } from '../kb-proposals/index.js';
import { ingestDirectory, buildIndex, retrieveForTicket } from '../kb/index.js';
import { validateTickets } from '../contracts/ticket.js';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Runner Contract for ControlPlane integration
 */
export interface RunnerContract {
  /** Unique identifier for this runner */
  readonly id: string;

  /** Semantic version of this runner */
  readonly version: string;

  /** What this runner can do */
  readonly capabilities: readonly string[];

  /** Risk assessment: 'none' | 'low' | 'medium' | 'high' | 'critical' */
  readonly blastRadius: 'none' | 'low' | 'medium' | 'high' | 'critical';

  /**
   * Execute the runner with given inputs.
   * Never throws - always returns a result object.
   */
  execute(inputs: RunnerInputs): Promise<RunnerResult>;
}

/**
 * Inputs schema for runner execution
 */
export const RunnerInputsSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  command: z.enum(['demo', 'run']),
  options: z.record(z.unknown()).default({}),
});

export type RunnerInputs = z.infer<typeof RunnerInputsSchema>;

/**
 * Result schema from runner execution
 */
export const RunnerResultSchema = z.object({
  status: z.enum(['success', 'failure', 'partial']),
  output: z.record(z.unknown()),
  evidence: z.object({
    json: z.record(z.unknown()),
    summary: z.string(),
  }),
  error: z.optional(RunnerError),
});

export type RunnerResult = z.infer<typeof RunnerResultSchema>;

/**
 * Support Autopilot Runner implementation
 */
export class SupportAutopilotRunner implements RunnerContract {
  readonly id = 'support-autopilot';
  readonly version = '0.1.0';
  readonly capabilities = [
    'ticket-triage',
    'response-drafting',
    'kb-ingestion',
    'kb-proposals',
    'evidence-generation',
  ] as const;
  readonly blastRadius = 'low' as const;

  async execute(inputs: RunnerInputs): Promise<RunnerResult> {
    try {
      // Validate inputs
      const validatedInputs = RunnerInputsSchema.parse(inputs);

      // Create artifact manager for this run
      const artifacts = new ArtifactManager({
        baseDir: './artifacts',
        runId: `runner-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      });

      artifacts.logger.info('runner.execute.start', 'Runner execution started', {
        command: validatedInputs.command,
        tenantId: validatedInputs.tenantId,
        projectId: validatedInputs.projectId,
      });

      let result: RunnerResult;

      try {
        if (validatedInputs.command === 'demo') {
          result = await this.executeDemo(validatedInputs, artifacts);
        } else {
          result = await this.executeRun(validatedInputs, artifacts);
        }

        artifacts.logger.info('runner.execute.success', 'Runner execution completed successfully');
      } catch (error) {
        const runnerError = toRunnerException(error);
        artifacts.recordError(runnerError);

        result = {
          status: 'failure',
          output: {},
          evidence: {
            json: {},
            summary: `Execution failed: ${runnerError.userMessage}`,
          },
          error: runnerError.toEnvelope(),
        };

        artifacts.logger.error('runner.execute.error', 'Runner execution failed', {
          error: runnerError.toEnvelope(),
        });
      }

      // Finalize artifacts
      const summary = artifacts.finalize('runner.execute', false, result.status);

      // Add summary to evidence
      result.evidence.json = {
        ...result.evidence.json,
        summary,
        runner: {
          id: this.id,
          version: this.version,
          capabilities: this.capabilities,
          blastRadius: this.blastRadius,
        },
        inputs: validatedInputs,
        timestamps: {
          started: summary.startedAt,
          finished: summary.finishedAt,
        },
      };

      return result;
    } catch (error) {
      // Last resort error handling - should never reach here
      const runnerError = toRunnerException(error);
      return {
        status: 'failure',
        output: {},
        evidence: {
          json: {
            error: runnerError.toEnvelope(),
            runner: {
              id: this.id,
              version: this.version,
            },
          },
          summary: `Critical error: ${runnerError.userMessage}`,
        },
        error: runnerError.toEnvelope(),
      };
    }
  }

  private async executeDemo(inputs: RunnerInputs, artifacts: ArtifactManager): Promise<RunnerResult> {
    artifacts.logger.info('runner.demo.start', 'Starting demo execution');

    // Use built-in smoke fixtures
    const ticketsPath = resolve('examples/tickets/sample-tickets.json');
    if (!existsSync(ticketsPath)) {
      throw new Error('Demo fixtures not found: examples/tickets/sample-tickets.json');
    }

    // Load and validate tickets
    const ticketsData: unknown = JSON.parse(readFileSync(ticketsPath, 'utf-8'));
    const tickets = validateTickets(Array.isArray(ticketsData) ? ticketsData : [ticketsData]);

    artifacts.writeEvidence('demo-inputs', { ticketsPath, ticketCount: tickets.length });

    // Triage
    const { results, stats } = triageBatch(tickets);
    artifacts.writeEvidence('triage-results', { results, stats });

    // KB processing (if available)
    const kbDir = resolve('examples/kb');
    let kbSources: Awaited<ReturnType<typeof ingestDirectory>> = [];
    let draftResult = null;

    if (existsSync(kbDir)) {
      kbSources = await ingestDirectory(kbDir, {
        tenantId: inputs.tenantId,
        projectId: inputs.projectId,
      });
      artifacts.writeEvidence('kb-sources', kbSources.map(s => ({
        id: s.id,
        title: s.title,
        chunk_count: s.chunks.length,
      })));

      // Draft response for first ticket
      if (results.length > 0 && kbSources.length > 0) {
        const firstResult = results[0];
        const firstTicket = tickets.find(t => t.id === firstResult.ticket_id) ?? tickets[0];
        const index = buildIndex(inputs.tenantId, inputs.projectId, kbSources);
        const kbResults = retrieveForTicket(index, firstTicket.subject, firstTicket.body);
        const kbChunks = kbResults.map(r => r.chunk);

        draftResult = draftResponse(firstTicket, firstResult, kbChunks, {
          tone: 'friendly',
          includeDisclaimer: true,
        });
        artifacts.writeEvidence('draft-response', draftResult);
      }
    }

    // KB proposals
    let kbProposal = null;
    if (results.length > 0) {
      kbProposal = proposeKBPatch(results, {
        tenantId: inputs.tenantId,
        projectId: inputs.projectId,
      });
      if (kbProposal) {
        artifacts.writeEvidence('kb-proposal', kbProposal);
      }
    }

    const summary = `Demo completed: Triaged ${stats.total} tickets, processed ${kbSources.length} KB sources${draftResult ? ', drafted 1 response' : ''}${kbProposal ? ', proposed 1 KB update' : ''}`;

    return {
      status: 'success',
      output: {
        ticketsProcessed: stats.total,
        kbSourcesProcessed: kbSources.length,
        draftsCreated: draftResult ? 1 : 0,
        kbProposalsCreated: kbProposal ? 1 : 0,
      },
      evidence: {
        json: {
          triageStats: stats,
          kbSourceCount: kbSources.length,
          draftCreated: !!draftResult,
          kbProposalCreated: !!kbProposal,
        },
        summary,
      },
    };
  }

  private async executeRun(inputs: RunnerInputs, artifacts: ArtifactManager): Promise<RunnerResult> {
    artifacts.logger.info('runner.run.start', 'Starting full run execution');

    // For now, delegate to demo logic but with configurable inputs
    // In future, this could accept custom ticket data, KB paths, etc.
    return this.executeDemo(inputs, artifacts);
  }
}

// Export singleton instance for ControlPlane consumption
export const supportAutopilotRunner = new SupportAutopilotRunner();
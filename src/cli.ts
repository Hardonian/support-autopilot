#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { ingestDirectory, buildIndex, retrieveForTicket } from './kb/index.js';
import { triageBatch } from './triage/index.js';
import { draftResponse } from './draft/index.js';
import { proposeKBPatch } from './kb-proposals/index.js';
import {
  createTriageJob,
  createDraftReplyJob,
  createKBPatchJob,
  exportJobRequests,
  formatJobForgeOutput,
} from './jobforge/index.js';
import { validateTickets, type Ticket } from './contracts/ticket.js';
import { validateTriageResult } from './contracts/triage-result.js';
import { validateKBSources } from './contracts/kb-source.js';
import type { TonePreset } from './draft/generator.js';
import { redactTicket } from './utils/pii.js';
import { loadProfile, getDefaultProfile } from './utils/profiles.js';
import { analyze, renderMetrics, renderReport, validateBundle } from './jobforge/integration.js';
import { serializeDeterministic } from './utils/deterministic.js';
import { ExitCode, toRunnerException, type RunnerError } from './runner/errors.js';
import { ArtifactManager } from './runner/artifacts.js';
import { supportAutopilotRunner } from './runner/contract.js';

// ---------------------------------------------------------------------------
// Global option interfaces
// ---------------------------------------------------------------------------

interface GlobalOptions {
  config?: string;
  dryRun?: boolean;
  out?: string;
  json?: boolean;
  smoke?: boolean;
}

interface IngestOptions extends GlobalOptions {
  tenant: string;
  project: string;
  profile?: string;
}

interface TriageOptions extends GlobalOptions {
  tenant: string;
  project: string;
  profile?: string;
  jobforge?: boolean;
}

interface DraftOptions extends GlobalOptions {
  ticket: string;
  triage: string;
  kb: string;
  tenant: string;
  project: string;
  tone: string;
  profile?: string;
  jobforge?: boolean;
}

interface ProposeOptions extends GlobalOptions {
  fromTriage: string;
  tenant: string;
  project: string;
  profile?: string;
  jobforge?: boolean;
}

interface AnalyzeOptions extends GlobalOptions {
  inputs: string;
  tenant: string;
  project: string;
  trace: string;
  stableOutput?: boolean;
  markdown?: boolean;
}

interface RunOptions extends GlobalOptions {
  tenant: string;
  project: string;
  config?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getGlobalOpts(cmd: Command): GlobalOptions {
  // Walk up to root program to read global options
  let root = cmd;
  while (root.parent) {
    root = root.parent;
  }
  return root.opts<GlobalOptions>();
}

function mergeGlobal<T extends GlobalOptions>(local: T, cmd: Command): T {
  const global = getGlobalOpts(cmd);
  return {
    ...local,
    dryRun: local.dryRun ?? global.dryRun,
    out: local.out ?? global.out,
    json: local.json ?? global.json,
    smoke: local.smoke ?? global.smoke,
    config: local.config ?? global.config,
  };
}

/** Output result: JSON to stdout when --json, else pretty chalk */
function outputResult(data: unknown, opts: GlobalOptions): void {
  if (opts.json === true) {
    process.stdout.write(serializeDeterministic(data) + '\n');
  } else {
    console.log('\n' + JSON.stringify(data, null, 2));
  }
}

/** Standard error handler — emits error envelope and exits with correct code */
function handleError(error: unknown, opts: GlobalOptions): never {
  const re = toRunnerException(error);
  const envelope: RunnerError = re.toEnvelope();

  if (opts.json === true) {
    process.stderr.write(JSON.stringify(envelope) + '\n');
  } else {
    console.error(chalk.red(`[${envelope.code}]`), envelope.userMessage);
    if (envelope.cause !== undefined && envelope.cause !== '') {
      console.error(chalk.gray(`  cause: ${envelope.cause}`));
    }
  }

  process.exit(re.exitCode);
}

/** Resolve the artifact output directory (--out or default ./artifacts) */
function resolveOutDir(opts: GlobalOptions): string {
  return resolve(opts.out ?? './artifacts');
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('support')
  .description('Support Autopilot - Runnerless support triage and drafting')
  .version('0.1.0')
  .option('--config <path>', 'Path to configuration file')
  .option('--dry-run', 'Dry-run mode — validate and plan without side effects')
  .option('--out <dir>', 'Output directory for artifacts (default: ./artifacts)')
  .option('--json', 'Emit structured JSON output only (no chalk)')
  .option('--smoke', 'Smoke-test mode — run with built-in fixture data');

// ---------------------------------------------------------------------------
// plan — dry-run that produces plan + artifacts without network writes
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// demo — deterministic demo run using built-in fixtures
// ---------------------------------------------------------------------------
program
  .command('demo')
  .description('Run deterministic demo with built-in fixtures (no external dependencies)')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .option('--out <dir>', 'Output directory for artifacts')
  .option('--json', 'Emit structured JSON output only')
  .action(async function (this: Command, options: unknown) {
    const opts = mergeGlobal(options as RunOptions, this);

    try {
      const result = await supportAutopilotRunner.execute({
        tenantId: opts.tenant,
        projectId: opts.project,
        command: 'demo',
        options: opts as unknown as Record<string, unknown>,
      });

      if (opts.json !== true) {
        console.log('\n' + chalk.green('Demo completed successfully'));
        console.log(chalk.gray(`  Status: ${result.status}`));
        console.log(chalk.gray(`  Evidence: ${String((result.evidence as { summary: unknown }).summary)}`));
      }

      outputResult(result, opts);
    } catch (error) {
      handleError(error, opts);
    }
  });

program
  .command('plan')
  .description('Dry-run: validate inputs, produce plan and artifacts without side effects')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .option('--config <path>', 'Path to configuration file')
  .option('--out <dir>', 'Output directory for artifacts')
  .option('--json', 'Emit structured JSON output only')
  .action(function (this: Command, options: unknown) {
    const opts = mergeGlobal(options as RunOptions, this);
    // plan is always dry-run
    opts.dryRun = true;
    const outDir = resolveOutDir(opts);

    try {
      const artifacts = new ArtifactManager({ baseDir: outDir, json: opts.json });
      artifacts.logger.info('plan.start', 'Plan started', { tenant: opts.tenant, project: opts.project, dryRun: true });

      // Load config if provided
      if (opts.config !== undefined && opts.config !== '') {
        const configData: unknown = JSON.parse(readFileSync(resolve(opts.config), 'utf-8'));
        artifacts.writeEvidence('config', configData);
        artifacts.logger.info('plan.config_loaded', `Config loaded from ${opts.config}`);
      }

      // Load profile
      const profile = getDefaultProfile();
      artifacts.writeEvidence('profile', profile);

      // Check for sample ticket data
      const sampleTicketsPath = resolve('examples/tickets/sample-tickets.json');
      if (existsSync(sampleTicketsPath)) {
        const ticketsData: unknown = JSON.parse(readFileSync(sampleTicketsPath, 'utf-8'));
        const tickets = validateTickets(Array.isArray(ticketsData) ? ticketsData : [ticketsData]);
        artifacts.logger.info('plan.tickets_validated', `Validated ${tickets.length} sample tickets`);

        const { results, stats } = triageBatch(tickets);
        artifacts.writeEvidence('triage-results', { results, stats });
        artifacts.logger.info('plan.triage_complete', `Triaged ${stats.total} tickets`, { stats });
      }

      const summary = artifacts.finalize('plan', true, 'success');

      if (opts.json !== true) {
        console.log(chalk.green('Plan complete.'));
        console.log(chalk.gray(`  Run ID:    ${summary.runId}`));
        console.log(chalk.gray(`  Artifacts: ${artifacts.runDir}`));
        console.log(chalk.gray(`  Evidence:  ${summary.evidenceFiles.length} file(s)`));
        console.log(chalk.gray(`  Errors:    ${summary.errors.length}`));
      }

      outputResult(summary, opts);
    } catch (error) {
      handleError(error, opts);
    }
  });

// ---------------------------------------------------------------------------
// run — execute pipeline (supports --smoke for built-in fixtures)
// ---------------------------------------------------------------------------
program
  .command('run')
  .description('Execute the support autopilot pipeline')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .option('--config <path>', 'Path to configuration file')
  .option('--out <dir>', 'Output directory for artifacts')
  .option('--json', 'Emit structured JSON output only')
  .option('--dry-run', 'Dry-run mode')
  .option('--smoke', 'Run with built-in smoke-test fixtures')
  .action(async function (this: Command, options: unknown) {
    const opts = mergeGlobal(options as RunOptions, this);
    const outDir = resolveOutDir(opts);

    try {
      const artifacts = new ArtifactManager({ baseDir: outDir, json: opts.json });
      const isDryRun = opts.dryRun === true;

      artifacts.logger.info('run.start', 'Run started', {
        tenant: opts.tenant, project: opts.project,
        dryRun: isDryRun, smoke: opts.smoke === true,
      });

      let ticketsPath: string;

      if (opts.smoke === true) {
        // Smoke mode: use built-in example data
        ticketsPath = resolve('examples/tickets/sample-tickets.json');
        if (!existsSync(ticketsPath)) {
          throw Object.assign(new Error('Smoke fixture not found: examples/tickets/sample-tickets.json'), { code: 'ENOENT' });
        }
        artifacts.logger.info('run.smoke', 'Using smoke-test fixtures');
      } else if (opts.config !== undefined && opts.config !== '') {
        const configData = JSON.parse(readFileSync(resolve(opts.config), 'utf-8')) as Record<string, unknown>;
        const ticketsPathValue = configData.ticketsPath;
        ticketsPath = resolve(typeof ticketsPathValue === 'string' ? ticketsPathValue : 'examples/tickets/sample-tickets.json');
        artifacts.writeEvidence('config', configData);
      } else {
        ticketsPath = resolve('examples/tickets/sample-tickets.json');
      }

      // 1. Validate tickets
      const ticketsData: unknown = JSON.parse(readFileSync(ticketsPath, 'utf-8'));
      const tickets = validateTickets(Array.isArray(ticketsData) ? ticketsData : [ticketsData]);
      artifacts.logger.info('run.tickets_validated', `Validated ${tickets.length} tickets`);

      // 2. Triage
      const { results, stats } = triageBatch(tickets);
      artifacts.writeEvidence('triage-results', { results, stats });
      artifacts.logger.info('run.triage_complete', `Triaged ${stats.total} tickets`, { stats });

      // 3. KB ingest (if examples/kb exists)
      const kbDir = resolve('examples/kb');
      let kbSources: Awaited<ReturnType<typeof ingestDirectory>> = [];
      if (existsSync(kbDir)) {
        kbSources = await ingestDirectory(kbDir, {
          tenantId: opts.tenant,
          projectId: opts.project,
        });
        artifacts.writeEvidence('kb-sources', kbSources.map(s => ({
          id: s.id,
          title: s.title,
          chunk_count: s.chunks.length,
        })));
        artifacts.logger.info('run.kb_ingested', `Ingested ${kbSources.length} KB sources`);
      }

      // 4. Draft a response for the first triaged ticket
      if (results.length > 0 && kbSources.length > 0) {
        const firstResult = results[0];
        const firstTicket = tickets.find(t => t.id === firstResult.ticket_id) ?? tickets[0];
        const index = buildIndex(opts.tenant, opts.project, kbSources);
        const kbResults = retrieveForTicket(index, firstTicket.subject, firstTicket.body);
        const kbChunks = kbResults.map(r => r.chunk);

        const draft = draftResponse(firstTicket, firstResult, kbChunks, {
          tone: 'friendly' as TonePreset,
          includeDisclaimer: true,
        });
        artifacts.writeEvidence('draft-response', draft);
        artifacts.logger.info('run.draft_complete', `Draft created with status: ${draft.status}`);
      }

      // 5. Propose KB patches
      if (results.length > 0) {
        const proposal = proposeKBPatch(results, {
          tenantId: opts.tenant,
          projectId: opts.project,
        });
        if (proposal) {
          artifacts.writeEvidence('kb-proposal', proposal);
          artifacts.logger.info('run.kb_proposal', `KB patch proposed: ${proposal.proposed_title}`);
        }
      }

      const summary = artifacts.finalize('run', isDryRun, 'success');

      if (opts.json !== true) {
        console.log(chalk.green('Run complete.'));
        console.log(chalk.gray(`  Run ID:    ${summary.runId}`));
        console.log(chalk.gray(`  Artifacts: ${artifacts.runDir}`));
        console.log(chalk.gray(`  Evidence:  ${summary.evidenceFiles.length} file(s)`));
        console.log(chalk.gray(`  Status:    ${summary.status}`));
      }

      outputResult(summary, opts);
    } catch (error) {
      handleError(error, opts);
    }
  });

// ---------------------------------------------------------------------------
// Existing commands — enhanced with global options + error envelopes
// ---------------------------------------------------------------------------

program
  .command('ingest-kb')
  .description('Ingest knowledge base documents from a directory')
  .argument('<path>', 'Path to directory or file containing KB docs')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .option('--profile <path>', 'Profile configuration file')
  .option('--out <dir>', 'Output directory for artifacts')
  .option('--json', 'Emit structured JSON output only')
  .option('--dry-run', 'Dry-run mode')
  .action(async function (this: Command, path: string, options: unknown) {
    const opts = mergeGlobal(options as IngestOptions, this);
    try {
      if (opts.json !== true) {
        console.log(chalk.blue('Ingesting KB from:'), path);
      }

      const stats = { ingested: 0, failed: 0, chunks: 0 };

      const ingestOptions = {
        tenantId: opts.tenant,
        projectId: opts.project,
      };

      const sources = await ingestDirectory(path, ingestOptions);

      for (const source of sources) {
        stats.ingested++;
        stats.chunks += source.chunks.length;
      }

      if (opts.json !== true) {
        console.log(chalk.green(`Ingested ${stats.ingested} documents`));
        console.log(chalk.green(`Created ${stats.chunks} chunks`));
      }

      outputResult(sources, opts);
    } catch (error) {
      handleError(error, opts);
    }
  });

program
  .command('triage')
  .description('Triage support tickets from JSON file')
  .argument('<tickets.json>', 'Path to JSON file containing tickets')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .option('--profile <path>', 'Profile configuration file')
  .option('--jobforge', 'Output JobForge job requests instead of direct results')
  .option('--out <dir>', 'Output directory for artifacts')
  .option('--json', 'Emit structured JSON output only')
  .option('--dry-run', 'Dry-run mode')
  .action(function (this: Command, ticketsPath: string, options: unknown) {
    const opts = mergeGlobal(options as TriageOptions, this);
    try {
      if (opts.json !== true) {
        console.log(chalk.blue('Triaging tickets from:'), ticketsPath);
      }

      const ticketsData: unknown = JSON.parse(readFileSync(ticketsPath, 'utf-8'));
      const tickets = validateTickets(Array.isArray(ticketsData) ? ticketsData : [ticketsData]);

      // Verify tenant/project match
      for (const ticket of tickets) {
        if (ticket.tenant_id !== opts.tenant || ticket.project_id !== opts.project) {
          console.error(chalk.red('Tenant/Project mismatch in ticket:'), ticket.id);
          process.exit(ExitCode.ValidationError);
        }
      }

      // Profile loaded for future use when LLM integration is added
      const profile = opts.profile !== undefined ? loadProfile(opts.profile) : getDefaultProfile();
      void profile; // Mark as intentionally unused for now

      const { results, stats } = triageBatch(tickets);

      if (opts.json !== true) {
        console.log(chalk.green(`Triaged ${stats.total} tickets`));
        console.log(chalk.yellow(`  Critical: ${stats.critical}`));
        console.log(chalk.yellow(`  High: ${stats.high}`));
        console.log(chalk.yellow(`  Medium: ${stats.medium}`));
        console.log(chalk.yellow(`  Low: ${stats.low}`));
        console.log(chalk.yellow(`  Needs human review: ${stats.needsHumanReview}`));
        console.log(chalk.yellow(`  Needs KB update: ${stats.needsKbUpdate}`));
      }

      if (opts.jobforge === true) {
        const jobs = results.map(result =>
          createTriageJob(
            tickets.find(t => t.id === result.ticket_id)!,
            {
              tenantId: opts.tenant,
              projectId: opts.project,
              priority: result.urgency === 'critical' ? 'critical' : 'normal',
            }
          )
        );

        if (opts.json !== true) {
          console.log('\n' + formatJobForgeOutput(jobs, true));
        }
        outputResult(exportJobRequests(jobs), opts);
      } else {
        outputResult(results, opts);
      }
    } catch (error) {
      handleError(error, opts);
    }
  });

program
  .command('draft')
  .description('Draft a response for a ticket')
  .requiredOption('--ticket <id>', 'Ticket ID')
  .requiredOption('--triage <path>', 'Path to triage result JSON')
  .requiredOption('--kb <path>', 'Path to KB index JSON')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .option('--tone <tone>', 'Tone preset (concise|friendly|technical|empathetic|formal)', 'friendly')
  .option('--profile <path>', 'Profile configuration file')
  .option('--jobforge', 'Output JobForge job request instead of draft')
  .option('--out <dir>', 'Output directory for artifacts')
  .option('--json', 'Emit structured JSON output only')
  .option('--dry-run', 'Dry-run mode')
  .action(function (this: Command, options: unknown) {
    const opts = mergeGlobal(options as DraftOptions, this);
    try {
      if (opts.json !== true) {
        console.log(chalk.blue('Drafting response for ticket:'), opts.ticket);
      }

      const triageData: unknown = JSON.parse(readFileSync(opts.triage, 'utf-8'));
      const triageResult = validateTriageResult(
        Array.isArray(triageData)
          ? (triageData as unknown[]).find((t): t is Record<string, unknown> =>
              typeof t === 'object' && t !== null && 'ticket_id' in t && (t as Record<string, unknown>).ticket_id === opts.ticket
            )
          : triageData
      );

      const kbData: unknown = JSON.parse(readFileSync(opts.kb, 'utf-8'));
      const kbSources = validateKBSources(Array.isArray(kbData) ? kbData : [kbData]);
      const index = buildIndex(
        opts.tenant,
        opts.project,
        kbSources
      );

      const mockTicket: Ticket = {
        tenant_id: opts.tenant,
        project_id: opts.project,
        id: opts.ticket,
        subject: triageResult.ticket_id,
        body: '',
        status: 'open',
        priority: triageResult.suggested_priority ?? 'medium',
        created_at: new Date().toISOString(),
        tags: triageResult.suggested_tags ?? [],
        metadata: {},
      };

      const kbResults = retrieveForTicket(index, mockTicket.subject, mockTicket.body);
      const kbChunks = kbResults.map(r => r.chunk);

      const draft = draftResponse(mockTicket, triageResult, kbChunks, {
        tone: opts.tone as TonePreset,
        includeDisclaimer: true,
      });

      if (opts.json !== true) {
        console.log(chalk.green('Draft created with status:'), draft.status);

        if (draft.warnings.length > 0) {
          console.log(chalk.yellow('Warnings:'));
          draft.warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
        }

        if (draft.disclaimer !== undefined && draft.disclaimer !== '') {
          console.log(chalk.cyan('\nDisclaimer:'), draft.disclaimer);
        }

        console.log(chalk.cyan('\n--- DRAFT RESPONSE ---\n'));
        console.log(draft.body);
        console.log(chalk.cyan('\n--- END DRAFT ---'));
      }

      if (opts.jobforge === true) {
        const job = createDraftReplyJob(
          mockTicket,
          triageResult,
          opts.tone,
          {
            tenantId: opts.tenant,
            projectId: opts.project,
            priority: triageResult.urgency === 'critical' ? 'critical' : 'normal',
          }
        );

        if (opts.json !== true) {
          console.log('\n' + formatJobForgeOutput([job], true));
        }
        outputResult(job, opts);
      } else {
        outputResult(draft, opts);
      }
    } catch (error) {
      handleError(error, opts);
    }
  });

program
  .command('propose-kb')
  .description('Propose KB patches based on triage results')
  .requiredOption('--from-triage <path>', 'Path to triage results JSON')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .option('--profile <path>', 'Profile configuration file')
  .option('--jobforge', 'Output JobForge job requests instead of proposals')
  .option('--out <dir>', 'Output directory for artifacts')
  .option('--json', 'Emit structured JSON output only')
  .option('--dry-run', 'Dry-run mode')
  .action(function (this: Command, options: unknown) {
    const opts = mergeGlobal(options as ProposeOptions, this);
    try {
      if (opts.json !== true) {
        console.log(chalk.blue('Proposing KB patches from triage:'), opts.fromTriage);
      }

      const triageData: unknown = JSON.parse(readFileSync(opts.fromTriage, 'utf-8'));
      const triageResults = Array.isArray(triageData) ? (triageData as unknown[]) : [triageData];

      const validatedResults = triageResults.map(r => validateTriageResult(r));
      const proposal = proposeKBPatch(validatedResults, {
        tenantId: opts.tenant,
        projectId: opts.project,
      });

      if (proposal === null || proposal === undefined) {
        if (opts.json !== true) {
          console.log(chalk.yellow('No KB patch proposal generated'));
        }
        outputResult({ proposal: null }, opts);
        return;
      }

      if (opts.json !== true) {
        console.log(chalk.green('Proposed KB patch:'), proposal.proposed_title);
        console.log(chalk.green('Type:'), proposal.type);
        console.log(chalk.green('Related tickets:'), proposal.related_ticket_ids.length);

        console.log(chalk.cyan('\n--- PROPOSED CONTENT ---\n'));
        console.log(proposal.proposed_content);
        console.log(chalk.cyan('\n--- END PROPOSAL ---'));
      }

      if (opts.jobforge === true) {
        const job = createKBPatchJob(proposal, {
          tenantId: opts.tenant,
          projectId: opts.project,
        });

        if (opts.json !== true) {
          console.log('\n' + formatJobForgeOutput([job], true));
        }
        outputResult(job, opts);
      } else {
        outputResult(proposal, opts);
      }
    } catch (error) {
      handleError(error, opts);
    }
  });

program
  .command('redact')
  .description('Redact PII from ticket data')
  .argument('<tickets.json>', 'Path to JSON file containing tickets')
  .option('--json', 'Emit structured JSON output only')
  .action(function (this: Command, ticketsPath: string, options: unknown) {
    const opts = mergeGlobal(options as GlobalOptions, this);
    try {
      if (opts.json !== true) {
        console.log(chalk.blue('Redacting PII from:'), ticketsPath);
      }

      const ticketsData: unknown = JSON.parse(readFileSync(ticketsPath, 'utf-8'));
      const tickets = validateTickets(Array.isArray(ticketsData) ? ticketsData : [ticketsData]);

      const redactedData = tickets.map(ticket => {
        const result = redactTicket(ticket);
        return {
          id: ticket.id,
          subject: result.subject,
          body: result.body,
          redactionCount: result.redactionCount,
        };
      });

      const totalRedactions = redactedData.reduce((sum: number, r) => sum + r.redactionCount, 0);

      if (opts.json !== true) {
        console.log(chalk.green(`Redacted ${totalRedactions} PII instances from ${tickets.length} tickets`));
      }
      outputResult(redactedData, opts);
    } catch (error) {
      handleError(error, opts);
    }
  });

program
  .command('analyze')
  .description('Analyze inputs and emit JobForge-compatible outputs (request bundle + report)')
  .requiredOption('--inputs <path>', 'Path to JSON inputs')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--trace <id>', 'Trace ID')
  .option('--out <dir>', 'Output directory')
  .option('--stable-output', 'Emit deterministic outputs for fixtures/docs')
  .option('--no-markdown', 'Skip Markdown report')
  .option('--json', 'Emit structured JSON output only')
  .option('--dry-run', 'Dry-run mode')
  .action(function (this: Command, options: unknown) {
    const opts = mergeGlobal(options as AnalyzeOptions, this);
    try {
      const inputsPath = resolve(opts.inputs);
      const outputDir = resolve(opts.out ?? './artifacts');

      const rawInputs: unknown = JSON.parse(readFileSync(inputsPath, 'utf-8'));
      const result = analyze(rawInputs as Record<string, unknown>, {
        tenantId: opts.tenant,
        projectId: opts.project,
        traceId: opts.trace,
        stableOutput: opts.stableOutput === true,
      });

      const validation = validateBundle(result.jobRequestBundle);
      if (!validation.valid) {
        if (opts.json !== true) {
          console.error(chalk.red('Job request bundle validation failed'));
          validation.errors?.forEach(error => console.error(chalk.red(`- ${error}`)));
        }
        process.exit(ExitCode.ValidationError);
      }

      mkdirSync(outputDir, { recursive: true });
      writeFileSync(
        resolve(outputDir, 'request-bundle.json'),
        serializeDeterministic(result.jobRequestBundle) + '\n',
        'utf-8'
      );
      writeFileSync(
        resolve(outputDir, 'report.json'),
        serializeDeterministic(result.reportEnvelope) + '\n',
        'utf-8'
      );
      writeFileSync(
        resolve(outputDir, 'metrics.prom'),
        renderMetrics({
          jobRequestBundle: result.jobRequestBundle,
          reportEnvelope: result.reportEnvelope,
          validation,
        }) + '\n',
        'utf-8'
      );

      if (opts.markdown !== false) {
        writeFileSync(
          resolve(outputDir, 'report.md'),
          renderReport(result.reportEnvelope, 'markdown') + '\n',
          'utf-8'
        );
      }

      if (opts.json !== true) {
        console.log(chalk.green('JobForge outputs written to:'), outputDir);
      }
      outputResult({ outputDir, status: 'success' }, opts);
    } catch (error) {
      handleError(error, opts);
    }
  });

program.parse();

#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
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
import { ZodError } from 'zod';

// Command option interfaces for type safety
interface IngestOptions {
  tenant: string;
  project: string;
  profile?: string;
}

interface TriageOptions {
  tenant: string;
  project: string;
  profile?: string;
  jobforge?: boolean;
}

interface DraftOptions {
  ticket: string;
  triage: string;
  kb: string;
  tenant: string;
  project: string;
  tone: string;
  profile?: string;
  jobforge?: boolean;
}

interface ProposeOptions {
  fromTriage: string;
  tenant: string;
  project: string;
  profile?: string;
  jobforge?: boolean;
}

interface AnalyzeOptions {
  inputs: string;
  tenant: string;
  project: string;
  trace: string;
  out: string;
  stableOutput?: boolean;
  markdown?: boolean;
}

const program = new Command();

program
  .name('support')
  .description('Support Autopilot - Runnerless support triage and drafting')
  .version('0.1.0');

program
  .command('ingest-kb')
  .description('Ingest knowledge base documents from a directory')
  .argument('<path>', 'Path to directory or file containing KB docs')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .option('--profile <path>', 'Profile configuration file')
  .action(async (path: string, options: unknown) => {
    const typedOptions = options as IngestOptions;
    try {
      console.log(chalk.blue('Ingesting KB from:'), path);

      const stats = { ingested: 0, failed: 0, chunks: 0 };

      const ingestOptions = {
        tenantId: typedOptions.tenant,
        projectId: typedOptions.project,
      };

      const sources = await ingestDirectory(path, ingestOptions);

      for (const source of sources) {
        stats.ingested++;
        stats.chunks += source.chunks.length;
      }

      console.log(chalk.green(`Ingested ${stats.ingested} documents`));
      console.log(chalk.green(`Created ${stats.chunks} chunks`));

      // Output as JSON for piping
      console.log('\n' + JSON.stringify(sources, null, 2));
    } catch (error) {
      console.error(chalk.red('Error ingesting KB:'), error);
      process.exit(1);
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
  .action((ticketsPath: string, options: unknown) => {
    const typedOptions = options as TriageOptions;
    try {
      console.log(chalk.blue('Triaging tickets from:'), ticketsPath);

      const ticketsData: unknown = JSON.parse(readFileSync(ticketsPath, 'utf-8'));
      const tickets = validateTickets(Array.isArray(ticketsData) ? ticketsData : [ticketsData]);
      
      // Verify tenant/project match
      for (const ticket of tickets) {
        if (ticket.tenant_id !== typedOptions.tenant || ticket.project_id !== typedOptions.project) {
          console.error(chalk.red('Tenant/Project mismatch in ticket:'), ticket.id);
          process.exit(1);
        }
      }
      
      // Profile loaded for future use when LLM integration is added
      const profile = typedOptions.profile !== undefined ? loadProfile(typedOptions.profile) : getDefaultProfile();
      void profile; // Mark as intentionally unused for now
      
      const { results, stats } = triageBatch(tickets);
      
      console.log(chalk.green(`Triaged ${stats.total} tickets`));
      console.log(chalk.yellow(`  Critical: ${stats.critical}`));
      console.log(chalk.yellow(`  High: ${stats.high}`));
      console.log(chalk.yellow(`  Medium: ${stats.medium}`));
      console.log(chalk.yellow(`  Low: ${stats.low}`));
      console.log(chalk.yellow(`  Needs human review: ${stats.needsHumanReview}`));
      console.log(chalk.yellow(`  Needs KB update: ${stats.needsKbUpdate}`));
      
      if (typedOptions.jobforge === true) {
        const jobs = results.map(result => 
          createTriageJob(
            tickets.find(t => t.id === result.ticket_id)!,
            {
              tenantId: typedOptions.tenant,
              projectId: typedOptions.project,
              priority: result.urgency === 'critical' ? 'critical' : 'normal',
            }
          )
        );
        
        console.log('\n' + formatJobForgeOutput(jobs, true));
        console.log('\n' + exportJobRequests(jobs));
      } else {
        console.log('\n' + JSON.stringify(results, null, 2));
      }
    } catch (error) {
      console.error(chalk.red('Error triaging tickets:'), error);
      process.exit(1);
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
  .action((options: unknown) => {
    const typedOptions = options as DraftOptions;
    try {
      console.log(chalk.blue('Drafting response for ticket:'), typedOptions.ticket);

      const triageData: unknown = JSON.parse(readFileSync(typedOptions.triage, 'utf-8'));
      const triageResult = validateTriageResult(
        Array.isArray(triageData)
          ? (triageData as unknown[]).find((t): t is Record<string, unknown> =>
              typeof t === 'object' && t !== null && 'ticket_id' in t && (t as Record<string, unknown>).ticket_id === typedOptions.ticket
            )
          : triageData
      );

      const kbData: unknown = JSON.parse(readFileSync(typedOptions.kb, 'utf-8'));
      const kbSources = validateKBSources(Array.isArray(kbData) ? kbData : [kbData]);
      const index = buildIndex(
        typedOptions.tenant,
        typedOptions.project,
        kbSources
      );

      const mockTicket: Ticket = {
        tenant_id: typedOptions.tenant,
        project_id: typedOptions.project,
        id: typedOptions.ticket,
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
        tone: typedOptions.tone as TonePreset,
        includeDisclaimer: true,
      });

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

      if (typedOptions.jobforge === true) {
        const job = createDraftReplyJob(
          mockTicket,
          triageResult,
          typedOptions.tone,
          {
            tenantId: typedOptions.tenant,
            projectId: typedOptions.project,
            priority: triageResult.urgency === 'critical' ? 'critical' : 'normal',
          }
        );

        console.log('\n' + formatJobForgeOutput([job], true));
        console.log('\n' + JSON.stringify(job, null, 2));
      } else {
        console.log('\n' + JSON.stringify(draft, null, 2));
      }
    } catch (error) {
      console.error(chalk.red('Error drafting response:'), error);
      process.exit(1);
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
  .action((options: unknown) => {
    const typedOptions = options as ProposeOptions;
    try {
      console.log(chalk.blue('Proposing KB patches from triage:'), typedOptions.fromTriage);

      const triageData: unknown = JSON.parse(readFileSync(typedOptions.fromTriage, 'utf-8'));
      const triageResults = Array.isArray(triageData) ? (triageData as unknown[]) : [triageData];
      
      const validatedResults = triageResults.map(r => validateTriageResult(r));
      const proposal = proposeKBPatch(validatedResults, {
        tenantId: typedOptions.tenant,
        projectId: typedOptions.project,
      });

      if (proposal === null || proposal === undefined) {
        console.log(chalk.yellow('No KB patch proposal generated'));
        return;
      }
      
      console.log(chalk.green('Proposed KB patch:'), proposal.proposed_title);
      console.log(chalk.green('Type:'), proposal.type);
      console.log(chalk.green('Related tickets:'), proposal.related_ticket_ids.length);
      
      console.log(chalk.cyan('\n--- PROPOSED CONTENT ---\n'));
      console.log(proposal.proposed_content);
      console.log(chalk.cyan('\n--- END PROPOSAL ---'));
      
      if (typedOptions.jobforge === true) {
        const job = createKBPatchJob(proposal, {
          tenantId: typedOptions.tenant,
          projectId: typedOptions.project,
        });
        
        console.log('\n' + formatJobForgeOutput([job], true));
        console.log('\n' + JSON.stringify(job, null, 2));
      } else {
        console.log('\n' + JSON.stringify(proposal, null, 2));
      }
    } catch (error) {
      console.error(chalk.red('Error proposing KB patch:'), error);
      process.exit(1);
    }
  });

program
  .command('redact')
  .description('Redact PII from ticket data')
  .argument('<tickets.json>', 'Path to JSON file containing tickets')
  .action((ticketsPath: string) => {
    try {
      console.log(chalk.blue('Redacting PII from:'), ticketsPath);

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
      
      console.log(chalk.green(`Redacted ${totalRedactions} PII instances from ${tickets.length} tickets`));
      console.log('\n' + JSON.stringify(redactedData, null, 2));
    } catch (error) {
      console.error(chalk.red('Error redacting PII:'), error);
      process.exit(1);
    }
  });

program
  .command('analyze')
  .description('Analyze inputs and emit JobForge-compatible outputs (request bundle + report)')
  .requiredOption('--inputs <path>', 'Path to JSON inputs')
  .requiredOption('--tenant <id>', 'Tenant ID')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--trace <id>', 'Trace ID')
  .requiredOption('--out <dir>', 'Output directory')
  .option('--stable-output', 'Emit deterministic outputs for fixtures/docs')
  .option('--no-markdown', 'Skip Markdown report')
  .action((options: unknown) => {
    const typedOptions = options as AnalyzeOptions;
    try {
      const inputsPath = resolve(typedOptions.inputs);
      const outputDir = resolve(typedOptions.out);

      const rawInputs: unknown = JSON.parse(readFileSync(inputsPath, 'utf-8'));
      const result = analyze(rawInputs as Record<string, unknown>, {
        tenantId: typedOptions.tenant,
        projectId: typedOptions.project,
        traceId: typedOptions.trace,
        stableOutput: typedOptions.stableOutput === true,
      });

      const validation = validateBundle(result.jobRequestBundle);
      if (!validation.valid) {
        console.error(chalk.red('Job request bundle validation failed'));
        validation.errors?.forEach(error => console.error(chalk.red(`- ${error}`)));
        process.exit(2);
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

      if (typedOptions.markdown !== false) {
        writeFileSync(
          resolve(outputDir, 'report.md'),
          renderReport(result.reportEnvelope, 'markdown') + '\n',
          'utf-8'
        );
      }

      console.log(chalk.green('JobForge outputs written to:'), outputDir);
    } catch (error) {
      if (error instanceof ZodError) {
        console.error(chalk.red('Validation error:'), error.issues.map(issue => issue.message).join('; '));
        process.exit(2);
      }

      const message = error instanceof Error ? error.message : 'Unexpected error';
      console.error(chalk.red('Unexpected error:'), message);
      process.exit(1);
    }
  });

program.parse();

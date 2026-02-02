#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'fs';
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
import { redactTicket } from './utils/pii.js';
import { loadProfile, getDefaultProfile } from './utils/profiles.js';

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
  .action(async (path, options) => {
    try {
      console.log(chalk.blue('Ingesting KB from:'), path);
      
      const stats = { ingested: 0, failed: 0, chunks: 0 };
      
      const ingestOptions = {
        tenantId: options.tenant,
        projectId: options.project,
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
  .action(async (ticketsPath, options) => {
    try {
      console.log(chalk.blue('Triaging tickets from:'), ticketsPath);
      
      const ticketsData = JSON.parse(readFileSync(ticketsPath, 'utf-8'));
      const tickets = validateTickets(Array.isArray(ticketsData) ? ticketsData : [ticketsData]);
      
      // Verify tenant/project match
      for (const ticket of tickets) {
        if (ticket.tenant_id !== options.tenant || ticket.project_id !== options.project) {
          console.error(chalk.red('Tenant/Project mismatch in ticket:'), ticket.id);
          process.exit(1);
        }
      }
      
      // Profile loaded for future use when LLM integration is added
      const profile = options.profile ? loadProfile(options.profile) : getDefaultProfile();
      void profile; // Mark as intentionally unused for now
      
      const { results, stats } = triageBatch(tickets);
      
      console.log(chalk.green(`Triaged ${stats.total} tickets`));
      console.log(chalk.yellow(`  Critical: ${stats.critical}`));
      console.log(chalk.yellow(`  High: ${stats.high}`));
      console.log(chalk.yellow(`  Medium: ${stats.medium}`));
      console.log(chalk.yellow(`  Low: ${stats.low}`));
      console.log(chalk.yellow(`  Needs human review: ${stats.needsHumanReview}`));
      console.log(chalk.yellow(`  Needs KB update: ${stats.needsKbUpdate}`));
      
      if (options.jobforge) {
        const jobs = results.map(result => 
          createTriageJob(
            tickets.find(t => t.id === result.ticket_id)!,
            {
              tenantId: options.tenant,
              projectId: options.project,
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
  .action(async (options) => {
    try {
      console.log(chalk.blue('Drafting response for ticket:'), options.ticket);
      
      const triageData = JSON.parse(readFileSync(options.triage, 'utf-8'));
      const triageResult = Array.isArray(triageData) 
        ? triageData.find(t => t.ticket_id === options.ticket)
        : triageData;
        
      if (!triageResult) {
        console.error(chalk.red('Triage result not found for ticket:'), options.ticket);
        process.exit(1);
      }
      
      const kbSources = JSON.parse(readFileSync(options.kb, 'utf-8'));
      const index = buildIndex(
        options.tenant,
        options.project,
        Array.isArray(kbSources) ? kbSources : [kbSources]
      );
      
      const mockTicket: Ticket = {
        tenant_id: options.tenant,
        project_id: options.project,
        id: options.ticket,
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
        tone: options.tone,
        includeDisclaimer: true,
      });
      
      console.log(chalk.green('Draft created with status:'), draft.status);
      
      if (draft.warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        draft.warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
      }
      
      if (draft.disclaimer) {
        console.log(chalk.cyan('\nDisclaimer:'), draft.disclaimer);
      }
      
      console.log(chalk.cyan('\n--- DRAFT RESPONSE ---\n'));
      console.log(draft.body);
      console.log(chalk.cyan('\n--- END DRAFT ---'));
      
      if (options.jobforge) {
        const job = createDraftReplyJob(
          mockTicket,
          triageResult,
          options.tone,
          {
            tenantId: options.tenant,
            projectId: options.project,
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
  .action(async (options) => {
    try {
      console.log(chalk.blue('Proposing KB patches from triage:'), options.fromTriage);
      
      const triageData = JSON.parse(readFileSync(options.fromTriage, 'utf-8'));
      const triageResults = Array.isArray(triageData) ? triageData : [triageData];
      
      const proposal = proposeKBPatch(triageResults, {
        tenantId: options.tenant,
        projectId: options.project,
      });
      
      if (!proposal) {
        console.log(chalk.yellow('No KB patch proposal generated'));
        return;
      }
      
      console.log(chalk.green('Proposed KB patch:'), proposal.proposed_title);
      console.log(chalk.green('Type:'), proposal.type);
      console.log(chalk.green('Related tickets:'), proposal.related_ticket_ids.length);
      
      console.log(chalk.cyan('\n--- PROPOSED CONTENT ---\n'));
      console.log(proposal.proposed_content);
      console.log(chalk.cyan('\n--- END PROPOSAL ---'));
      
      if (options.jobforge) {
        const job = createKBPatchJob(proposal, {
          tenantId: options.tenant,
          projectId: options.project,
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
  .action(async (ticketsPath) => {
    try {
      console.log(chalk.blue('Redacting PII from:'), ticketsPath);
      
      const ticketsData = JSON.parse(readFileSync(ticketsPath, 'utf-8'));
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

program.parse();

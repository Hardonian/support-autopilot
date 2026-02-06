#!/usr/bin/env node

/**
 * contracts:check — validates schemas, SDK exports, CLI entrypoints, and contract version drift.
 * Exits non-zero on any failure so CI catches drift.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

let failures = 0;
let passes = 0;

function pass(label) {
  passes++;
  console.log(`  \u2714 ${label}`);
}

function fail(label, detail) {
  failures++;
  console.error(`  \u2718 ${label}: ${detail}`);
}

function section(title) {
  console.log(`\n\u25B6 ${title}`);
}

// ---------------------------------------------------------------------------
// 0. Ensure build exists
// ---------------------------------------------------------------------------
section('Build check');
if (!existsSync(resolve(ROOT, 'dist/index.js'))) {
  console.log('  Building project...');
  execSync('pnpm run build', { cwd: ROOT, stdio: 'inherit' });
}
if (existsSync(resolve(ROOT, 'dist/index.js'))) {
  pass('dist/index.js exists');
} else {
  fail('dist/index.js', 'build output missing');
}

// ---------------------------------------------------------------------------
// 1. Contract version file
// ---------------------------------------------------------------------------
section('Contract version file');
const versionPath = resolve(ROOT, 'contracts/contracts.version.json');
if (existsSync(versionPath)) {
  try {
    const versionFile = JSON.parse(readFileSync(versionPath, 'utf-8'));
    if (versionFile.version && versionFile.schema_version && Array.isArray(versionFile.schemas)) {
      pass(`contracts.version.json v${versionFile.version} (schema ${versionFile.schema_version})`);
    } else {
      fail('contracts.version.json', 'missing required fields: version, schema_version, schemas');
    }
  } catch (e) {
    fail('contracts.version.json', `parse error: ${e.message}`);
  }
} else {
  fail('contracts.version.json', 'file not found');
}

// ---------------------------------------------------------------------------
// 2. Schema catalog
// ---------------------------------------------------------------------------
section('Schema catalog');
const catalogPath = resolve(ROOT, 'contracts/schema-catalog.json');
if (existsSync(catalogPath)) {
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
    const contractNames = Object.keys(catalog.contracts || {});
    if (contractNames.length > 0) {
      pass(`schema-catalog.json lists ${contractNames.length} contracts`);
    } else {
      fail('schema-catalog.json', 'no contracts defined');
    }
  } catch (e) {
    fail('schema-catalog.json', `parse error: ${e.message}`);
  }
} else {
  fail('schema-catalog.json', 'file not found');
}

// ---------------------------------------------------------------------------
// 3. Validate Zod schemas parse correctly (import from built dist)
// ---------------------------------------------------------------------------
section('Zod schema validation');

const sdk = await import(resolve(ROOT, 'dist/index.js'));

// Schema names and their corresponding Zod schema export names
const schemaExports = [
  'TenantContextSchema',
  'TicketSchema',
  'TriageResultSchema',
  'TriagePacketSchema',
  'DraftResponseSchema',
  'KBSourceSchema',
  'KBPatchProposalSchema',
  'EventEnvelopeSchema',
  'RunManifestSchema',
  'JobRequestSchema',
  'JobRequestBundleSchema',
  'ReportEnvelopeSchema',
  'FindingSchema',
  'ErrorEnvelopeSchema',
  'LogEventSchema',
];

for (const name of schemaExports) {
  if (sdk[name] && typeof sdk[name].parse === 'function') {
    pass(`${name} exported and has .parse()`);
  } else {
    fail(name, 'not exported or missing .parse()');
  }
}

// ---------------------------------------------------------------------------
// 4. Validate SDK public API exports
// ---------------------------------------------------------------------------
section('SDK public API surface');

const requiredExports = [
  // Validators
  'validateTenantContext',
  'validateTicket',
  'validateTickets',
  'validateTriageResult',
  'validateTriagePacket',
  'validateDraftResponse',
  'validateKBSource',
  'validateKBPatchProposal',
  'validateJobRequestBundle',
  'validateReportEnvelope',
  'validateLogEvent',
  // Factories
  'createEventEnvelope',
  'createRunManifest',
  'createJobRequest',
  'createJobRequestBundle',
  'createReportEnvelope',
  'createErrorEnvelope',
  'createLogEvent',
  // Utilities
  'stableHash',
  'serializeDeterministic',
  'canonicalizeForHash',
  'redactPII',
  // Constants
  'schema_version',
];

for (const name of requiredExports) {
  if (typeof sdk[name] === 'function' || typeof sdk[name] === 'string') {
    pass(`export ${name}`);
  } else {
    fail(`export ${name}`, `missing or wrong type (got ${typeof sdk[name]})`);
  }
}

// ---------------------------------------------------------------------------
// 5. Version alignment — schema_version in code matches contracts.version.json
// ---------------------------------------------------------------------------
section('Version alignment');
try {
  const versionFile = JSON.parse(readFileSync(versionPath, 'utf-8'));
  if (sdk.schema_version === versionFile.schema_version) {
    pass(`schema_version "${sdk.schema_version}" matches contracts.version.json`);
  } else {
    fail('schema_version', `code="${sdk.schema_version}" vs file="${versionFile.schema_version}"`);
  }
} catch (e) {
  fail('schema_version check', e.message);
}

// ---------------------------------------------------------------------------
// 6. Catalog ↔ version file schema list alignment
// ---------------------------------------------------------------------------
section('Catalog alignment');
try {
  const versionFile = JSON.parse(readFileSync(versionPath, 'utf-8'));
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
  const versionSchemas = new Set(versionFile.schemas);
  const catalogSchemas = new Set(Object.keys(catalog.contracts));

  const missingInCatalog = [...versionSchemas].filter(s => !catalogSchemas.has(s));
  const missingInVersion = [...catalogSchemas].filter(s => !versionSchemas.has(s));

  if (missingInCatalog.length === 0 && missingInVersion.length === 0) {
    pass('version file and catalog are in sync');
  } else {
    if (missingInCatalog.length > 0) {
      fail('catalog sync', `missing from catalog: ${missingInCatalog.join(', ')}`);
    }
    if (missingInVersion.length > 0) {
      fail('version sync', `missing from version file: ${missingInVersion.join(', ')}`);
    }
  }
} catch (e) {
  fail('catalog alignment', e.message);
}

// ---------------------------------------------------------------------------
// 7. CLI entrypoints
// ---------------------------------------------------------------------------
section('CLI entrypoints');

const cliPath = resolve(ROOT, 'dist/cli.js');
if (existsSync(cliPath)) {
  pass('dist/cli.js exists');
} else {
  fail('dist/cli.js', 'file not found');
}

const cliCommands = ['--help', 'plan --help', 'run --help', 'triage --help', 'draft --help', 'ingest-kb --help', 'propose-kb --help', 'redact --help', 'analyze --help'];

for (const cmd of cliCommands) {
  try {
    execSync(`node ${cliPath} ${cmd}`, { cwd: ROOT, stdio: 'pipe', timeout: 10000 });
    pass(`cli ${cmd}`);
  } catch (e) {
    fail(`cli ${cmd}`, e.message.split('\n')[0]);
  }
}

// ---------------------------------------------------------------------------
// 8. Fixture snapshot (delegates to contracts:compat)
// ---------------------------------------------------------------------------
section('Fixture compatibility');
try {
  execSync('node scripts/contracts-compat.mjs', { cwd: ROOT, stdio: 'pipe', timeout: 30000 });
  pass('contracts:compat snapshots match');
} catch (e) {
  fail('contracts:compat', e.message.split('\n')[0]);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`contracts:check — ${passes} passed, ${failures} failed`);
console.log('='.repeat(60));

if (failures > 0) {
  process.exit(1);
}

console.log('\ncontracts:check completed successfully.');

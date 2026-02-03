import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyze,
  JobRequestBundleSchema,
  ReportEnvelopeSchema,
  renderReport,
  serializeDeterministic,
  stableHash,
  validateBundle,
} from '../dist/index.js';

function ensureBuild() {
  if (!existsSync(resolve('dist/index.js'))) {
    execSync('pnpm run build', { stdio: 'inherit' });
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`Snapshot mismatch for ${label}`);
  }
}

function assertHashMatches(payload, label) {
  const { hash, ...rest } = payload;
  const expected = stableHash(rest);
  if (hash.canonical_json_hash !== expected) {
    throw new Error(`Canonical hash mismatch for ${label}`);
  }
}

ensureBuild();

const inputsPath = resolve('fixtures/jobforge/inputs/minimal.json');
const inputs = readJson(inputsPath);
const tenantId = inputs.tenant_id;
const projectId = inputs.project_id;
const traceId = inputs.trace_id;

if (!tenantId || !projectId || !traceId) {
  throw new Error('Fixtures inputs must include tenant_id, project_id, and trace_id');
}

const { reportEnvelope, jobRequestBundle } = analyze(inputs, {
  tenantId,
  projectId,
  traceId,
  stableOutput: true,
});

const expectedBundlePath = resolve('fixtures/jobforge/request-bundle.json');
const expectedReportPath = resolve('fixtures/jobforge/report.json');
const expectedReportMdPath = resolve('fixtures/jobforge/report.md');

const expectedBundle = readJson(expectedBundlePath);
const expectedReport = readJson(expectedReportPath);
const expectedReportMd = readFileSync(expectedReportMdPath, 'utf-8');

const bundleOutput = serializeDeterministic(jobRequestBundle) + '\n';
const reportOutput = serializeDeterministic(reportEnvelope) + '\n';
const reportMdOutput = renderReport(reportEnvelope, 'markdown') + '\n';

assertEqual(bundleOutput, serializeDeterministic(expectedBundle) + '\n', 'request-bundle.json');
assertEqual(reportOutput, serializeDeterministic(expectedReport) + '\n', 'report.json');
assertEqual(reportMdOutput, expectedReportMd, 'report.md');

JobRequestBundleSchema.parse(expectedBundle);
ReportEnvelopeSchema.parse(expectedReport);

const validation = validateBundle(expectedBundle);
if (!validation.valid) {
  throw new Error(`Bundle validation failed: ${(validation.errors ?? []).join(', ')}`);
}

assertHashMatches(expectedBundle, 'request-bundle.json');
assertHashMatches(expectedReport, 'report.json');

console.log('contracts:compat completed successfully.');

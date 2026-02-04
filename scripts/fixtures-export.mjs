import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyze, renderMetrics, renderReport, serializeDeterministic, validateBundle } from '../dist/index.js';

function ensureBuild() {
  if (!existsSync(resolve('dist/index.js'))) {
    execSync('pnpm run build', { stdio: 'inherit' });
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
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
const validation = validateBundle(jobRequestBundle);

const fixturesDir = resolve('fixtures/jobforge');
mkdirSync(fixturesDir, { recursive: true });

writeFileSync(resolve(fixturesDir, 'request-bundle.json'), serializeDeterministic(jobRequestBundle) + '\n', 'utf-8');
writeFileSync(resolve(fixturesDir, 'report.json'), serializeDeterministic(reportEnvelope) + '\n', 'utf-8');
writeFileSync(resolve(fixturesDir, 'report.md'), renderReport(reportEnvelope, 'markdown') + '\n', 'utf-8');
writeFileSync(
  resolve(fixturesDir, 'metrics.prom'),
  renderMetrics({ jobRequestBundle, reportEnvelope, validation }) + '\n',
  'utf-8'
);

console.log('fixtures:export completed successfully.');

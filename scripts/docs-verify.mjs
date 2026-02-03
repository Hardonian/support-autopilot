import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

function readFile(path) {
  return readFileSync(path, 'utf-8');
}

function assertEqual(actualPath, expectedPath) {
  const actual = readFile(actualPath);
  const expected = readFile(expectedPath);
  if (actual !== expected) {
    throw new Error(`Output mismatch for ${actualPath}`);
  }
}

const tempDir = resolve('.tmp/docs-verify');
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

run('node dist/cli.js --help');
run('node dist/cli.js analyze --help');

run([
  'node dist/cli.js analyze',
  '--inputs examples/jobforge/input.json',
  '--tenant tenant_001',
  '--project proj_jobforge',
  '--trace trace_fixture',
  `--out ${tempDir}`,
  '--stable-output',
].join(' '));

const expectedDir = resolve('examples/jobforge/output');
assertEqual(resolve(tempDir, 'request-bundle.json'), resolve(expectedDir, 'request-bundle.json'));
assertEqual(resolve(tempDir, 'report.json'), resolve(expectedDir, 'report.json'));
assertEqual(resolve(tempDir, 'report.md'), resolve(expectedDir, 'report.md'));

run('node scripts/generate-cli-docs.mjs');
run('git diff --exit-code README.md docs/cli.md');

console.log('docs:verify completed successfully.');

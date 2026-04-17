import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const tempDir = resolve('.tmp/docs-verify');
rmSync(tempDir, { recursive: true, force: true });
mkdirSync(tempDir, { recursive: true });

execSync([
  'node dist/cli.js analyze',
  '--inputs examples/jobforge/input.json',
  '--tenant tenant_001',
  '--project proj_jobforge',
  '--trace trace_fixture',
  `--out ${tempDir}`,
  '--stable-output',
].join(' '), { stdio: 'inherit' });

#!/usr/bin/env node

/**
 * doctor — verifies environment, prerequisites, and safety invariants.
 * Non-interactive; exits non-zero on any failure.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

let failures = 0;
let warnings = 0;
let passes = 0;

function pass(label) {
  passes++;
  console.log(`  \u2714 ${label}`);
}

function warn(label, detail) {
  warnings++;
  console.log(`  \u26A0 ${label}: ${detail}`);
}

function fail(label, detail, remediation) {
  failures++;
  console.error(`  \u2718 ${label}: ${detail}`);
  if (remediation) {
    console.error(`    \u2192 Fix: ${remediation}`);
  }
}

function section(title) {
  console.log(`\n\u25B6 ${title}`);
}

// ---------------------------------------------------------------------------
// 1. Node.js version
// ---------------------------------------------------------------------------
section('Node.js');

const nodeVersion = process.version;
const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);

if (major >= 20) {
  pass(`Node.js ${nodeVersion} (>= 20 required)`);
} else {
  fail('Node.js version', `${nodeVersion} is below minimum 20.x`, 'Install Node.js >= 20.0.0 via nvm or fnm');
}

// ---------------------------------------------------------------------------
// 2. Package manager (pnpm)
// ---------------------------------------------------------------------------
section('Package manager');

try {
  const pnpmVersion = execSync('pnpm --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const pnpmMajor = parseInt(pnpmVersion.split('.')[0], 10);
  if (pnpmMajor >= 9) {
    pass(`pnpm ${pnpmVersion} (>= 9 required)`);
  } else {
    fail('pnpm version', `${pnpmVersion} is below minimum 9.x`, 'Run: corepack enable && corepack prepare pnpm@9 --activate');
  }
} catch {
  fail('pnpm', 'not found', 'Install pnpm: corepack enable && corepack prepare pnpm@latest --activate');
}

// ---------------------------------------------------------------------------
// 3. Dependencies installed
// ---------------------------------------------------------------------------
section('Dependencies');

const nodeModulesPath = resolve(ROOT, 'node_modules');
if (existsSync(nodeModulesPath)) {
  pass('node_modules present');
} else {
  fail('node_modules', 'not found', 'Run: pnpm install');
}

const lockfilePath = resolve(ROOT, 'pnpm-lock.yaml');
if (existsSync(lockfilePath)) {
  pass('pnpm-lock.yaml present');
} else {
  fail('pnpm-lock.yaml', 'not found', 'Run: pnpm install to generate lockfile');
}

// ---------------------------------------------------------------------------
// 4. TypeScript compiler
// ---------------------------------------------------------------------------
section('TypeScript');

try {
  const tscVersion = execSync('npx tsc --version', { encoding: 'utf-8', cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  pass(`TypeScript ${tscVersion}`);
} catch {
  fail('TypeScript', 'tsc not available', 'Run: pnpm install');
}

if (existsSync(resolve(ROOT, 'tsconfig.json'))) {
  pass('tsconfig.json present');
} else {
  fail('tsconfig.json', 'not found', 'Create tsconfig.json in project root');
}

// ---------------------------------------------------------------------------
// 5. Build output
// ---------------------------------------------------------------------------
section('Build output');

const requiredDist = ['dist/index.js', 'dist/index.d.ts', 'dist/cli.js'];
for (const f of requiredDist) {
  if (existsSync(resolve(ROOT, f))) {
    pass(f);
  } else {
    fail(f, 'not found', 'Run: pnpm run build');
  }
}

// ---------------------------------------------------------------------------
// 6. Contract files
// ---------------------------------------------------------------------------
section('Contract files');

const contractFiles = [
  'contracts/contracts.version.json',
  'contracts/schema-catalog.json',
  'src/contracts/tenant.ts',
  'src/contracts/ticket.ts',
  'src/contracts/triage-result.ts',
  'src/contracts/triage-packet.ts',
  'src/contracts/draft-response.ts',
  'src/contracts/kb-source.ts',
  'src/contracts/kb-patch.ts',
  'src/contracts/compat.ts',
  'src/contracts/log-event.ts',
  'src/contracts/index.ts',
];

for (const f of contractFiles) {
  if (existsSync(resolve(ROOT, f))) {
    pass(f);
  } else {
    fail(f, 'not found', `Contract file missing — check src/contracts/`);
  }
}

// ---------------------------------------------------------------------------
// 7. Secret leakage check
// ---------------------------------------------------------------------------
section('Secret leakage scan');

const secretPatterns = [
  { name: 'AWS key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'Private key header', pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g },
  { name: 'Bearer token (hardcoded)', pattern: /["']Bearer\s+[A-Za-z0-9\-._~+/]+=*["']/g },
  { name: 'Generic secret assignment', pattern: /(password|secret|api_key|apikey)\s*[:=]\s*["'][^"']{8,}["']/gi },
];

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const hits = [];
  for (const { name, pattern } of secretPatterns) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    if (pattern.test(content)) {
      hits.push(name);
    }
  }
  return hits;
}

function scanDirectory(dir, extensions) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'coverage') continue;
    const fullPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      results.push(...scanDirectory(fullPath, extensions));
    } else if (entry.endsWith('.test.ts') || entry.endsWith('.test.js') || entry.endsWith('.spec.ts') || entry.endsWith('.spec.js')) {
      // Skip test files — they intentionally contain fake secrets as fixtures
      continue;
    } else if (extensions.some(ext => entry.endsWith(ext))) {
      const hits = scanFile(fullPath);
      if (hits.length > 0) {
        results.push({ file: fullPath.replace(ROOT + '/', ''), types: hits });
      }
    }
  }
  return results;
}

const scanResults = scanDirectory(ROOT, ['.ts', '.mjs', '.js', '.json', '.env']);

if (scanResults.length === 0) {
  pass('No secret leakage patterns detected');
} else {
  for (const { file, types } of scanResults) {
    fail('secret leakage', `${file} contains: ${types.join(', ')}`, 'Remove hardcoded secrets and use environment variables');
  }
}

// ---------------------------------------------------------------------------
// 8. .env file check
// ---------------------------------------------------------------------------
section('Environment files');

const envFiles = ['.env', '.env.local', '.env.production'];
for (const f of envFiles) {
  if (existsSync(resolve(ROOT, f))) {
    // Check if it's gitignored
    try {
      execSync(`git check-ignore ${f}`, { cwd: ROOT, stdio: 'pipe' });
      pass(`${f} exists and is gitignored`);
    } catch {
      warn(f, 'exists but is NOT gitignored — verify it does not contain secrets');
    }
  }
}

// No .env files is fine
if (!envFiles.some(f => existsSync(resolve(ROOT, f)))) {
  pass('No .env files present (secrets should use env vars at runtime)');
}

// ---------------------------------------------------------------------------
// 9. Required scripts in package.json
// ---------------------------------------------------------------------------
section('Package scripts');

const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
const requiredScripts = [
  'build',
  'lint',
  'typecheck',
  'test',
  'contracts:check',
  'doctor',
  'plan',
  'run:smoke',
];

for (const script of requiredScripts) {
  if (pkg.scripts && pkg.scripts[script]) {
    pass(`script "${script}"`);
  } else {
    fail(`script "${script}"`, 'not defined in package.json', `Add "${script}" to scripts in package.json`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`doctor — ${passes} passed, ${warnings} warnings, ${failures} failed`);
console.log('='.repeat(60));

if (failures > 0) {
  console.error('\nDoctor found issues. See remediation steps above.');
  process.exit(1);
}

if (warnings > 0) {
  console.log('\nDoctor passed with warnings.');
} else {
  console.log('\ndoctor completed successfully.');
}

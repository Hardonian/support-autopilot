import { describe, expect, it } from 'vitest';
import { analyze, renderReport, validateBundle } from './integration.js';
import { stableHash } from '../utils/deterministic.js';
import type { JobRequestBundle, ReportEnvelope } from '../contracts/compat.js';

function stripHash<T extends { hash: unknown }>(value: T): Omit<T, 'hash'> {
  const { hash: _hash, ...rest } = value;
  return rest;
}

describe('jobforge integration', () => {
  it('builds deterministic bundle and report', () => {
    const inputs = {
      tickets: [
        {
          tenant_id: 'tenant_001',
          project_id: 'proj_jobforge',
          id: 'ticket_001',
          subject: 'Reset password',
          body: 'I cannot reset my password.',
          status: 'open',
          priority: 'medium',
          created_at: '2024-01-01T00:00:00.000Z',
          tags: [],
          metadata: {},
        },
      ],
    };

    const result = analyze(inputs, {
      tenantId: 'tenant_001',
      projectId: 'proj_jobforge',
      traceId: 'trace_abc',
      stableOutput: true,
    });

    const bundle = result.jobRequestBundle as JobRequestBundle;
    const report = result.reportEnvelope as ReportEnvelope;

    expect(validateBundle(bundle).valid).toBe(true);
    expect(bundle.hash.canonical_json_hash).toBe(stableHash(stripHash(bundle)));
    expect(report.hash.canonical_json_hash).toBe(stableHash(stripHash(report)));
  });

  it('renders markdown report', () => {
    const inputs = {
      tickets: [],
    };

    const result = analyze(inputs, {
      tenantId: 'tenant_001',
      projectId: 'proj_jobforge',
      traceId: 'trace_abc',
      stableOutput: true,
    });

    const markdown = renderReport(result.reportEnvelope, 'markdown');
    expect(markdown).toContain('# Support Autopilot Report');
    expect(markdown).toContain('## Findings');
  });

  it('reuses idempotency keys across retries', () => {
    const inputs = {
      tickets: [
        {
          tenant_id: 'tenant_001',
          project_id: 'proj_jobforge',
          id: 'ticket_002',
          subject: 'Billing issue',
          body: 'I was charged twice.',
          status: 'open',
          priority: 'high',
          created_at: '2024-01-02T00:00:00.000Z',
          tags: [],
          metadata: {},
        },
      ],
    };

    const first = analyze(inputs, {
      tenantId: 'tenant_001',
      projectId: 'proj_jobforge',
      traceId: 'trace_retry',
      now: new Date('2024-02-01T00:00:00.000Z'),
    });

    const second = analyze(inputs, {
      tenantId: 'tenant_001',
      projectId: 'proj_jobforge',
      traceId: 'trace_retry',
      now: new Date('2024-02-02T00:00:00.000Z'),
    });

    expect(first.jobRequestBundle.jobs[0].idempotency_key)
      .toBe(second.jobRequestBundle.jobs[0].idempotency_key);
  });

  it('flags missing finops metadata as a cost risk', () => {
    const inputs = {
      tickets: [
        {
          tenant_id: 'tenant_001',
          project_id: 'proj_jobforge',
          id: 'ticket_003',
          subject: 'API timeout',
          body: 'The API keeps timing out.',
          status: 'open',
          priority: 'low',
          created_at: '2024-01-03T00:00:00.000Z',
          tags: [],
          metadata: {},
        },
      ],
    };

    const result = analyze(inputs, {
      tenantId: 'tenant_001',
      projectId: 'proj_jobforge',
      traceId: 'trace_finops',
      stableOutput: true,
    });

    const mutated = JSON.parse(JSON.stringify(result.jobRequestBundle)) as JobRequestBundle;
    mutated.jobs[0].metadata = {};

    const validation = validateBundle(mutated);
    expect(validation.valid).toBe(false);
    expect(validation.errors?.some(error => error.includes('missing finops'))).toBe(true);
  });
});

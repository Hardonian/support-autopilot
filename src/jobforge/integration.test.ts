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
});

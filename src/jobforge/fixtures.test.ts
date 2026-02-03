import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateBundle } from './integration.js';
import { JobRequestBundleSchema, ReportEnvelopeSchema } from '../contracts/compat.js';

const fixtureRoot = resolve('fixtures/jobforge');

describe('jobforge fixtures', () => {
  it('validates positive fixtures', () => {
    const bundle = JSON.parse(readFileSync(resolve(fixtureRoot, 'request-bundle.json'), 'utf-8'));
    const report = JSON.parse(readFileSync(resolve(fixtureRoot, 'report.json'), 'utf-8'));

    expect(JobRequestBundleSchema.safeParse(bundle).success).toBe(true);
    expect(ReportEnvelopeSchema.safeParse(report).success).toBe(true);
    expect(validateBundle(bundle).valid).toBe(true);
  });

  it('rejects negative fixtures', () => {
    const negativeFixtures = [
      'negative/missing-tenant.json',
      'negative/wrong-schema-version.json',
      'negative/missing-idempotency.json',
      'negative/action-without-policy.json',
      'negative/missing-project.json',
    ];

    for (const fixture of negativeFixtures) {
      const data = JSON.parse(readFileSync(resolve(fixtureRoot, fixture), 'utf-8'));
      const result = validateBundle(data);
      expect(result.valid).toBe(false);
    }
  });
});

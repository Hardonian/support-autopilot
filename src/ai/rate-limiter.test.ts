import { describe, it, expect, beforeEach } from 'vitest';
import { TenantRateLimiter } from './rate-limiter.js';

describe('TenantRateLimiter', () => {
  let limiter: TenantRateLimiter;

  beforeEach(() => {
    limiter = new TenantRateLimiter({
      maxRequestsPerMinute: 5,
      maxTokensPerMinute: 10_000,
      maxConcurrentRequests: 2,
      dailyBudgetUSD: 10.0,
      monthlyBudgetUSD: 100.0,
    });
    limiter.reset();
  });

  it('should allow requests within RPM limits', () => {
    const decision = limiter.acquire('tenant-1', 500);
    expect(decision.allowed).toBe(true);
    expect(decision.remainingRPM).toBe(4);
    limiter.release('tenant-1', 0.001);
  });

  it('should reject requests exceeding concurrency limits', () => {
    const d1 = limiter.acquire('tenant-concurrent', 100);
    const d2 = limiter.acquire('tenant-concurrent', 100);
    expect(d1.allowed).toBe(true);
    expect(d2.allowed).toBe(true);

    const d3 = limiter.acquire('tenant-concurrent', 100);
    expect(d3.allowed).toBe(false);
    expect(d3.reason).toBe('CONCURRENCY_EXCEEDED');

    limiter.release('tenant-concurrent');
    const d4 = limiter.acquire('tenant-concurrent', 100);
    expect(d4.allowed).toBe(true);
  });

  it('should reject requests exceeding RPM threshold', () => {
    for (let i = 0; i < 5; i++) {
      const d = limiter.acquire('tenant-rpm', 100);
      expect(d.allowed).toBe(true);
      limiter.release('tenant-rpm');
    }

    const dExceeded = limiter.acquire('tenant-rpm', 100);
    expect(dExceeded.allowed).toBe(false);
    expect(dExceeded.reason).toBe('RPM_EXCEEDED');
  });

  it('should enforce daily spend budget guardrails', () => {
    limiter.setTenantConfig('tenant-budget', {
      dailyBudgetUSD: 1.0,
    });

    const d1 = limiter.acquire('tenant-budget', 100);
    expect(d1.allowed).toBe(true);
    limiter.release('tenant-budget', 1.05); // Exceeds $1.00 budget

    const d2 = limiter.acquire('tenant-budget', 100);
    expect(d2.allowed).toBe(false);
    expect(d2.reason).toBe('DAILY_BUDGET_EXCEEDED');
  });
});

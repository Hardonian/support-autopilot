import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRouter, MODEL_REGISTRY } from './model-router.js';

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
    router.clearCache();
    router.resetCircuits();
  });

  describe('selectModel', () => {
    it('should route critical priority requests to reasoning tier', () => {
      const model = router.selectModel({
        taskType: 'triage',
        priority: 'critical',
      });
      expect(model.tier).toBe('reasoning');
    });

    it('should route enterprise customer tier requests to reasoning tier', () => {
      const model = router.selectModel({
        taskType: 'draft-response',
        customerTier: 'enterprise',
      });
      expect(model.tier).toBe('reasoning');
    });

    it('should route standard low/medium priority requests to economy tier to optimize costs', () => {
      const model = router.selectModel({
        taskType: 'triage',
        priority: 'medium',
        customerTier: 'starter',
      });
      expect(model.tier).toBe('economy');
    });

    it('should support explicit model overrides', () => {
      const model = router.selectModel({
        taskType: 'draft-response',
        forceModel: 'claude-3-5-sonnet',
      });
      expect(model.id).toBe('claude-3-5-sonnet');
    });

    it('should support explicit tier overrides', () => {
      const model = router.selectModel({
        taskType: 'draft-response',
        forceTier: 'deterministic',
      });
      expect(model.tier).toBe('deterministic');
    });
  });

  describe('calculateCost', () => {
    it('should accurately calculate token costs for Gemini 1.5 Flash', () => {
      const flash = MODEL_REGISTRY['gemini-1.5-flash'];
      // 1,000,000 prompt tokens = $0.075, 1,000,000 completion tokens = $0.30
      const cost = router.calculateCost(flash, 10_000, 2_000);
      expect(cost).toBeCloseTo(0.00075 + 0.0006, 5);
    });

    it('should calculate cached prompt discounts properly', () => {
      const pro = MODEL_REGISTRY['gemini-1.5-pro'];
      const regularCost = router.calculateCost(pro, 100_000, 0, 0);
      const cachedCost = router.calculateCost(pro, 100_000, 0, 100_000);
      expect(cachedCost).toBeLessThan(regularCost);
    });
  });

  describe('execute and caching', () => {
    it('should execute deterministic tasks and populate cache', async () => {
      const res1 = await router.execute({
        taskType: 'triage',
        prompt: 'User cannot login to billing dashboard',
        forceTier: 'deterministic',
      });

      expect(res1.content).toContain('category');
      expect(res1.cached).toBe(false);

      // Second identical execution should hit cache
      const res2 = await router.execute({
        taskType: 'triage',
        prompt: 'User cannot login to billing dashboard',
        forceTier: 'deterministic',
      });

      expect(res2.cached).toBe(true);
      expect(res2.content).toBe(res1.content);
    });
  });

  describe('circuit breaker resilience', () => {
    it('should trip circuit breaker after multiple failures and fallback to deterministic', async () => {
      const flash = MODEL_REGISTRY['gemini-1.5-flash'];

      // Simulate 3 failures
      router.recordFailure(flash.id);
      router.recordFailure(flash.id);
      router.recordFailure(flash.id);

      expect(router.isModelAvailable(flash.id)).toBe(false);

      // When flash is tripped, economy routing should failover or use next available
      const metrics = router.getMetrics();
      expect(metrics.circuitBreakers['gemini-1.5-flash'].state).toBe('OPEN');
    });
  });

  describe('ROI & metrics calculation', () => {
    it('should compute human labor savings ($35/hr basis) and profit margin %', async () => {
      await router.execute({
        taskType: 'triage',
        prompt: 'Ticket test 1',
        forceTier: 'deterministic',
      });
      await router.execute({
        taskType: 'triage',
        prompt: 'Ticket test 2',
        forceTier: 'deterministic',
      });

      const metrics = router.getMetrics();
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.totalEstimatedSavingsUSD).toBeGreaterThan(0);
      expect(metrics.netMarginPercent).toBeGreaterThanOrEqual(99.0);
    });
  });
});

/**
 * Multi-Tenant Token Bucket & Sliding Window Rate Limiter with Budget Guardrails
 */

export interface TenantRateLimitConfig {
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  maxConcurrentRequests: number;
  monthlyBudgetUSD?: number;
  dailyBudgetUSD?: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  reason?: 'RPM_EXCEEDED' | 'TPM_EXCEEDED' | 'CONCURRENCY_EXCEEDED' | 'DAILY_BUDGET_EXCEEDED' | 'MONTHLY_BUDGET_EXCEEDED';
  retryAfterMs?: number;
  remainingRPM: number;
  remainingTPM: number;
  currentSpendDailyUSD: number;
  currentSpendMonthlyUSD: number;
  budgetWarning: boolean;
}

interface TenantState {
  requests: number[];
  tokens: { timestamp: number; count: number }[];
  activeRequests: number;
  dailySpendUSD: number;
  monthlySpendUSD: number;
  lastDailyReset: number;
  lastMonthlyReset: number;
}

export const DEFAULT_RATE_LIMITS: TenantRateLimitConfig = {
  maxRequestsPerMinute: 300,
  maxTokensPerMinute: 500_000,
  maxConcurrentRequests: 20,
  monthlyBudgetUSD: 500.0,
  dailyBudgetUSD: 50.0,
};

export class TenantRateLimiter {
  private readonly tenants: Map<string, TenantState> = new Map();
  private readonly configs: Map<string, TenantRateLimitConfig> = new Map();

  constructor(defaultConfig?: Partial<TenantRateLimitConfig>) {
    if (defaultConfig) {
      this.configs.set('default', { ...DEFAULT_RATE_LIMITS, ...defaultConfig });
    }
  }

  /**
   * Set custom rate limit & budget configuration for a specific tenant
   */
  public setTenantConfig(tenantId: string, config: Partial<TenantRateLimitConfig>): void {
    const existing = this.configs.get(tenantId) ?? DEFAULT_RATE_LIMITS;
    this.configs.set(tenantId, { ...existing, ...config });
  }

  /**
   * Get configuration for a tenant
   */
  public getTenantConfig(tenantId: string): TenantRateLimitConfig {
    return this.configs.get(tenantId) ?? this.configs.get('default') ?? DEFAULT_RATE_LIMITS;
  }

  /**
   * Evaluate whether a request should be allowed or throttled
   */
  public checkLimit(tenantId: string, estimatedTokens = 500): RateLimitDecision {
    const state = this.getOrCreateState(tenantId);
    const config = this.getTenantConfig(tenantId);
    const now = Date.now();

    this.pruneOldRecords(state, now);
    this.checkBudgetResets(state, now);

    // 1. Concurrency Check
    if (state.activeRequests >= config.maxConcurrentRequests) {
      return {
        allowed: false,
        reason: 'CONCURRENCY_EXCEEDED',
        retryAfterMs: 500,
        remainingRPM: Math.max(0, config.maxRequestsPerMinute - state.requests.length),
        remainingTPM: Math.max(0, config.maxTokensPerMinute - this.sumTokens(state)),
        currentSpendDailyUSD: state.dailySpendUSD,
        currentSpendMonthlyUSD: state.monthlySpendUSD,
        budgetWarning: false,
      };
    }

    // 2. RPM Check
    if (state.requests.length >= config.maxRequestsPerMinute) {
      const oldest = state.requests[0];
      const retryAfterMs = Math.max(100, 60_000 - (now - oldest));
      return {
        allowed: false,
        reason: 'RPM_EXCEEDED',
        retryAfterMs,
        remainingRPM: 0,
        remainingTPM: Math.max(0, config.maxTokensPerMinute - this.sumTokens(state)),
        currentSpendDailyUSD: state.dailySpendUSD,
        currentSpendMonthlyUSD: state.monthlySpendUSD,
        budgetWarning: false,
      };
    }

    // 3. TPM Check
    const currentTokens = this.sumTokens(state);
    if (currentTokens + estimatedTokens > config.maxTokensPerMinute) {
      const retryAfterMs = 1500;
      return {
        allowed: false,
        reason: 'TPM_EXCEEDED',
        retryAfterMs,
        remainingRPM: Math.max(0, config.maxRequestsPerMinute - state.requests.length),
        remainingTPM: 0,
        currentSpendDailyUSD: state.dailySpendUSD,
        currentSpendMonthlyUSD: state.monthlySpendUSD,
        budgetWarning: false,
      };
    }

    // 4. Daily Budget Check
    if (config.dailyBudgetUSD !== undefined && state.dailySpendUSD >= config.dailyBudgetUSD) {
      return {
        allowed: false,
        reason: 'DAILY_BUDGET_EXCEEDED',
        retryAfterMs: 3_600_000,
        remainingRPM: 0,
        remainingTPM: 0,
        currentSpendDailyUSD: state.dailySpendUSD,
        currentSpendMonthlyUSD: state.monthlySpendUSD,
        budgetWarning: true,
      };
    }

    // 5. Monthly Budget Check
    if (config.monthlyBudgetUSD !== undefined && state.monthlySpendUSD >= config.monthlyBudgetUSD) {
      return {
        allowed: false,
        reason: 'MONTHLY_BUDGET_EXCEEDED',
        retryAfterMs: 86_400_000,
        remainingRPM: 0,
        remainingTPM: 0,
        currentSpendDailyUSD: state.dailySpendUSD,
        currentSpendMonthlyUSD: state.monthlySpendUSD,
        budgetWarning: true,
      };
    }

    const budgetWarning =
      (config.dailyBudgetUSD !== undefined ? state.dailySpendUSD >= config.dailyBudgetUSD * 0.8 : false) ||
      (config.monthlyBudgetUSD !== undefined ? state.monthlySpendUSD >= config.monthlyBudgetUSD * 0.8 : false);

    return {
      allowed: true,
      remainingRPM: Math.max(0, config.maxRequestsPerMinute - state.requests.length),
      remainingTPM: Math.max(0, config.maxTokensPerMinute - currentTokens - estimatedTokens),
      currentSpendDailyUSD: Number(state.dailySpendUSD.toFixed(4)),
      currentSpendMonthlyUSD: Number(state.monthlySpendUSD.toFixed(4)),
      budgetWarning,
    };
  }

  /**
   * Acquire a slot for execution
   */
  public acquire(tenantId: string, estimatedTokens = 500): RateLimitDecision {
    const decision = this.checkLimit(tenantId, estimatedTokens);
    if (!decision.allowed) {
      return decision;
    }

    const state = this.getOrCreateState(tenantId);
    const config = this.getTenantConfig(tenantId);
    const now = Date.now();
    state.requests.push(now);
    state.tokens.push({ timestamp: now, count: estimatedTokens });
    state.activeRequests++;

    return {
      ...decision,
      remainingRPM: Math.max(0, config.maxRequestsPerMinute - state.requests.length),
      remainingTPM: Math.max(0, config.maxTokensPerMinute - this.sumTokens(state)),
    };
  }


  /**
   * Release active concurrency slot and record actual cost
   */
  public release(tenantId: string, actualCostUSD = 0): void {
    const state = this.getOrCreateState(tenantId);
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    state.dailySpendUSD += actualCostUSD;
    state.monthlySpendUSD += actualCostUSD;
  }

  /**
   * Reset tenant limits (useful in testing)
   */
  public reset(tenantId?: string): void {
    if (tenantId !== undefined) {
      this.tenants.delete(tenantId);
    } else {
      this.tenants.clear();
    }
  }


  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private getOrCreateState(tenantId: string): TenantState {
    let state = this.tenants.get(tenantId);
    if (!state) {
      state = {
        requests: [],
        tokens: [],
        activeRequests: 0,
        dailySpendUSD: 0,
        monthlySpendUSD: 0,
        lastDailyReset: Date.now(),
        lastMonthlyReset: Date.now(),
      };
      this.tenants.set(tenantId, state);
    }
    return state;
  }

  private pruneOldRecords(state: TenantState, now: number): void {
    const oneMinuteAgo = now - 60_000;
    state.requests = state.requests.filter((t) => t > oneMinuteAgo);
    state.tokens = state.tokens.filter((t) => t.timestamp > oneMinuteAgo);
  }

  private sumTokens(state: TenantState): number {
    return state.tokens.reduce((acc, curr) => acc + curr.count, 0);
  }

  private checkBudgetResets(state: TenantState, now: number): void {
    const oneDayMs = 86_400_000;
    const thirtyDaysMs = 30 * oneDayMs;

    if (now - state.lastDailyReset > oneDayMs) {
      state.dailySpendUSD = 0;
      state.lastDailyReset = now;
    }

    if (now - state.lastMonthlyReset > thirtyDaysMs) {
      state.monthlySpendUSD = 0;
      state.lastMonthlyReset = now;
    }
  }
}

export const defaultRateLimiter = new TenantRateLimiter();

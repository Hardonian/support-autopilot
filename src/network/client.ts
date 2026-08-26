import type { Ticket } from '../contracts/ticket.js';
import type { TriageResult } from '../contracts/triage-result.js';
import type { DraftResponse } from '../contracts/draft-response.js';
import type { RouterMetrics } from '../ai/model-router.js';

export interface AutopilotClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  apiKey?: string;
}

/**
 * Autopilot Network Client SDK
 */
export class AutopilotNetworkClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;

  constructor(options: AutopilotClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.apiKey = options.apiKey;
  }

  /**
   * Health check
   */
  public async getHealth(): Promise<{ status: string; uptimeSeconds: number; version: string }> {
    return this.fetchJson('/health');
  }

  /**
   * Triage a batch of tickets
   */
  public async triage(
    tickets: Ticket[],
    tenantId = 'default',
    projectId = 'default'
  ): Promise<{ results: TriageResult[]; stats: Record<string, unknown> }> {
    return this.fetchJson('/api/triage', {
      method: 'POST',
      body: JSON.stringify({ tickets, tenantId, projectId }),
    });
  }

  /**
   * Generate an AI response draft with citations
   */
  public async draft(
    ticket: Ticket,
    triage: TriageResult,
    tenantId = 'default',
    projectId = 'default',
    tone = 'friendly'
  ): Promise<{ draft: DraftResponse; usage: Record<string, unknown> }> {
    return this.fetchJson('/api/draft', {
      method: 'POST',
      body: JSON.stringify({ ticket, triage, tenantId, projectId, tone }),
    });
  }

  /**
   * Get real-time AI Router Metrics & Cost / ROI breakdown
   */
  public async getMetrics(): Promise<RouterMetrics> {
    return this.fetchJson('/api/metrics');
  }

  /**
   * Get Network Topology linking Support & FinOps Autopilot
   */
  public async getNetworkTopology(): Promise<{ nodes: unknown[]; links: unknown[] }> {
    return this.fetchJson('/api/network/topology');
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(init?.headers as Record<string, string>),
      };
      if (this.apiKey !== undefined) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }


      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Autopilot API error (${res.status}): ${text}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }
}

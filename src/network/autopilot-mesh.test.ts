import { describe, it, expect, beforeEach } from 'vitest';
import { AutopilotMeshBridge } from './autopilot-mesh.js';
import type { Ticket } from '../contracts/ticket.js';
import type { EnrichedTriageResult } from '../ai/agent-runtime.js';
import type { ModelUsage } from '../ai/model-router.js';

describe('AutopilotMeshBridge', () => {
  let bridge: AutopilotMeshBridge;

  beforeEach(() => {
    bridge = new AutopilotMeshBridge();
  });

  const mockTicket: Ticket = {
    tenant_id: 'tenant-1',
    project_id: 'proj-1',
    id: 'TICK-BILLING-01',
    subject: 'Double charged on monthly subscription invoice',
    body: 'I was billed twice for $499 on my Visa. Please refund one immediately.',
    created_at: new Date().toISOString(),
  };

  const mockTriage: EnrichedTriageResult = {
    tenant_id: 'tenant-1',
    project_id: 'proj-1',
    ticket_id: 'TICK-BILLING-01',
    urgency: 'high',
    topics: [{ category: 'billing', confidence: 0.98, keywords: ['billing', 'charge'] }],
    missing_info: [],
    suggested_priority: 'high',
    suggested_tags: ['billing', 'refund'],
    requires_kb_update: false,
    requires_human_review: true,
    processed_at: new Date().toISOString(),
    sentiment: -0.65,
    churnProbability: 0.45,
    urgencyScore: 8,
    slaDeadlineMinutes: 30,
    securityFlags: [],
  };

  it('should emit Churn Signal and Billing Anomaly to FinOps Autopilot', () => {
    const { churnSignal, billingAnomaly } = bridge.ingestTriageTelemetry(
      mockTicket,
      mockTriage,
      'tenant-1',
      'proj-1'
    );

    expect(churnSignal).toBeDefined();
    expect(churnSignal?.signalType).toBe('BILLING_DISPUTE');
    expect(churnSignal?.churnProbability).toBe(0.45);

    expect(billingAnomaly).toBeDefined();
    expect(billingAnomaly?.disputeType).toBe('DOUBLE_BILLING');

    const churnSignals = bridge.exportChurnSignals();
    expect(churnSignals.length).toBe(1);

    const billingAnomalies = bridge.exportBillingAnomalies();
    expect(billingAnomalies.length).toBe(1);
  });

  it('should compute Unit Economics including human hours saved and net profit margin', () => {
    const usages: ModelUsage[] = [
      {
        promptTokens: 1200,
        completionTokens: 400,
        cachedTokens: 0,
        totalTokens: 1600,
        costUSD: 0.00025,
        cached: false,
        modelId: 'gemini-1.5-flash',
        tier: 'economy',
        latencyMs: 120,
      },
    ];

    const econ = bridge.computeUnitEconomics('tenant-1', 'proj-1', 1, usages);
    expect(econ.totalTicketsProcessed).toBe(1);
    expect(econ.totalTokensBurned).toBe(1600);
    expect(econ.humanLaborHoursSaved).toBeGreaterThan(0);
    expect(econ.netValueGeneratedUSD).toBeGreaterThan(0);
    expect(econ.modelBreakdown['gemini-1.5-flash'].requests).toBe(1);
  });

  it('should return Autopilot Network mesh topology', () => {
    const topo = bridge.getNetworkTopology();
    expect(topo.nodes.length).toBe(4);
    expect(topo.nodes.some((n) => n.id === 'support-autopilot')).toBe(true);
    expect(topo.nodes.some((n) => n.id === 'finops-autopilot')).toBe(true);
  });
});

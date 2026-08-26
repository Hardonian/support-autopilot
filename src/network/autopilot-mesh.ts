import { z } from 'zod';
import type { Ticket } from '../contracts/ticket.js';
import type { EnrichedTriageResult } from '../ai/agent-runtime.js';
import type { ModelUsage } from '../ai/model-router.js';

/**
 * Autopilot Network Telemetry & Signal Envelopes
 */

export interface FinOpsChurnSignal {
  tenantId: string;
  projectId: string;
  customerId: string;
  signalType: 'TICKET_SENTIMENT_NEGATIVE' | 'SLA_BREACH_RISK' | 'BILLING_DISPUTE' | 'HIGH_TICKET_FREQUENCY';
  sentimentScore: number;
  churnProbability: number;
  ticketId: string;
  subject: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface FinOpsBillingAnomalySignal {
  tenantId: string;
  projectId: string;
  ticketId: string;
  customerId: string;
  disputeType: 'OVERCHARGE' | 'DOUBLE_BILLING' | 'INCORRECT_TIER' | 'REFUND_REQUEST';
  amountEstimatedUSD?: number;
  description: string;
  timestamp: string;
}

export interface AutopilotComputeUnitEconomics {
  tenantId: string;
  projectId: string;
  periodStart: string;
  periodEnd: string;
  totalTicketsProcessed: number;
  totalTokensBurned: number;
  totalAIComputeCostUSD: number;
  humanLaborHoursSaved: number;
  netValueGeneratedUSD: number;
  costPerTicketUSD: number;
  modelBreakdown: Record<string, { tokens: number; costUSD: number; requests: number }>;
}

export interface CustomerFinancialContext {
  customerId: string;
  tenantId: string;
  projectId: string;
  mrrUSD: number;
  tier: 'enterprise' | 'growth' | 'pro' | 'starter' | 'free';
  churnRiskScore: number; // 0.0 to 1.0
  lifetimeValueUSD?: number;
}

/**
 * Autopilot Mesh Bridge: Interconnects Support Autopilot with FinOps Autopilot & JobForge
 */
export class AutopilotMeshBridge {
  private readonly churnSignals: FinOpsChurnSignal[] = [];
  private readonly billingAnomalies: FinOpsBillingAnomalySignal[] = [];
  private readonly customerContexts: Map<string, CustomerFinancialContext> = new Map();

  /**
   * Register known customer financial context from FinOps Autopilot
   */
  public registerCustomerFinancialContext(ctx: CustomerFinancialContext): void {
    this.customerContexts.set(ctx.customerId, ctx);
  }

  /**
   * Get financial context for a customer/tenant
   */
  public getCustomerContext(customerId: string): CustomerFinancialContext | undefined {
    return this.customerContexts.get(customerId);
  }

  /**
   * Translate support ticket triage into FinOps churn and billing discrepancy signals
   */
  public ingestTriageTelemetry(
    ticket: Ticket,
    triage: EnrichedTriageResult,
    tenantId: string,
    projectId: string
  ): {
    churnSignal?: FinOpsChurnSignal;
    billingAnomaly?: FinOpsBillingAnomalySignal;
  } {
    const timestamp = new Date().toISOString();
    let churnSignal: FinOpsChurnSignal | undefined;
    let billingAnomaly: FinOpsBillingAnomalySignal | undefined;

    // 1. Detect Churn Signal
    if (triage.sentiment < -0.3 || triage.churnProbability > 0.3 || triage.priority === 'urgent') {
      let signalType: FinOpsChurnSignal['signalType'] = 'TICKET_SENTIMENT_NEGATIVE';
      if (triage.category === 'billing') signalType = 'BILLING_DISPUTE';
      else if (triage.urgencyScore >= 8) signalType = 'SLA_BREACH_RISK';

      churnSignal = {
        tenantId,
        projectId,
        customerId: ticket.id,
        signalType,
        sentimentScore: triage.sentiment,
        churnProbability: triage.churnProbability,
        ticketId: ticket.id,
        subject: ticket.subject,
        timestamp,
        metadata: {
          category: triage.category,
          urgencyScore: triage.urgencyScore,
          securityFlags: triage.securityFlags,
        },
      };

      this.churnSignals.push(churnSignal);
    }

    // 2. Detect Billing Anomaly for FinOps Ledger Reconciler
    if (triage.category === 'billing') {
      const lower = `${ticket.subject} ${ticket.body}`.toLowerCase();
      let disputeType: FinOpsBillingAnomalySignal['disputeType'] = 'REFUND_REQUEST';

      if (/double|twice|duplicate/i.test(lower)) disputeType = 'DOUBLE_BILLING';
      else if (/overcharge|too high|wrong amount/i.test(lower)) disputeType = 'OVERCHARGE';
      else if (/wrong plan|tier|upgrade/i.test(lower)) disputeType = 'INCORRECT_TIER';

      billingAnomaly = {
        tenantId,
        projectId,
        ticketId: ticket.id,
        customerId: ticket.id,
        disputeType,
        description: `Customer reported billing issue: ${ticket.subject}`,
        timestamp,
      };

      this.billingAnomalies.push(billingAnomaly);
    }

    return { churnSignal, billingAnomaly };
  }

  /**
   * Export all accumulated Churn Risk Signals formatted for FinOps Autopilot
   */
  public exportChurnSignals(): FinOpsChurnSignal[] {
    return [...this.churnSignals];
  }

  /**
   * Export Billing Anomalies for FinOps Reconciliation
   */
  public exportBillingAnomalies(): FinOpsBillingAnomalySignal[] {
    return [...this.billingAnomalies];
  }

  /**
   * Compute Unit Economics Report for Autopilot Network
   */
  public computeUnitEconomics(
    tenantId: string,
    projectId: string,
    ticketCount: number,
    usages: ModelUsage[]
  ): AutopilotComputeUnitEconomics {
    const totalTokensBurned = usages.reduce((acc, u) => acc + u.totalTokens, 0);
    const totalAIComputeCostUSD = Number(usages.reduce((acc, u) => acc + u.costUSD, 0).toFixed(5));

    // Assume 1 human support agent ticket takes ~5 minutes (0.083 hours)
    const humanLaborHoursSaved = Number((ticketCount * (5 / 60)).toFixed(2));
    const humanCostPerHour = 35.0;
    const humanGrossCostUSD = humanLaborHoursSaved * humanCostPerHour;
    const netValueGeneratedUSD = Number((humanGrossCostUSD - totalAIComputeCostUSD).toFixed(2));
    const costPerTicketUSD = ticketCount > 0 ? Number((totalAIComputeCostUSD / ticketCount).toFixed(5)) : 0;

    const modelBreakdown: Record<string, { tokens: number; costUSD: number; requests: number }> = {};
    for (const u of usages) {
      if (!modelBreakdown[u.modelId]) {
        modelBreakdown[u.modelId] = { tokens: 0, costUSD: 0, requests: 0 };
      }
      modelBreakdown[u.modelId].tokens += u.totalTokens;
      modelBreakdown[u.modelId].costUSD = Number((modelBreakdown[u.modelId].costUSD + u.costUSD).toFixed(5));
      modelBreakdown[u.modelId].requests++;
    }

    return {
      tenantId,
      projectId,
      periodStart: new Date(Date.now() - 3600000).toISOString(),
      periodEnd: new Date().toISOString(),
      totalTicketsProcessed: ticketCount,
      totalTokensBurned,
      totalAIComputeCostUSD,
      humanLaborHoursSaved,
      netValueGeneratedUSD,
      costPerTicketUSD,
      modelBreakdown,
    };
  }

  /**
   * Return network topology state
   */
  public getNetworkTopology(): {
    nodes: Array<{ id: string; name: string; type: string; status: string; url?: string }>;
    links: Array<{ source: string; target: string; contract: string; activeEventsCount: number }>;
  } {
    return {
      nodes: [
        { id: 'support-autopilot', name: 'Support Autopilot', type: 'triage-and-draft', status: 'ONLINE' },
        { id: 'finops-autopilot', name: 'FinOps Autopilot', type: 'reconciliation-and-churn', status: 'CONNECTED' },
        { id: 'jobforge', name: 'JobForge Batch Core', type: 'execution-engine', status: 'READY' },
        { id: 'controlplane', name: 'ControlPlane Orchestrator', type: 'control-plane', status: 'HEALTHY' },
      ],
      links: [
        {
          source: 'support-autopilot',
          target: 'finops-autopilot',
          contract: 'FinOpsChurnSignal & BillingAnomaly',
          activeEventsCount: this.churnSignals.length + this.billingAnomalies.length,
        },
        {
          source: 'support-autopilot',
          target: 'jobforge',
          contract: 'JobRequestBundleSchema (1.0.0)',
          activeEventsCount: 1,
        },
        {
          source: 'controlplane',
          target: 'support-autopilot',
          contract: 'RunnerContract (0.1.0)',
          activeEventsCount: 1,
        },
      ],
    };
  }
}

export const defaultMeshBridge = new AutopilotMeshBridge();

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AutopilotServer } from './server.js';
import { AutopilotNetworkClient } from './client.js';
import type { Ticket } from '../contracts/ticket.js';

describe('AutopilotServer & Client SDK', () => {
  let server: AutopilotServer;
  let client: AutopilotNetworkClient;
  let serverUrl: string;

  beforeAll(async () => {
    // Port 0 selects an available ephemeral port
    server = new AutopilotServer({ port: 3899 });
    serverUrl = await server.start();
    client = new AutopilotNetworkClient({ baseUrl: serverUrl });
  });

  afterAll(async () => {
    await server.stop();
  });

  it('should respond to /health endpoint', async () => {
    const health = await client.getHealth();
    expect(health.status).toBe('HEALTHY');
    expect(health.version).toBe('0.1.0');
  });

  it('should return real-time model router metrics', async () => {
    const metrics = await client.getMetrics();
    expect(metrics.totalRequests).toBeGreaterThanOrEqual(0);
    expect(metrics.circuitBreakers).toBeDefined();
  });

  it('should return network topology', async () => {
    const topology = await client.getNetworkTopology();
    expect(topology.nodes).toBeDefined();
    expect(topology.links).toBeDefined();
  });

  it('should triage tickets via REST API', async () => {
    const tickets: Ticket[] = [
      {
        tenant_id: 'test',
        project_id: 'test',
        id: 'TICK-API-1',
        subject: 'Cannot login to account',
        body: 'Getting invalid password error repeatedly.',
        status: 'open',
        priority: 'medium',
        created_at: new Date().toISOString(),
        tags: [],
        metadata: {},
      },
    ];



    const result = await client.triage(tickets, 'test', 'test');
    expect(result.results.length).toBe(1);
    expect(result.results[0].ticket_id).toBe('TICK-API-1');
  });
});

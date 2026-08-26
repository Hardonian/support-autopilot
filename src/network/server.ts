import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { defaultModelRouter } from '../ai/model-router.js';
import { TriageAgent, DraftCopilotAgent } from '../ai/agent-runtime.js';
import { defaultMeshBridge } from './autopilot-mesh.js';
import { validateTickets, type Ticket } from '../contracts/ticket.js';
import type { TriageResult } from '../contracts/triage-result.js';
import type { KBChunk } from '../contracts/kb-source.js';
import { buildIndex, retrieveForTicket, ingestDirectory } from '../kb/index.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  uiDistDir?: string;
}

export class AutopilotServer {
  private server?: Server;
  private readonly port: number;
  private readonly host: string;
  private readonly startTime = Date.now();
  private readonly uiDistDir: string;

  constructor(options: ServerOptions = {}) {
    this.port = options.port ?? 3080;
    this.host = options.host ?? '0.0.0.0';
    this.uiDistDir = options.uiDistDir ?? resolve(process.cwd(), 'src/ui');
  }

  public async start(): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      this.server = createServer((req, res) => {
        void (async (): Promise<void> => {
          // Enable CORS
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

          if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
          }

          try {
            await this.handleRequest(req, res);
          } catch (error) {
            const err = error as Error;
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error', message: err.message }));
          }
        })();
      });

      this.server.listen(this.port, this.host, () => {
        const address = `http://${this.host === '0.0.0.0' ? 'localhost' : this.host}:${this.port}`;
        resolvePromise(address);
      });

      this.server.on('error', (err) => reject(err));
    });
  }


  public async stop(): Promise<void> {
    return new Promise((resolvePromise) => {
      if (this.server) {
        this.server.close(() => resolvePromise());
      } else {
        resolvePromise();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    // Health endpoint
    if (pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'HEALTHY',
          service: 'support-autopilot',
          version: '0.1.0',
          uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
          networkMesh: 'CONNECTED',
        })
      );
      return;
    }

    // AI Metrics Endpoint
    if (pathname === '/api/metrics' && req.method === 'GET') {
      const metrics = defaultModelRouter.getMetrics();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metrics));
      return;
    }

    // Network Topology Endpoint
    if (pathname === '/api/network/topology' && req.method === 'GET') {
      const topology = defaultMeshBridge.getNetworkTopology();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(topology));
      return;
    }

    // FinOps Signals Endpoint
    if (pathname === '/api/finops/signals' && req.method === 'GET') {
      const churnSignals = defaultMeshBridge.exportChurnSignals();
      const billingAnomalies = defaultMeshBridge.exportBillingAnomalies();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ churnSignals, billingAnomalies }));
      return;
    }

    // Sample Tickets Endpoint
    if (pathname === '/api/tickets/sample' && req.method === 'GET') {
      const samplePath = resolve('examples/tickets/sample-tickets.json');
      if (existsSync(samplePath)) {
        const raw = readFileSync(samplePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(raw);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }

    // API Triage
    if (pathname === '/api/triage' && req.method === 'POST') {
      const body = await this.readBodyJson(req);
      const tenantId = (body.tenantId as string) || 'default';
      const projectId = (body.projectId as string) || 'default';
      const rawTickets = Array.isArray(body.tickets) ? body.tickets : [body.tickets];
      const tickets = validateTickets(rawTickets);

      const results = [];
      for (const ticket of tickets) {
        const { result } = await TriageAgent.triageTicket(ticket, { tenantId, projectId });
        defaultMeshBridge.ingestTriageTelemetry(ticket, result, tenantId, projectId);
        results.push(result);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results, count: results.length }));
      return;
    }

    // API Draft
    if (pathname === '/api/draft' && req.method === 'POST') {
      const body = await this.readBodyJson(req);
      const tenantId = (body.tenantId as string) || 'default';
      const projectId = (body.projectId as string) || 'default';
      const ticket = body.ticket as Ticket;
      const tone = (body.tone as string) || 'friendly';

      let triageResult: TriageResult;
      if (body['triage'] !== undefined && typeof body['triage'] === 'object' && body['triage'] !== null) {
        triageResult = body['triage'] as TriageResult;
      } else {
        const triaged = await TriageAgent.triageTicket(ticket, { tenantId, projectId });
        triageResult = triaged.result;
      }

      let kbChunks: KBChunk[] = [];
      const kbDir = resolve('examples/kb');
      if (existsSync(kbDir)) {
        const sources = await ingestDirectory(kbDir, { tenantId, projectId });
        const index = buildIndex(tenantId, projectId, sources);
        const retrieved = retrieveForTicket(index, ticket.subject, ticket.body);
        kbChunks = retrieved.map((r) => r.chunk);
      }

      const { draft, execution } = await DraftCopilotAgent.generateDraft(
        ticket,
        triageResult,
        kbChunks,
        { tenantId, projectId },
        { tone }
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ draft, usage: execution.usage, model: execution.model }));
      return;
    }

    // Static Web UI Serving
    if (req.method === 'GET') {
      const filePath = join(this.uiDistDir, pathname === '/' ? 'index.html' : pathname);

      if (existsSync(filePath)) {
        const ext = filePath.split('.').pop() ?? '';
        const contentTypeMap: Record<string, string> = {
          html: 'text/html',
          css: 'text/css',
          js: 'application/javascript',
          json: 'application/json',
          png: 'image/png',
          svg: 'image/svg+xml',
        };
        const contentType = contentTypeMap[ext] ?? 'text/plain';
        const fileContent = readFileSync(filePath);

        res.writeHead(200, { 'Content-Type': contentType });
        res.end(fileContent);
        return;
      }
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: pathname }));
  }

  private async readBodyJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolvePromise, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = (body.trim().length > 0 ? (JSON.parse(body) as unknown) : {}) as Record<string, unknown>;
          resolvePromise(parsed);
        } catch {
          reject(new Error('Invalid JSON request body'));
        }
      });
      req.on('error', (err) => reject(err));
    });
  }
}



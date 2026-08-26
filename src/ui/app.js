// State
let tickets = [];
let selectedTicket = null;
let triageResults = {};

// Elements
const tabs = document.querySelectorAll('.nav-tab');
const tabPanes = document.querySelectorAll('.tab-pane');
const ticketListContainer = document.getElementById('ticket-list-container');
const ticketDetailView = document.getElementById('ticket-detail-view');
const draftTicketSelect = document.getElementById('draft-ticket-select');
const btnGenerateDraft = document.getElementById('btn-generate-draft');
const draftOutputText = document.getElementById('draft-output-text');
const draftCitationsContainer = document.getElementById('draft-citations-container');
const draftTelemetryBox = document.getElementById('draft-telemetry-box');
const btnTriageAll = document.getElementById('btn-triage-all');
const btnResetCircuits = document.getElementById('btn-reset-circuits');
const btnRefreshSignals = document.getElementById('btn-refresh-signals');
const finopsSignalsList = document.getElementById('finops-signals-list');

// Init
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadSampleTickets();
  pollMetrics();
  setInterval(pollMetrics, 3000);
});

// Tab switching
function initTabs() {
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = `tab-${tab.dataset.tab}`;
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

// Load tickets
async function loadSampleTickets() {
  try {
    const res = await fetch('/api/tickets/sample');
    if (res.ok) {
      tickets = await res.json();
    }
  } catch {
    // Fallback sample data
    tickets = [
      {
        id: 'TICK-101',
        subject: 'URGENT: API Authentication failing on production cluster',
        body: 'All our requests are failing with 401 Unauthorized since 10am. My API key is MOCK_AUTH_KEY_998877. Please help ASAP!',
        created_at: new Date().toISOString(),

      },
      {
        id: 'TICK-102',
        subject: 'Double charged on monthly invoice',
        body: 'We were billed twice on our Visa ending in 4242 for $499. Please refund the duplicate charge.',
        created_at: new Date().toISOString(),
      },
      {
        id: 'TICK-103',
        subject: 'How do I configure rate limiting on the gateway?',
        body: 'Looking for the recommended backoff and token bucket parameters in the documentation.',
        created_at: new Date().toISOString(),
      },
    ];
  }

  renderTicketList();
  populateDraftSelect();
}

function renderTicketList() {
  if (!ticketListContainer) return;
  ticketListContainer.innerHTML = '';

  tickets.forEach((t) => {
    const triage = triageResults[t.id];
    const priority = triage ? triage.priority : 'medium';
    const sentiment = triage ? triage.sentiment : -0.1;

    const item = document.createElement('div');
    item.className = `ticket-item ${selectedTicket?.id === t.id ? 'selected' : ''}`;
    item.innerHTML = `
      <div class="ticket-item-header">
        <span class="ticket-id">${t.id}</span>
        <span class="ticket-priority priority-${priority}">${priority}</span>
      </div>
      <div class="ticket-subject">${escapeHtml(t.subject)}</div>
      <div class="ticket-meta">
        <span>Sentiment: ${sentiment.toFixed(2)}</span>
        <span>SLA: &lt; ${triage?.slaDeadlineMinutes || 60}m</span>
      </div>
    `;

    item.addEventListener('click', () => selectTicket(t));
    ticketListContainer.appendChild(item);
  });

  if (tickets.length > 0 && !selectedTicket) {
    selectTicket(tickets[0]);
  }
}

function selectTicket(ticket) {
  selectedTicket = ticket;
  renderTicketList();

  const triage = triageResults[ticket.id];
  const sentiment = triage ? triage.sentiment : -0.2;
  const churnProb = triage ? (triage.churnProbability * 100).toFixed(0) : '25';
  const slaTarget = triage ? triage.slaDeadlineMinutes : 60;
  const flags = triage?.securityFlags?.length ? triage.securityFlags.join(', ') : 'None detected';

  if (ticketDetailView) {
    ticketDetailView.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div>
          <div style="font-size: 0.8rem; color: var(--text-dim); text-transform: uppercase;">Subject</div>
          <div style="font-weight: 700; font-size: 1.1rem; color: #fff;">${escapeHtml(ticket.subject)}</div>
        </div>
        
        <div>
          <div style="font-size: 0.8rem; color: var(--text-dim); text-transform: uppercase;">Message Body</div>
          <div style="padding: 0.75rem; background: var(--bg-card-elevated); border-radius: var(--radius-sm); font-size: 0.9rem;">
            ${escapeHtml(ticket.body)}
          </div>
        </div>

        <div class="grid-3" style="gap: 0.75rem;">
          <div class="metric-box" style="padding: 0.75rem;">
            <div class="metric-label">Sentiment</div>
            <div style="font-size: 1.2rem; font-weight: 700; color: ${sentiment < 0 ? 'var(--accent-red)' : 'var(--accent-green)'};">
              ${sentiment.toFixed(2)}
            </div>
          </div>
          <div class="metric-box" style="padding: 0.75rem;">
            <div class="metric-label">Churn Hazard</div>
            <div style="font-size: 1.2rem; font-weight: 700; color: var(--accent-amber);">${churnProb}%</div>
          </div>
          <div class="metric-box" style="padding: 0.75rem;">
            <div class="metric-label">SLA Target</div>
            <div style="font-size: 1.2rem; font-weight: 700; color: var(--primary);">${slaTarget} min</div>
          </div>
        </div>

        <div style="font-size: 0.8rem; color: var(--text-muted);">
          <strong>Security / PII Audit:</strong> <span style="color: var(--accent-amber);">${flags}</span>
        </div>
      </div>
    `;
  }

  if (draftTicketSelect) {
    draftTicketSelect.value = ticket.id;
  }
}

function populateDraftSelect() {
  if (!draftTicketSelect) return;
  draftTicketSelect.innerHTML = '';
  tickets.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `[${t.id}] ${t.subject.slice(0, 45)}...`;
    draftTicketSelect.appendChild(opt);
  });
}

// Triage All Action
if (btnTriageAll) {
  btnTriageAll.addEventListener('click', async () => {
    btnTriageAll.textContent = 'Triaging with AI...';
    try {
      const res = await fetch('/api/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets, tenantId: 'demo-tenant', projectId: 'demo-project' }),
      });
      if (res.ok) {
        const data = await res.json();
        data.results.forEach((r) => {
          triageResults[r.ticket_id] = r;
        });
        renderTicketList();
        if (selectedTicket) selectTicket(selectedTicket);
        pollFinOpsSignals();
      }
    } catch (e) {
      console.error('Triage error:', e);
    } finally {
      btnTriageAll.textContent = 'Triage All (AI)';
    }
  });
}

// Generate Draft Action
if (btnGenerateDraft) {
  btnGenerateDraft.addEventListener('click', async () => {
    const ticketId = draftTicketSelect.value;
    const ticket = tickets.find((t) => t.id === ticketId) || tickets[0];
    const triage = triageResults[ticket.id] || { priority: 'high', category: 'technical' };
    const tone = document.getElementById('draft-tone-select')?.value || 'friendly';

    btnGenerateDraft.textContent = 'Synthesizing with Model Router...';
    draftOutputText.textContent = 'Routing prompt across model tiers and matching KB citations...';

    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, triage, tone }),
      });

      if (res.ok) {
        const data = await res.json();
        draftOutputText.textContent = data.draft.body;

        if (draftTelemetryBox) {
          draftTelemetryBox.innerHTML = `
            <strong>Latency:</strong> ${data.usage.latencyMs}ms | 
            <strong>Tokens:</strong> ${data.usage.totalTokens} | 
            <strong>Cost:</strong> $${data.usage.costUSD.toFixed(6)} | 
            <strong>Model:</strong> ${data.model.name} (${data.model.tier})
          `;
        }

        if (draftCitationsContainer) {
          draftCitationsContainer.innerHTML = '';
          if (data.draft.citations && data.draft.citations.length > 0) {
            data.draft.citations.forEach((c) => {
              const card = document.createElement('div');
              card.style.cssText = 'padding: 0.6rem; background: var(--bg-card-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; font-size: 0.8rem;';
              card.innerHTML = `
                <div style="font-weight: 600; color: var(--primary);">${escapeHtml(c.title || c.source_id)}</div>
                <div style="color: var(--text-muted); margin-top: 0.2rem;">${escapeHtml(c.snippet)}</div>
              `;
              draftCitationsContainer.appendChild(card);
            });
          } else {
            draftCitationsContainer.innerHTML = '<div style="font-size: 0.8rem; color: var(--text-dim);">General knowledge fallback utilized.</div>';
          }
        }
      }
    } catch (e) {
      draftOutputText.textContent = `Error generating draft: ${e.message}`;
    } finally {
      btnGenerateDraft.textContent = 'Generate AI Draft with KB Citations';
    }
  });
}

// Poll Metrics
async function pollMetrics() {
  try {
    const res = await fetch('/api/metrics');
    if (res.ok) {
      const m = await res.json();
      document.getElementById('router-tokens').textContent = m.totalTokens.toLocaleString();
      document.getElementById('router-cost').textContent = `$${m.totalCostUSD.toFixed(4)}`;
      document.getElementById('router-savings').textContent = `$${m.totalEstimatedSavingsUSD.toLocaleString()}`;
      document.getElementById('router-cache').textContent = `${(m.cacheHitRatio * 100).toFixed(1)}%`;
      document.getElementById('header-roi').textContent = `ROI Saved: $${m.totalEstimatedSavingsUSD.toLocaleString()}`;

      // Breakdown
      const breakdownEl = document.getElementById('router-tier-breakdown');
      if (breakdownEl) {
        breakdownEl.innerHTML = `
          <div style="display: flex; justify-content: space-between; padding: 0.5rem; background: var(--bg-card-elevated); border-radius: 6px;">
            <span>Economy Tier (Flash / Haiku)</span>
            <span style="font-weight: 700; color: var(--primary);">${m.requestsByTier.economy || 0} reqs</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.5rem; background: var(--bg-card-elevated); border-radius: 6px;">
            <span>Reasoning Tier (Pro / Sonnet)</span>
            <span style="font-weight: 700; color: var(--accent-purple);">${m.requestsByTier.reasoning || 0} reqs</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 0.5rem; background: var(--bg-card-elevated); border-radius: 6px;">
            <span>Deterministic Offline Fallback</span>
            <span style="font-weight: 700; color: var(--accent-green);">${m.requestsByTier.deterministic || 0} reqs</span>
          </div>
        `;
      }

      // Circuit Breakers
      const cbList = document.getElementById('circuit-breaker-list');
      if (cbList && m.circuitBreakers) {
        cbList.innerHTML = '';
        Object.values(m.circuitBreakers).slice(0, 4).forEach((cb) => {
          const item = document.createElement('div');
          item.style.cssText = 'display: flex; justify-content: space-between; padding: 0.5rem; background: var(--bg-card-elevated); border-radius: 6px; font-size: 0.85rem;';
          item.innerHTML = `
            <span>${cb.modelId}</span>
            <span style="font-weight: 700; color: ${cb.state === 'CLOSED' ? 'var(--accent-green)' : 'var(--accent-red)'};">${cb.state}</span>
          `;
          cbList.appendChild(item);
        });
      }
    }
  } catch {
    // server might be starting
  }
}

// Poll FinOps Signals
async function pollFinOpsSignals() {
  try {
    const res = await fetch('/api/finops/signals');
    if (res.ok && finopsSignalsList) {
      const data = await res.json();
      finopsSignalsList.innerHTML = '';
      const allSignals = [...(data.churnSignals || []), ...(data.billingAnomalies || [])];
      if (allSignals.length === 0) {
        finopsSignalsList.innerHTML = '<div style="color: var(--text-dim); padding: 1rem;">No churn or billing discrepancy signals detected yet.</div>';
        return;
      }
      allSignals.forEach((s) => {
        const item = document.createElement('div');
        item.className = 'ticket-item';
        item.innerHTML = `
          <div class="ticket-item-header">
            <span class="ticket-id">${s.ticketId || s.customerId}</span>
            <span class="ticket-priority priority-urgent">${s.signalType || s.disputeType}</span>
          </div>
          <div class="ticket-subject">${escapeHtml(s.subject || s.description)}</div>
          <div class="ticket-meta"><span>Exported to FinOps Ledger</span></div>
        `;
        finopsSignalsList.appendChild(item);
      });
    }
  } catch (e) {
    console.error('Signals fetch error:', e);
  }
}

if (btnRefreshSignals) {
  btnRefreshSignals.addEventListener('click', pollFinOpsSignals);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

# Runner Maturity (Support Autopilot)

Support Autopilot is **runnerless**: it never executes jobs. The only "runner" in scope is the **bundle emitter** that produces JobForge-compatible artifacts for downstream execution.

## Runner: Bundle Emitter

### Purpose
- Validate inputs, enforce tenant scoping, and emit JobForge JobRequestBundles for downstream execution.
- Produce audit-friendly reports and metrics without executing work.

### Inputs
- `AnalyzeInputs` JSON payloads (tickets, optional triage results, events, run manifests, KB sources).
- Required CLI options: `tenant_id`, `project_id`, `trace_id`.

### Outputs
- `request-bundle.json`: JobForge JobRequestBundle with idempotency keys and FinOps metadata.
- `report.json`: ReportEnvelope with summary and findings.
- `report.md`: Markdown rendering of the report (optional).
- `metrics.prom`: OpenMetrics/Prometheus text format metrics for success/failure and volume counters.

### Failure Modes
- Tenant/project/trace mismatch between inputs and options.
- Schema validation errors for input payloads.
- Bundle validation errors (missing idempotency key, tenant mismatch, or missing FinOps metadata).

### Execution Guarantees
- **Idempotent execution**: Job requests include deterministic `idempotency_key` values derived from tenant/project/job type/payload. Re-emitting the same inputs yields the same idempotency key, allowing downstream systems to safely de-duplicate.
- **Retry semantics**: Retries are safe because the idempotency key remains stable; downstream runners should treat a duplicate `idempotency_key` as a no-op or re-attach to the existing job.

### Metrics (Standard Format)
Metrics are exported in OpenMetrics/Prometheus text format via `metrics.prom`.

Success/failure metrics (per runner):
- `support_autopilot_runner_runs_total{runner="bundle_emitter",outcome="success|failure"}`

Volume metrics:
- `support_autopilot_tickets_total{outcome="processed"}`
- `support_autopilot_triage_results_total{outcome="received"}`
- `support_autopilot_job_requests_total{job_type, outcome="emitted"}`

### Cost Awareness (FinOps Hooks)
- Every job request includes `metadata.finops` with bounded cost controls (`max_cost_usd`, `max_runtime_seconds`, `max_output_bytes`) and a `cost_center` + `cost_object`.
- Bundle validation fails fast if any job is missing FinOps metadata or uses unbounded values.

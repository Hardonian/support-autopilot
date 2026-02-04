# JobForge Integration (Support Autopilot)

Support Autopilot is **runnerless**: it never executes jobs and only emits JobForge-compatible request bundles and reports for JobForge to validate, gate, and execute.

Contract pinning: this repo currently uses `src/contracts/compat.ts` as a byte-for-byte mirror of the canonical JobForge contracts. The `schema_version` constant is pinned to `1.0`. We keep it aligned by updating the compat schemas whenever the canonical contracts change and by running `pnpm contracts:compat` (which validates the fixtures + hashes against the schemas).

## JobForge CLI invocation

```bash
node dist/cli.js analyze \
  --inputs ./fixtures/jobforge/inputs/minimal.json \
  --tenant tenant_001 \
  --project proj_jobforge \
  --trace trace_fixture \
  --out ./out/jobforge \
  --stable-output
```

## Output artifacts

The command writes the following files:

| File | Description |
| --- | --- |
| `out/jobforge/request-bundle.json` | JobForge JobRequestBundle (dry-run requests only). |
| `out/jobforge/report.json` | ReportEnvelope with findings and summary. |
| `out/jobforge/report.md` | Markdown rendering of the report (optional). |
| `out/jobforge/metrics.prom` | OpenMetrics/Prometheus text format metrics (success/failure + volume counters). |

The deterministic fixture snapshots are exported to:

- `fixtures/jobforge/request-bundle.json`
- `fixtures/jobforge/report.json`
- `fixtures/jobforge/report.md`

Fixture exports are redacted and deterministic for safe sharing.

Each JSON output includes:

- `schema_version` (pinned to `1.0`)
- `module_id` (`support`)
- `tenant_id` + `project_id`
- `trace_id`
- canonical JSON hash metadata (`hash.canonical_json_hash`)
- job request `idempotency_key` values for every job
- FinOps metadata on each job (`metadata.finops`) with bounded cost controls

Stability guarantees:

- `--stable-output` enforces deterministic timestamps and IDs.
- JSON output is serialized via canonical ordering for stable hashing and diffs.

## JobForge ingestion notes

1. Validate `request-bundle.json` against the bundle schema (see `src/contracts/compat.ts`).
2. Enforce multi-tenant scoping by checking `tenant_id` + `project_id` on the bundle and each job.
3. Require `requires_policy_token: true` for action-like job types (e.g., `autopilot.support.ingest_kb`).
4. Enforce FinOps bounds (verify `metadata.finops` for cost caps).

## Library API

```ts
import { analyze, validateBundle, renderReport } from 'support-autopilot';

const { reportEnvelope, jobRequestBundle } = analyze(inputs, {
  tenantId,
  projectId,
  traceId,
});

const validation = validateBundle(jobRequestBundle);
const markdown = renderReport(reportEnvelope, 'markdown');
```

## Safety boundaries

- Support Autopilot **never executes** any job.
- No connectors, queues, schedulers, or secret stores are added.
- All errors are serialized without secrets or PII.

# JobForge Integration (Support Autopilot)

Support Autopilot is **runnerless**: it never executes jobs. It only emits JobForge-compatible request bundles and reports for JobForge to validate, gate, and execute.

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

Each JSON output includes:

- `schema_version`
- `module_id` (`support`)
- `tenant_id` + `project_id`
- `trace_id`
- canonical JSON hash metadata (`hash.canonical_json_hash`)
- job request `idempotency_key` values for every job

## JobForge ingestion notes

1. Validate `request-bundle.json` against the bundle schema (see `src/contracts/compat.ts`).
2. Enforce multi-tenant scoping by checking `tenant_id` + `project_id` on the bundle and each job.
3. Require `requires_policy_token: true` for action-like job types (e.g., `autopilot.support.ingest_kb`).

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

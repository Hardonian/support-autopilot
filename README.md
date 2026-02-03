# Support Autopilot

A **runnerless** support autopilot that ingests tickets and knowledge base docs, performs triage, drafts responses with enforced citations, and proposes KB patches. Outputs JobForge job requests for heavier processing but **never executes or sends messages by default**.

## Non-Negotiable Safety Boundaries

1. **Draft-only by default** - No auto-send functionality
2. **No hallucinated authority** - Every claim must cite KB sources or clearly disclaim "not found"
3. **Multi-tenant safe** - `tenant_id` + `project_id` required everywhere
4. **Runnerless** - No runner/scheduler/connector secrets in the system
5. **LLM-optional** - Core triage and retrieval work without any LLM
6. **OSS ready** - Comprehensive docs, tests, CI, and examples

## Quick Start

```bash
# Install dependencies
pnpm install

# Build the project
pnpm run build

# Ingest knowledge base documents
./dist/cli.js ingest-kb ./examples/kb \
  --tenant tenant_001 \
  --project proj_jobforge \
  --profile ./profiles/jobforge.json

# Triage support tickets
./dist/cli.js triage ./examples/tickets/sample-tickets.json \
  --tenant tenant_001 \
  --project proj_jobforge

# Draft a response (requires triage output and KB index)
./dist/cli.js draft \
  --ticket ticket_001 \
  --triage /tmp/triage-output.json \
  --kb /tmp/kb-output.json \
  --tenant tenant_001 \
  --project proj_jobforge \
  --tone friendly

# Propose KB patches based on triage patterns
./dist/cli.js propose-kb \
  --from-triage /tmp/triage-output.json \
  --tenant tenant_001 \
  --project proj_jobforge
```

## Architecture

```
/src
  /contracts        - Zod schemas for all data types
  /kb              - KB ingestion, chunking, and retrieval
  /triage          - Ticket classification and urgency detection
  /draft           - Response drafting with citation enforcement
  /kb-proposals    - KB patch proposal generation
  /jobforge        - JobForge job request generation
  /utils           - PII redaction, profiles, helpers
  cli.ts           - Command-line interface
  index.ts         - Public API exports
```

## CLI Commands

<!-- CLI_COMMANDS_START -->
| Command | Description |
| --- | --- |
| `support ingest-kb <path>` | Ingest knowledge base documents from a directory. |
| `support triage <tickets.json>` | Triage support tickets from JSON file. |
| `support draft` | Draft a response for a ticket. |
| `support propose-kb` | Propose KB patches based on triage results. |
| `support redact <tickets.json>` | Redact PII from ticket data. |
| `support analyze` | Analyze inputs and emit JobForge-compatible outputs (request bundle + report). |
<!-- CLI_COMMANDS_END -->

### `support ingest-kb <path>`

Ingest markdown/mdx/HTML/text files from a directory into the KB system.

```bash
support ingest-kb ./docs \
  --tenant <tenant_id> \
  --project <project_id> \
  --profile <profile_path>
```

### `support triage <tickets.json>`

Analyze tickets and classify urgency, topics, and missing information.

```bash
support triage ./tickets.json \
  --tenant <tenant_id> \
  --project <project_id> \
  --profile <profile_path> \
  --jobforge  # Output JobForge job requests
```

### `support draft`

Generate a draft response with citations.

```bash
support draft \
  --ticket <ticket_id> \
  --triage <triage_result.json> \
  --kb <kb_index.json> \
  --tenant <tenant_id> \
  --project <project_id> \
  --tone <concise|friendly|technical|empathetic|formal> \
  --jobforge  # Output JobForge job request
```

### `support propose-kb`

Propose knowledge base patches based on triage patterns.

```bash
support propose-kb \
  --from-triage <triage_results.json> \
  --tenant <tenant_id> \
  --project <project_id> \
  --profile <profile_path> \
  --jobforge  # Output JobForge job request
```

### `support redact <tickets.json>`

Redact PII from ticket data (emails, phone numbers, API keys, etc.)

```bash
support redact ./tickets.json
```

## JobForge Integration

Support Autopilot is **runnerless** - it generates job requests but never executes them. To enable batch processing, pipe the output to JobForge:

```bash
# Generate job requests for batch triage
support triage ./tickets.json \
  --tenant tenant_001 \
  --project proj_jobforge \
  --jobforge > job-requests.json

# JobForge would then process these requests
# (This step requires your JobForge instance)
```

See [docs/jobforge-integration.md](docs/jobforge-integration.md) for full JobForge ingestion details.

### JobForge analyze command (bundle + report)

```bash
node dist/cli.js analyze \
  --inputs ./fixtures/jobforge/inputs/minimal.json \
  --tenant tenant_001 \
  --project proj_jobforge \
  --trace trace_fixture \
  --out ./out/jobforge \
  --stable-output
```

### Supported Job Types

- `autopilot.support.triage` - Single ticket triage
- `autopilot.support.batch_triage` - Batch ticket processing
- `autopilot.support.draft_reply` - Response drafting
- `autopilot.support.propose_kb_patch` - KB patch proposal
- `autopilot.support.ingest_kb` - KB ingestion

## Citation Enforcement

Every draft response is validated for citations:

1. **Claims detected**: Pattern matching identifies factual claims
2. **KB verification**: Each claim is checked against retrieved KB chunks
3. **Disclaimers added**: Uncited claims trigger warning disclaimers
4. **Status tracking**: Drafts are marked as `draft`, `review_required`, `citation_failed`, or `ready`

Example output with citation failure:
```json
{
  "status": "citation_failed",
  "disclaimer": "Some information in this draft could not be verified against our knowledge base. Please review before sending.",
  "missing_claims": ["Feature X requires Enterprise plan"],
  "warnings": ["Response contains factual claims but no citations"]
}
```

## PII Redaction

Automatic detection and redaction of:
- Email addresses
- Phone numbers
- Credit card numbers
- Social Security Numbers
- API keys
- Passwords
- IP addresses
- Street addresses

```typescript
import { redactPII } from 'support-autopilot';

const result = redactPII('Contact me at user@example.com');
// result.redacted: 'Contact me at [EMAIL_REDACTED]'
```

## Profiles

Profiles define product terminology, allowed claims, tone defaults, and escalation rules.

```json
{
  "name": "jobforge",
  "product": {
    "name": "JobForge",
    "description": "Distributed job orchestration platform"
  },
  "terminology": {
    "features": {
      "worker": "Execution environment that runs jobs"
    },
    "avoid": ["serverless", "lambda"]
  },
  "claims": {
    "allowed": ["runnerless execution"],
    "require_citation": ["pricing tiers", "SLA"],
    "prohibited": ["zero latency"]
  },
  "tone": {
    "default": "technical",
    "available": ["concise", "friendly", "technical", "formal"]
  },
  "escalation": {
    "keywords": ["workflow failure", "job stuck"],
    "max_urgency": "critical",
    "auto_escalate": true
  }
}
```

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm run dev

# Run tests
pnpm run test

# Run tests in watch mode
pnpm run test:watch

# Lint
pnpm run lint

# Type check
pnpm run typecheck

# Full CI check
pnpm run ci
```

## Testing

The project includes comprehensive tests:

- **Contract tests** - Zod schema validation
- **KB tests** - Chunking and retrieval
- **Triage tests** - Classification and urgency detection
- **Draft tests** - Citation enforcement and tone generation
- **PII tests** - Redaction patterns

## Multi-Tenant Safety

Every data object includes `tenant_id` and `project_id`:

```typescript
// All contracts extend this base
interface TenantContext {
  tenant_id: string;
  project_id: string;
}

// Validation enforces this everywhere
const ticket = validateTicket({
  tenant_id: 'tenant_001',
  project_id: 'proj_jobforge',
  // ... other fields
});
```

## License

MIT

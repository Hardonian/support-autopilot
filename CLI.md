# Support Autopilot CLI

## Commands

| Command | Description |
|---------|-------------|
| `support demo` | Run deterministic demo |
| `support plan` | Dry-run: validate inputs, produce plan |
| `support run` | Execute the support autopilot pipeline |
| `support ingest-kb <path>` | Ingest knowledge base documents |
| `support triage <file>` | Triage support tickets from JSON |
| `support draft` | Draft a response for a ticket |
| `support propose-kb` | Propose KB patches based on triage |
| `support redact <file>` | Redact PII from ticket data |
| `support analyze` | Analyze inputs and emit JobForge format |

## Usage

\`\`\`bash
# Run demo
pnpm run start

# Plan a run
pnpm run plan --input data.json

# Execute
pnpm run run --input data.json
\`\`\`

# Contributing to Support Autopilot

## Development Setup

1. Clone the repository
2. Install pnpm: `npm install -g pnpm`
3. Install dependencies: `pnpm install`
4. Build: `pnpm run build`

## Code Style

- TypeScript with strict mode enabled
- Zod for all runtime validation
- Explicit return types on all functions
- No `any` types

## Testing

All new features must include tests:

```bash
# Run all tests
pnpm run test

# Run specific test file
pnpm run test -- src/kb/chunking.test.ts
```

## PR Process

1. Create a feature branch
2. Make changes with tests
3. Ensure `pnpm run ci` passes
4. Submit PR with description

## Architecture Decisions

### Why runnerless?

Support Autopilot generates job requests but doesn't execute them. This keeps the system:
- Stateless and easy to scale
- Free of execution environment secrets
- Compatible with any job orchestration system (JobForge, BullMQ, etc.)

### Why citation enforcement?

To prevent hallucinated claims, every factual assertion must be:
- Traceable to a KB source, or
- Clearly marked as unverified

### Why Zod?

Runtime validation ensures data integrity across:
- File I/O (JSON parsing)
- API boundaries
- Internal function calls

## Questions?

Open an issue for discussion.

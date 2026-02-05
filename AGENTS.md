# AGENTS.md - Operating Manual for AI Agents

## 1. Purpose

**support-autopilot** is a runnerless support automation CLI tool designed for enterprise support teams. It:

- Ingests knowledge base documents and performs semantic retrieval
- Triages support tickets with classification, urgency detection, and topic extraction
- Drafts response templates with enforced citation requirements (no hallucinated claims)
- Proposes KB patches based on recurring support patterns
- Outputs JobForge-compatible job request bundles for batch LLM processing

**Target users**: Enterprise support teams, DevRel engineers, KB maintainers.

**"Done" means**:
- Commands execute without errors
- Citations are enforced (all factual claims must reference KB sources)
- Multi-tenant isolation is maintained (tenant_id + project_id required)
- No auto-send functionality exists (draft-only by design)
- Output is deterministic (stable fixtures, canonical hashing)

## 2. Repo Map (Practical)

| Directory | Purpose |
|-----------|---------|
| `src/cli.ts` | Commander-based CLI entry point; orchestrates all commands |
| `src/contracts/` | Zod schemas defining all data types (tickets, KB sources, triage results) |
| `src/kb/` | KB ingestion, chunking, retrieval logic |
| `src/triage/` | Ticket classification, urgency, topic extraction |
| `src/draft/` | Response drafting with citation enforcement |
| `src/kb-proposals/` | KB patch proposal generation |
| `src/jobforge/` | JobForge request bundle generation |
| `src/utils/` | PII redaction, profile loading, deterministic output |
| `docs/` | API documentation, JobForge integration guide |
| `examples/` | Sample KB, tickets, job requests for demo |
| `fixtures/` | Deterministic test fixtures (stable output) |
| `profiles/` | Product profiles (terminology, tone, escalation rules) |
| `scripts/` | Build/verification scripts (contracts-compat, docs-verify) |

**Sources of truth**:
- **Content**: `examples/kb/` (markdown/MDX samples), `profiles/*.json` (product configuration)
- **Components**: Modular TypeScript modules under `src/*/index.ts`
- **Config**: `package.json` (scripts, dependencies), `tsconfig.json`, `eslint.config.mjs`
- **Tokens/Styles**: Not applicable (CLI tool, no UI)
- **Tests**: `src/**/*.test.ts` (Vitest), `fixtures/` (integration fixtures)

## 3. Golden Rules (Invariants)

1. **Security & Privacy**
   - Never expose secrets or credentials in code
   - All multi-tenant operations require `tenant_id` + `project_id`
   - PII redaction is mandatory for ticket processing
   - No runner/scheduler/connector secrets in the system

2. **No Hallucinated Claims**
   - Every factual claim in drafts must cite KB sources
   - Unverifiable claims must include disclaimer: "not found in knowledge base"
   - Citation enforcement is non-negotiable

3. **Draft-Only by Default**
   - No auto-send functionality exists or should be added
   - All outputs are drafts requiring human review

4. **No Graceful Fallbacks for Critical Paths**
   - Missing required parameters must fail fast with clear errors
   - Use Zod validation to enforce required fields

5. **Minimal Diffs**
   - Avoid refactors unless explicitly required by the task
   - Focus on smallest safe patch that addresses the issue
   - Preserve existing behavior unless changing it is the explicit goal

6. **Deterministic Builds**
   - Use `src/utils/deterministic.ts` for stable output (canonical hashing)
   - Fixtures in `fixtures/` must match actual output exactly
   - CI requires `verify:fast` to pass (lint + typecheck + build)

## 4. Agent Workflow

### 4.1 Discover → Diagnose → Implement → Verify → Report

**Discover**: Understand the codebase structure and existing patterns before modifying.
- Read `src/*/index.ts` to understand module exports
- Check `docs/*.md` for API documentation
- Review test files to understand expected behavior

**Diagnose**: Identify the root cause before implementing.
- Gather evidence: error logs, test failures, type errors
- Reference `docs/AUDIT_NOTES.md` for known issues
- Check recent commits for context on similar changes

**Implement**: Make minimal, reversible changes.
- Follow existing patterns in the module being modified
- Use Zod schemas from `src/contracts/` for validation
- Add tests for new functionality

**Verify**: Ensure changes don't break existing functionality.
- Run `pnpm run verify:fast` (lint + typecheck + build)
- Run `pnpm run test` to confirm tests pass
- For CLI changes, test manually with `pnpm run dev`

**Report**: Document changes clearly.
- Explain what changed and why
- Note any known limitations or follow-up items

### 4.2 Evidence Requirements

Before proposing changes, gather:
- File paths and line numbers of affected code
- Error messages or test failures (if applicable)
- Related test files that need updates
- Documentation files that need updates

### 4.3 Proposing Edits

- Create the smallest safe patch possible
- Ensure changes are reversible (don't commit work-in-progress)
- Group related changes in a single commit when possible

## 5. Command Cookbook

| Command | Purpose | Notes |
|---------|---------|-------|
| `pnpm install` | Install dependencies | Requires pnpm 9.x, Node 20+ |
| `pnpm run dev` | Run CLI in watch mode | Uses tsx for hot reload |
| `pnpm run lint` | Lint TypeScript files | Uses ESLint 9.x, strict mode |
| `pnpm run lint:fix` | Auto-fix lint issues | Use sparingly; review changes |
| `pnpm run typecheck` | Type-check without emitting | Catches TS errors early |
| `pnpm run test` | Run Vitest suite | 94 tests in 9 files |
| `pnpm run test:watch` | Watch mode for tests | Use during development |
| `pnpm run build` | Build ESM bundles + types | Uses tsup; outputs to `dist/` |
| `pnpm run verify:fast` | Quick CI check | lint + typecheck + build |
| `pnpm run verify:full` | Full CI verification | verify:fast + tests |
| `pnpm run contracts:compat` | Verify JobForge compatibility | Scripts validation |
| `pnpm run docs:verify` | Verify documentation | Checks docs build correctly |

**Assumed commands** (verify in package.json):
- `pnpm format` / `pnpm format:check` - Not configured (Prettier missing)

## 6. Change Safety Checklist

Before committing:

- [ ] `pnpm run lint` passes (0 errors, 0 warnings)
- [ ] `pnpm run typecheck` passes (0 errors)
- [ ] `pnpm run build` passes (JS + types generated)
- [ ] `pnpm run test` passes (all 94 tests green)
- [ ] No dead imports introduced
- [ ] No unused files added
- [ ] Exports in `src/index.ts` match module exports
- [ ] Zod schemas in `src/contracts/` are exported properly
- [ ] New functionality has test coverage
- [ ] Documentation updated if API changed

## 7. Code Standards

### 7.1 TypeScript / ESLint Conventions

- **Strict TypeScript**: `noImplicitAny`, `strictNullChecks` enabled
- **ESLint**: `@typescript-eslint` plugin with strict rules
- **No unsafe `any`**: Commander options must be properly typed
- **Prefer explicit types**: Avoid inference for public API exports

### 7.2 Component Patterns

Not applicable (CLI tool, no UI components). Module patterns:

```typescript
// Module structure pattern
export interface ModuleInput { /* ... */ }
export interface ModuleOutput { /* ... */ }
export const schema = z.object({ /* ... */ });

export function process(input: ModuleInput): ModuleOutput {
  // validation via Zod
  const validated = schema.parse(input);
  // implementation
}
```

### 7.3 Error Handling

- Use Zod for input validation (fail fast with clear errors)
- Use `console.error` for CLI errors (no structured logging yet)
- Throw typed errors for invalid state: `throw new Error('message')`

### 7.4 Environment Variables

**No environment variables used currently**. All configuration via:
- CLI flags (`--tenant`, `--project`, `--profile`)
- Profile files (`profiles/*.json`)

To add env vars in the future:
- Document in `docs/cli.md`
- Add validation via Zod in `src/cli.ts`
- Never commit secrets; use `.env.example` pattern

## 8. PR / Commit Standards

### 8.1 Branch Naming

- `feat/*` - New features
- `fix/*` - Bug fixes
- `chore/*` - Maintenance (deps, docs, tooling)
- `refactor/*` - Code improvements without behavior changes
- `docs/*` - Documentation only

### 8.2 Commit Message Style

Format: `type(scope): subject`

Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`

Examples:
- `feat(kb): add markdown link extraction`
- `fix(cli): resolve async typing in ingest-kb`
- `chore: add Prettier configuration`
- `docs: update CLI command reference`

### 8.3 PR Expectations

- PR template: Not detected; create one if needed
- Description: Explain what changed and why
- Verification: List commands run and results
- Links: Reference issues or related commits

### 8.4 PR Description Template (suggested)

```
## Summary
Brief description of changes.

## Changes
- File: change description
- ...

## Verification
- [ ] `pnpm run lint` passes
- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run build` passes
- [ ] `pnpm run test` passes
- Manual testing notes...

## Notes
Known limitations, follow-up items, breaking changes.
```

## 9. Roadmap Hooks (Agent-Ready Backlog)

Based on `docs/AUDIT_NOTES.md` audit findings and recent commits:

### High Priority (Fix Required)

1. **CLI Typing Refactor** - Type all Commander options with interfaces (src/cli.ts has 32 lint errors from unsafe `any`)
2. **Export Missing Types** - Export `TenantContext`, `TenantContextSchema`, `validateTenantContext` from contracts/compat.ts
3. **Fix TypeScript Errors** - Resolve async typing issue at cli.ts:96 and TonePreset type mismatch at cli.ts:223
4. **Add Prettier** - Configure code formatting to reduce style-related PR noise
5. **Fix Boolean Expression Violations** - Address strict-boolean-expressions errors in contracts/compat.ts, draft/generator.ts, jobforge/integration.ts, kb-proposals/generator.ts, triage/batch.ts

### Medium Priority (Improve DX)

6. **Add Format Scripts** - Create `pnpm format` and `pnpm format:check` scripts
7. **Create SECURITY.md** - Document security policy and reporting process
8. **Create TESTING.md** - Document testing patterns and fixture creation
9. **Add Pre-commit Hooks** - Configure Husky/lint-staged for CI gate
10. **Add Dependency Audit** - Add npm/dependency vulnerability scanning to CI

### Low Priority (Nice to Have)

11. **Structured Logging** - Add pino or similar for production observability
12. **Error Code Documentation** - Document all CLI error codes in docs/
13. **Example Fixtures Expansion** - Add more comprehensive examples for edge cases
14. **Profile Validation** - Add schema validation for profile files
15. **CI Performance** - Optimize CI cache and parallel job execution

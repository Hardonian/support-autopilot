# SKILLS.md - Capability Map & Future Work Guide

## 1. How to Use This File

Use this file to route tasks to the right agent/model/tooling. It documents what exists in the repository, where work happens, and what skills are needed for different task types. Reference it when:
- Deciding whether a task requires human or agent attention
- Identifying which module or directory owns a given capability
- Planning improvements or addressing technical debt
- Onboarding to the codebase structure

## 2. Current Capability Inventory

| Capability | Detected | Notes |
|------------|----------|-------|
| **UI/Frontend** | No | CLI-only tool; no web interface |
| **CLI Commands** | Yes | ingest-kb, triage, draft, propose-kb, redact, analyze |
| **TypeScript ESM** | Yes | Modern module system, strict mode |
| **Zod Validation** | Yes | All contracts use Zod schemas in `src/contracts/` |
| **KB Ingestion** | Yes | Markdown/MDX/HTML/text support in `src/kb/ingest.ts` |
| **Semantic Retrieval** | Yes | Chunk-based retrieval with configurable overlap |
| **Ticket Triage** | Yes | Classification, urgency, topics in `src/triage/` |
| **Citation Enforcement** | Yes | Claim detection and KB verification in `src/draft/` |
| **PII Redaction** | Yes | Email, phone, SSN, API keys, passwords, IPs in `src/utils/pii.ts` |
| **Profile System** | Yes | Terminology, tone, escalation rules in `profiles/*.json` |
| **JobForge Integration** | Yes | Request bundle generation in `src/jobforge/` |
| **Deterministic Output** | Yes | Canonical hashing in `src/utils/deterministic.ts` |
| **Test Suite** | Yes | 94 Vitest tests passing |
| **Lint** | Yes | ESLint 9.x configured (32 errors pending fix) |
| **Typecheck** | Yes | TypeScript strict mode (2 errors pending fix) |
| **Build** | Yes | tsup bundling to `dist/` (blocked by type errors) |
| **CI/CD** | Yes | GitHub Actions workflow |
| **Prettier** | No | Not configured |
| **Security Scanning** | No | No dependency audit or SECURITY.md |
| **Structured Logging** | No | Console.error only |
| **Error Codes** | No | Not documented |

## 3. Skill Lanes

### 3.1 Product / UX Writing
- **Scope**: CLI help text, error messages, profile tone calibration
- **Patterns**: Enterprise-safe, consultancy tone, no hallucinated claims
- **Files**: `src/cli.ts` (Commander descriptions), `profiles/*.json`
- **Validation**: `pnpm run lint` passes, human review of tone

### 3.2 Schema / Contract Engineering
- **Scope**: Zod validation, tenant isolation, JobForge compatibility
- **Patterns**: All inputs validated via Zod; tenant_id + project_id required
- **Files**: `src/contracts/*.ts`
- **Validation**: `pnpm run test` (contract tests), `pnpm run contracts:compat`

### 3.3 Knowledge Base Engineering
- **Scope**: Document ingestion, chunking strategies, retrieval tuning
- **Patterns**: Markdown/MDX/HTML/text support; configurable chunk size/overlap
- **Files**: `src/kb/ingest.ts`, `src/kb/chunking.ts`, `src/kb/retrieval.ts`
- **Validation**: `pnpm run test` (kb tests), fixture comparison

### 3.4 Triage Logic
- **Scope**: Classification, urgency detection, topic extraction
- **Patterns**: Rule-based classification extensible via profiles
- **Files**: `src/triage/classifier.ts`, `src/triage/triage-packet.ts`
- **Validation**: `pnpm run test` (triage tests), fixture comparison

### 3.5 Citation / Draft Engineering
- **Scope**: Claim detection, KB verification, disclaimer injection
- **Patterns**: All factual claims must cite sources or disclaim "not found"
- **Files**: `src/draft/generator.ts`, `src/draft/citations.ts`
- **Validation**: `pnpm run test` (draft tests), citation enforcement checks

### 3.6 Integration / JobForge
- **Scope**: Request bundle generation, event tracing, manifest creation
- **Patterns**: Runnerless output; deterministic timestamps and IDs
- **Files**: `src/jobforge/integration.ts`, `src/jobforge/jobs.ts`
- **Validation**: `pnpm run test` (jobforge tests), fixture comparison

### 3.7 CLI Engineering
- **Scope**: Commander command structure, option typing, error handling
- **Patterns**: Type-safe options via interfaces (current: unsafe `any`)
- **Files**: `src/cli.ts`
- **Validation**: `pnpm run lint` (0 errors), `pnpm run typecheck` (0 errors)

### 3.8 QA / Release Engineering
- **Scope**: Test coverage, fixture management, CI gate enforcement
- **Patterns**: Vitest for unit tests; deterministic fixtures in `fixtures/`
- **Files**: `src/**/*.test.ts`, `.github/workflows/ci.yml`
- **Validation**: `pnpm run verify:fast`, `pnpm run verify:full`

## 4. Which Agent for Which Task Matrix

| Task Type | Approach | Validation |
|-----------|----------|------------|
| **Schema changes** | Engineer agent + human review of business logic | `pnpm run test` (contract tests), schema consistency check |
| **CLI option additions** | Engineer agent (requires type interfaces) | `pnpm run lint` (0 errors), `pnpm run typecheck` (0 errors) |
| **Profile updates** | Human (product decisions) + agent for syntax | Lint passes, profile schema validation |
| **Citation logic** | Engineer agent + domain expert review | `pnpm run test` (draft tests), citation enforcement check |
| **New KB formats** | Engineer agent (ingestion patterns) | Test coverage for new format, lint passes |
| **JobForge contract updates** | Engineer agent + human (compatibility impact) | `pnpm run contracts:compat`, fixture regeneration |
| **Documentation** | Human or agent (style consistency) | `pnpm run docs:verify`, human readability review |
| **Test additions** | Agent (pattern-based) + human (edge cases) | `pnpm run test` (all green), coverage maintained |
| **Fixing lint errors** | Agent (pattern-based fix) | Lint passes, no regression |
| **Performance tuning** | Engineer agent + profiling | Benchmark fixture comparison |

## 5. Known Risks & Pitfalls

| Symptom | Likely Cause | Diagnosis |
|---------|--------------|-----------|
| **ESLint: "Unsafe argument of type `any`"** | Commander options typed as `any` in `src/cli.ts` | Run `pnpm run lint`, count errors in cli.ts |
| **TypeScript: "Type 'Promise<...>' must have '[Symbol.iterator]'"** | Missing await on async function returning tuple | Check cli.ts:96 for missing await |
| **Build fails on dts generation** | Type errors in CLI (blocks type emit) | Run `pnpm run typecheck`, fix errors before build |
| **TonePreset type mismatch at cli.ts:223** | String literal not matching union type | Check profile tone values vs TonePreset definition |
| **Fixture mismatch in CI** | Non-deterministic output (missing canonical hash) | Compare `fixtures/` to `pnpm run fixtures:export` output |
| **Contract test failure** | Schema change without fixture update | Run `pnpm run contracts:compat`, regenerate fixtures |
| **Missing exports from contracts/compat.ts** | Index.ts not updated after schema changes | Check `src/index.ts` exports vs module exports |

## 6. Roadmap

### 30 Days: Stabilization

- Fix CLI typing (type all Commander options with interfaces)
- Export missing types from `contracts/compat.ts`
- Resolve 2 TypeScript errors in cli.ts
- Address 32 ESLint errors (strict-boolean-expressions, unsafe-any)
- Fix boolean expression violations in 5 files
- Create SECURITY.md with vulnerability reporting process
- Create TESTING.md with fixture creation guide
- Ensure `pnpm run verify:fast` passes with 0 errors

### 60 Days: DX & CI Enforcement

- Configure Prettier for code formatting
- Add `format` and `format:check` scripts to package.json
- Add Husky pre-commit hooks with lint-staged
- Add npm dependency vulnerability scanning to CI
- Optimize CI cache and parallel job execution
- Document all CLI error codes in docs/cli.md
- Add structured logging (pino or similar)

### 90 Days: Maturity & Expansion

- Add profile schema validation (Zod-based)
- Expand example fixtures for edge cases
- Add integration test suite for end-to-end workflows
- Create contributor onboarding guide (enhanced CONTRIBUTING.md)
- Implement observability hooks for production use
- Explore LLM-optional triage improvements (rule-based enhancements)
- Benchmark and document performance characteristics

## 7. Definition of Done

A change is **ship-ready** when:

- [ ] `pnpm run lint` passes with 0 errors, 0 warnings
- [ ] `pnpm run typecheck` passes with 0 errors
- [ ] `pnpm run build` succeeds (JS + type definitions)
- [ ] `pnpm run test` passes (all 94 tests green)
- [ ] `pnpm run contracts:compat` passes
- [ ] `pnpm run docs:verify` passes
- [ ] No hallucinated claims in documentation or code comments
- [ ] Multi-tenant isolation maintained (tenant_id + project_id on all operations)
- [ ] Citation enforcement logic unchanged (unless explicitly modified)
- [ ] Fixtures updated if output format changes
- [ ] CHANGELOG entry added for user-facing changes
- [ ] Security considerations reviewed (no secrets, PII handled)

## 8. File Reference

- **Main CLI**: `src/cli.ts` - 363 lines, Commander-based
- **Contracts**: `src/contracts/` - 11 files, Zod schemas
- **KB Module**: `src/kb/` - 5 files, ingestion/retrieval
- **Triage Module**: `src/triage/` - 5 files, classification
- **Draft Module**: `src/draft/` - 4 files, citations
- **JobForge**: `src/jobforge/` - 4 files, integration
- **Utils**: `src/utils/` - 3 files, PII/deterministic
- **Profiles**: `profiles/` - 2 files (base.json, jobforge.json)
- **Tests**: `src/**/*.test.ts` - 94 tests
- **Fixtures**: `fixtures/` - JobForge-compatible test data
- **CI**: `.github/workflows/ci.yml` - Fast/full verification

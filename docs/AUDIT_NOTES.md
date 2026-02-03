# Repository Audit Notes

## Project Overview
**support-autopilot** - A runnerless support autopilot CLI tool for triaging tickets, drafting responses with citations, and proposing KB patches. Outputs JobForge job requests for batch processing.

- **Package Manager**: pnpm 9.15.0
- **Node Version**: >= 20.0.0
- **Type**: TypeScript ESM CLI tool
- **Test Framework**: Vitest 2.1.8
- **Linting**: ESLint 9.17.0 with TypeScript plugin

## Current State

### ✅ What's Working
1. **Test Suite**: 65 tests passing across 9 test files
2. **Build System**: tsup for bundling, outputs to `dist/`
3. **CI/CD**: GitHub Actions workflow with fast/full verification modes
4. **Package Scripts**: Good foundation with lint, typecheck, test, build, verify

### ❌ Critical Issues Found

#### TypeScript Errors (4 errors)
1. `src/index.ts:2-4` - Missing exports from contracts/compat.ts:
   - `TenantContext` type not exported
   - `TenantContextSchema` not exported
   - `validateTenantContext` not exported
2. `src/utils/deterministic.ts:52` - Type assignment error in `withCanonicalHash` function

#### ESLint Errors (112 errors)
**Primary source**: `src/cli.ts` (commander action callbacks)
- 96 errors related to unsafe `any` usage from un-typed `options` parameters
- Commander action handlers receive `options` as `any` but strict ESLint rules reject this
- 7 errors for async functions without await expressions
- Strict boolean expression rule violations across multiple files
- 3 errors in `src/utils/deterministic.ts` (base-to-string, unused-vars)
- Additional errors in contracts/compat.ts, draft/generator.ts, jobforge/integration.ts, kb-proposals/generator.ts, triage/batch.ts

#### Missing Tooling
1. **No formatting tool**: No Prettier or Biome configured
2. **No unified verify script**: Need `pnpm verify` that runs all checks in order
3. **No format scripts**: Missing `format` and `format:check` scripts
4. **No pre-commit hooks**: Husky/lint-staged not configured
5. **No security scanning**: No dependency audit in CI

#### Security Gaps
1. No `SECURITY.md` policy
2. No documented security scanning workflow
3. No explicit dependency vulnerability checking
4. Input validation exists via Zod but not documented

#### Documentation Gaps
1. No `TESTING.md` guide for contributors
2. `CONTRIBUTING.md` exists but could be enhanced
3. No detailed error handling documentation

## Remediation Plan

### Phase 1: Fix Type Safety
- [ ] Export missing types from contracts/compat.ts
- [ ] Fix withCanonicalHash type constraint
- [ ] Add explicit types for CLI command options
- [ ] Fix strict-boolean-expressions violations properly

### Phase 2: ESLint Hardening
- [ ] Type commander options properly (create interfaces)
- [ ] Remove or await async functions without await
- [ ] Fix boolean expression violations
- [ ] Fix remaining deterministic.ts issues

### Phase 3: Add Missing Tooling
- [ ] Add Prettier configuration
- [ ] Add format and format:check scripts
- [ ] Create unified `verify` script
- [ ] Add .prettierignore

### Phase 4: Security & Documentation
- [ ] Create SECURITY.md
- [ ] Add dependency audit to CI
- [ ] Create TESTING.md
- [ ] Enhance CONTRIBUTING.md

### Phase 5: Final Verification
- [ ] Run `pnpm verify` - must pass 0 errors
- [ ] Verify all tests still pass
- [ ] Verify build succeeds
- [ ] Verify CI workflow passes

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| CLI typing issues | High | Properly type all commander options |
| Missing security docs | Medium | Add SECURITY.md and CI scanning |
| No code formatting | Low | Add Prettier with minimal config |
| Type export mismatch | High | Fix exports to match index.ts expectations |

## Files Requiring Changes

1. `src/contracts/compat.ts` - Add missing exports
2. `src/index.ts` - Verify export consistency
3. `src/cli.ts` - Type all options parameters (major refactor needed)
4. `src/utils/deterministic.ts` - Fix type constraint and lint issues
5. `src/contracts/compat.ts` - Fix boolean expressions
6. `src/draft/generator.ts` - Fix boolean expressions
7. `src/jobforge/integration.ts` - Fix boolean expressions
8. `src/kb-proposals/generator.ts` - Fix boolean expression
9. `src/triage/batch.ts` - Fix boolean expression
10. `package.json` - Add format scripts and verify script
11. `.github/workflows/ci.yml` - Add security scanning
12. `docs/SECURITY.md` - Create new
13. `docs/TESTING.md` - Create new

## Audit Completed
Date: 2026-02-03
Auditor: Kimi (Full Repo Audit / QA / Hardening)

---
type: stages
project: codeburn
tags:
  - project/codeburn
  - type/stages
created: 2026-05-04
modified: 2026-05-04
---

**current_stage:** 1
**status:** active
**last_run:** —
**velocity:** — tasks/night

## Stage 1: workspace integration

**token_budget:** 10,000
**entry_criteria:** Submodule added to autonomous-workspace
**exit_criteria:** All items checked AND `npm test` passes
**test_strategy:** `npm test` — must exit 0

### Tasks

- [ ] CLAUDE.md present and complete
- [ ] docs/ scaffold files all exist (scope, stages, decisions, blockers, ideas)
- [ ] metrics/ scaffold files all exist (sessions, tokens, burndown)
- [ ] Scaffold branch opened as PR to main
- [ ] Human approves scope.md

**resume_point:** — (not started)
**completed_at:** —

---

## Stage 2: feature / provider work

**token_budget:** 30,000
**entry_criteria:** Stage 1 complete, scope.md approved, feature goal defined
**exit_criteria:** Feature implemented, `npm run build` and `npm test` pass, semgrep passes
**test_strategy:** `npm test` + `npm run build` + semgrep on changed files

### Tasks

- [ ] Define target feature or provider in scope.md open questions
- [ ] Explore relevant existing provider/parser files with `/codebase-explorer`
- [ ] Implement feature or new provider following existing patterns
- [ ] Add/update unit tests for the new code
- [ ] Verify `npm run build` produces working `dist/cli.js`
- [ ] Smoke test the feature with `node dist/cli.js`

**resume_point:** —
**completed_at:** —

---

## Stage 3: tests and validation

**token_budget:** 20,000
**entry_criteria:** Stage 2 complete
**exit_criteria:** All tests pass, semgrep passes, no regressions in existing providers
**test_strategy:** `npm test` full suite; manual smoke test of affected commands

### Tasks

- [ ] Run full test suite — all pass
- [ ] Run semgrep on changed provider/parser files — no findings
- [ ] Smoke test affected CLI commands end-to-end
- [ ] Check that existing providers still produce correct output
- [ ] Update CHANGELOG.md with new entry

**resume_point:** —
**completed_at:** —

---

## Stage 4: polish and PR prep

**token_budget:** 15,000
**entry_criteria:** Stage 3 complete
**exit_criteria:** PR open on getagentseal/codeburn with clean diff and passing CI
**test_strategy:** GitHub Actions CI must pass on the PR

### Tasks

- [ ] Run `/security-scan` on changed files
- [ ] Review diff for any debug code, TODOs, or leftover comments
- [ ] Ensure README is updated if user-facing commands changed
- [ ] Open PR on getagentseal/codeburn with description of changes
- [ ] Confirm CI passes on the PR

**resume_point:** —
**completed_at:** —

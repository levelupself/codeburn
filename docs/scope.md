---
type: scope
project: codeburn
status: draft
created: 2026-05-04
modified: 2026-05-04
---

# Scope: codeburn

**Status:** draft — awaiting human approval
**Created:** 2026-05-04

## Goal

CodeBurn is a TypeScript CLI tool that tracks token usage, cost, and performance across 18 AI coding tools (Claude Code, Cursor, Codex, Gemini CLI, GitHub Copilot, and more). It reads session data directly from disk — no wrapper, no proxy, no API keys — and prices every call using LiteLLM. This workspace scope covers contributions and extensions to the codeburn codebase as a personal/OSS project.

## Why this matters

Personal project for levelupself. Directly relevant to autonomous workspace operations — codeburn tracks Claude Code spend, which feeds the workspace token metrics. Autonomous agents reduce maintenance overhead and accelerate feature delivery.

## Success criteria

- [ ] Build passes (`npm run build` exits 0)
- [ ] All tests pass (`npm test` exits 0)
- [ ] semgrep CI check passes on changed provider/parser files
- [ ] Each stage change opened as PR to codeburn main
- [ ] PR reviewed and merged to main

## Non-goals

- Rewriting existing provider parsers that already work correctly
- Adding server-side components or cloud storage (tool is intentionally local-only)
- Modifying the macOS menubar Swift app (`mac/`) unless explicitly in scope
- Production hardening beyond what the existing codebase already has

## Constraints

- Node.js 22+ required
- npm is the package manager — do not use pnpm or yarn
- New providers must follow `src/providers/codex.ts` interface pattern
- semgrep bracket-assign guard runs in CI on `src/providers/` and `src/parser.ts` — changes there must pass
- CLI is published on npm — breaking changes to command interface require a semver major bump
- `dist/` is not committed — always build before testing end-to-end

## Open questions

- What is the primary contribution goal? (new provider, new feature, bug fixes, or general maintenance?)
- Are there specific AI coding tools not yet supported that should be prioritized?
- Should the Windows/Linux path detection for any provider be tested locally on this machine?
- Is there interest in contributing back upstream via PR to getagentseal/codeburn?

## Token budget estimate

| Stage | Name | Estimate |
|-------|------|----------|
| 1 | Workspace integration | 10,000 |
| 2 | Feature / provider work | 30,000 |
| 3 | Tests and validation | 20,000 |
| 4 | Polish and PR prep | 15,000 |

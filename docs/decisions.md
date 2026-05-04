---
type: decisions
project: codeburn
tags:
  - project/codeburn
  - type/decisions
created: 2026-05-04
modified: 2026-05-04
---

# Decisions: codeburn

## 2026-05-04 — All agent changes via PRs — never push to main directly

**Decision:** All changes go through a PR branch, never directly to main.
**Reason:** CI (semgrep + build) must pass before merging; direct pushes bypass the check.
**Consequences:** Always work on a feature branch; use `/pr-opener` to open the PR.

---

## 2026-05-04 — Use npm as package manager

**Decision:** Use npm exclusively — not pnpm or yarn.
**Reason:** `package-lock.json` is committed to the repo; mixing package managers corrupts the lockfile.
**Consequences:** Always run `npm install`, `npm test`, `npm run build` — never `pnpm` or `yarn` equivalents.

---

## 2026-05-04 — New providers must follow codex.ts interface pattern

**Decision:** Any new provider file in `src/providers/` must implement the same interface as `src/providers/codex.ts`.
**Reason:** Provider registry (`src/providers/index.ts`) expects a uniform interface; deviations break auto-detection.
**Consequences:** Before implementing a new provider, read `src/providers/codex.ts` and `src/providers/types.ts` in full.

---

## 2026-05-04 — semgrep bracket-assign guard is a hard CI gate

**Decision:** semgrep runs on `src/providers/` and `src/parser.ts` on every PR; findings block merge.
**Reason:** Hot-path bracket assignment can cause silent data corruption in the parser (observed pattern the team guards against).
**Consequences:** After editing provider or parser files, run `semgrep --config .semgrep/rules/no-bracket-assign-hot-paths.yml src/providers/ src/parser.ts` locally before pushing.

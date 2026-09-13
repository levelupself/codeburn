# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Run the full local suite with `npm test -- --run`; `npm run build` builds the CLI.
- Codex cache persistence and source fingerprint validation live in `src/codex-cache.ts`; failure recovery tests are in `tests/codex-cache-write.test.ts`. Use `CODEBURN_CACHE_DIR` to isolate cache experiments from real data.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

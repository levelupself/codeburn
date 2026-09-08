# Codex cache write investigation

The reported installation was version 0.9.19 with a 60,543,405-byte complete cache and 17 empty or partial temporary files. The investigated checkout's package version is 0.9.6. The production failure has not been reproduced without fault injection; neither the affected filesystem nor its process termination history was altered or inferred from the orphan sizes.

A direct call to `writeCachedCodexResults` followed by awaited `flushCodexCache` wrote over 60 MB successfully. The regression test also executes this path and parses the complete replacement. This rules out a deterministic 60 MB limit in this checkout under the available runtime; it does not rule out memory pressure, external termination, or I/O failures on the affected installation.

At pre-fix commit `50eb8bdbaeb19cf801a5f95555592edac6322bbd`, `src/codex-cache.ts:140` creates the temporary file, lines 143–146 write and sync it, line 149 renames it, and line 154 silently catches failures. Cleanup surrounds only rename. A rejected write, sync, or close therefore leaves an orphan and reports success. A failure before any bytes are written produces an empty orphan; a rejected write after some bytes produces a partial orphan. A process killed at either point can also leave an orphan, but that was not established as the production cause. Rename is awaited and uses a sibling path, so the code does not demonstrate an unawaited rename or a cross-device move. Random temporary names avoid ordinary writer-name collisions.

The result cache is an acceleration layer keyed by source size and mtime. An old snapshot alone does not explain missing newly discovered sessions: changed and uncached sources are reparsed. The reported zero-row query therefore remains unproven as a consequence of these orphan files. This repair addresses the established silent persistence failure and missing cleanup without claiming to diagnose the affected machine's originating I/O error or kill event.

## Regression evidence

At commit `50eb8bdbaeb19cf801a5f95555592edac6322bbd`, `vitest run tests/codex-cache-write.test.ts` observed 2 passes and 6 failures. The zero-byte and partial-write assertions both failed with `expected '' to contain 'injected write'`; sync, close, rename, and orphan diagnostics were likewise absent. Proof files: `src/codex-cache.ts`, `tests/codex-cache-write.test.ts`.

At commit `053936cadbf07bbfc5b0c0502d77c1a8d7ad13a7`, the scoped dead-writer cleanup test failed with `expected [ 'codex-results.json', …(3) ] to not include 'codex-results.json.2222222222222222.2…'` (1 failed, 8 skipped). Proof files: `src/codex-cache.ts`, `tests/codex-cache-write.test.ts`.

For the current persistence diagnostics, recovery policy, and direct-read limitations, see [Codex cache behavior in the README](../README.md#how-it-reads-data). The cleanup implementation is in `src/codex-cache.ts`, with regression coverage in `tests/codex-cache-write.test.ts`.

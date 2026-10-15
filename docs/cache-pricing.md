# Pricing and cache contract

Codex session caches reuse parsed, normalized tokens and metadata. On every cache
hit the provider recalculates `costUSD` with the loaded rates and model aliases,
which also registers unknown models for the CLI warning. The stored cost is a
snapshot, never authoritative. Repricing preserves the cold parser's existing
charging semantics: noncached input, cache reads, and output plus reasoning.
Estimated calls retain their token counts and estimate marker. Source JSONL files
are never rewritten. Cache schema versions still govern parsed-data changes;
atomic persistence and recovery remain in `src/codex-cache.ts`.

Daily costs cannot be reconstructed accurately from daily token totals: aggregation
has discarded per-call speed, reasoning, and web-search details. Before hydration,
callers must load pricing and set aliases (`src/cli.ts` does this). Hydration keys
derived days by a hash of the effective price table, built-in aliases, and saved
aliases. A missing or changed key drops all derived days and rebuilds the normal
365-day backfill from provider calls. Yesterday still refreshes on ordinary warm
runs. Identical rates with a newer fetch timestamp retain the cache. This covers
alias additions, target changes, removals, and live/snapshot rate changes; it does
not require deleting either source data or parsed Codex entries. Unknown-model
names are retained with daily aggregates and replayed under the matching context,
including when old source mtimes exclude those files from today's parse. Changes
to parsing or charging formulas still require the appropriate cache version/floor
bump; the context hash detects data changes, not arbitrary code changes.

## Cursor follow-up

`src/cursor-cache.ts:readCachedResults` still returns stored costs when database
size and mtime match. `src/providers/cursor.ts` returns those calls before pricing
or unknown-model registration. Daily context invalidation rebuilds the aggregates
but cannot correct stale Cursor provider costs. This remains separate provider
work; the Codex guarantee above does not imply Cursor repricing is fixed.

The bounded follow-up is to retain the original pricing model separately from the
display model in Cursor's parsed cache, then reprice cached calls and replay unknown
model diagnostics. Preserve `resolveModel`'s default-model behavior: null/default
is priced as `claude-sonnet-4-5` but displayed as `cursor-auto`; pricing the display
label instead could newly apply an alias and change cold/warm parity. Invalidate
old Cursor entries lacking the pricing model, reuse the daily pricing-context
contract, and exercise separate-process cold/warm, alias add/change/remove, and
rate-table changes against an unchanged synthetic SQLite database. Include a day
older than yesterday, unknown and null/default model rows, and the same source
fingerprint assertions as `tests/cli-codex-repricing.test.ts`. Cursor cache atomic
writes and `CODEBURN_CACHE_DIR` support are additional follow-up work; neither is
changed here.

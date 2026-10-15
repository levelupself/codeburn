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

## Report quality and provider coverage

`report --format json` adds `pricing` (price-table `source`: `live`, `cache`, or
`bundled-snapshot`; `fallback`; nullable refresh failure `reason`) and `dataQuality`.
The same quality counts are present on project rows, top-session rows, and parsed
session summaries. Counts come from the selected calls after date/provider/project
filters, never from the process-global warning set or the number of parsing passes.
They therefore survive warm Codex caches and exclude hydration-only usage.

Usage provenance is currently audited for Codex: `costIsEstimated: true` means the
existing character-based token approximation, and `false` means token-count events.
The marker survives normalized calls and session aggregation. Existing v2 parsed
Codex cache entries already mark approximations true; other v2 Codex calls can be
classified as observed on read without invalidating token data. Other providers
leave the marker absent and contribute to `unknownProvenanceCalls`, not
`observedCalls`. These labels describe usage provenance, not invoice verification,
model-alias accuracy, or every legacy adapter's estimation policy.

Per-call `pricingStatus` is currently audited for Claude and Codex, whose charging
paths use the model lookup directly. Positive usage with no price is `unpriced`;
a known rate (including a free rate), or genuinely zero usage, is `priced`.
Other adapters may use provider-supplied costs or a hidden pricing model, so their
missing status contributes to `unknownPricingCalls`; it is not classified from a
numeric zero or from a display label. Cursor's stored-cost limitations above remain.

`dataQuality` contains `observedCalls`, `estimatedCalls`,
`unknownProvenanceCalls`, `pricedCalls`, `unpricedCalls`, `unknownPricingCalls`,
`unpricedModels` (raw selected model names), and `costComplete`. The usage counts
and the pricing counts each partition selected calls. `costComplete` means no
unpriced or unaudited pricing calls remain; it does not imply observed usage or
fresh rates. Price-table fallback is an independent dimension in `pricing`.

Existing numeric cost fields are preserved for compatibility and can be partial.
The new `overview.completeCost` is null whenever `costComplete` is false, otherwise
it equals `overview.cost` in the active currency. Unknown amounts are never encoded
as a measured zero in this new field. Empty selections are complete zero totals.

Both interactive and static dashboards display estimated-call counts, unspecified
provenance, missing/unaudited pricing, and snapshot fallback above the panels.
The interactive notice follows the displayed selection and remains visible in
comparison/optimize views; refresh loading retains the fallback warning without
showing the previous selection's counts. Stderr diagnostics still run after exit.
These additions apply to dashboard reports and parsed summaries; status/menubar and
export-v2 payload schemas are unchanged in this slice.

Synthetic, isolated-home behavior coverage lives in
`tests/cli-report-quality.test.ts`, including JSON parsing, selection scope,
cold/warm reports, the normalized parser API, and a live Ink dashboard before `q`.

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import snapshotData from './data/litellm-snapshot.json'

export type ModelCosts = {
  inputCostPerToken: number
  outputCostPerToken: number
  cacheWriteCostPerToken: number
  cacheReadCostPerToken: number
  webSearchCostPerRequest: number
  fastMultiplier: number
}

type LiteLLMEntry = {
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_creation_input_token_cost?: number
  cache_read_input_token_cost?: number
  provider_specific_entry?: { fast?: number }
}

type SnapshotEntry = [number, number, number | null, number | null]

const LITELLM_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const WEB_SEARCH_COST = 0.01

const FAST_MULTIPLIERS: Record<string, number> = {
  'claude-opus-4-7': 6,
  'claude-opus-4-6': 6,
}

function loadSnapshot(): Map<string, ModelCosts> {
  const map = new Map<string, ModelCosts>()
  for (const [name, raw] of Object.entries(snapshotData as unknown as Record<string, SnapshotEntry>)) {
    const [input, output, cacheWrite, cacheRead] = raw
    map.set(name, {
      inputCostPerToken: input,
      outputCostPerToken: output,
      cacheWriteCostPerToken: cacheWrite ?? input * 1.25,
      cacheReadCostPerToken: cacheRead ?? input * 0.1,
      webSearchCostPerRequest: WEB_SEARCH_COST,
      fastMultiplier: FAST_MULTIPLIERS[name] ?? 1,
    })
  }
  return map
}

let pricingCache: Map<string, ModelCosts> = loadSnapshot()

let pricingIsStale = false
let pricingStaleReason = ''

/// Models we were asked to cost but could not find a price for. A missing price makes
/// `calculateCost` return 0, which is indistinguishable from "this really was free" --
/// so every such model is recorded here and the CLI reports it. Never let an unpriced
/// model quietly read as $0.00.
///
/// Names only, deliberately. A single command parses the same sessions more than once
/// (`status` covers today and the month; the daily cache hydrates separately), so
/// counting invocations here would report several times the real call count. The
/// per-model breakdown already shows accurate calls against a $0.00 cost; this set's job
/// is to make sure the zero gets noticed at all.
const unpricedModels = new Set<string>()

function recordUnpriced(model: string): void {
  unpricedModels.add(model)
}

/// Models that could not be priced, alphabetically. Empty when everything was priced.
export function getUnpricedModels(): string[] {
  return [...unpricedModels].sort((a, b) => a.localeCompare(b))
}

/// Test seam: parsing is process-global, so tests that assert on unpriced models
/// need to start from a known state.
export function resetUnpricedModels(): void {
  unpricedModels.clear()
}

function getCacheDir(): string {
  return join(homedir(), '.cache', 'codeburn')
}

function getCachePath(): string {
  return join(getCacheDir(), 'litellm-pricing.json')
}

function parseLiteLLMEntry(entry: LiteLLMEntry): ModelCosts | null {
  if (entry.input_cost_per_token === undefined || entry.output_cost_per_token === undefined) return null
  return {
    inputCostPerToken: entry.input_cost_per_token,
    outputCostPerToken: entry.output_cost_per_token,
    cacheWriteCostPerToken: entry.cache_creation_input_token_cost ?? entry.input_cost_per_token * 1.25,
    cacheReadCostPerToken: entry.cache_read_input_token_cost ?? entry.input_cost_per_token * 0.1,
    webSearchCostPerRequest: WEB_SEARCH_COST,
    fastMultiplier: entry.provider_specific_entry?.fast ?? 1,
  }
}

async function fetchAndCachePricing(): Promise<Map<string, ModelCosts>> {
  const response = await fetch(LITELLM_URL)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json() as Record<string, LiteLLMEntry>
  const pricing = new Map<string, ModelCosts>()

  for (const [name, entry] of Object.entries(data)) {
    const costs = parseLiteLLMEntry(entry)
    if (!costs) continue
    pricing.set(name, costs)
    // Also index by stripped name so lookups work without provider prefix:
    // 'anthropic/claude-opus-4-6' is also queryable as 'claude-opus-4-6'.
    // First write wins so direct-provider entries take precedence over re-hosters.
    const stripped = name.replace(/^[^/]+\//, '')
    if (stripped !== name && !pricing.has(stripped)) pricing.set(stripped, costs)
  }

  await mkdir(getCacheDir(), { recursive: true })
  await writeFile(getCachePath(), JSON.stringify({
    timestamp: Date.now(),
    data: Object.fromEntries(pricing),
  }))

  return pricing
}

async function loadCachedPricing(): Promise<Map<string, ModelCosts> | null> {
  try {
    const raw = await readFile(getCachePath(), 'utf-8')
    const cached = JSON.parse(raw) as { timestamp: number; data: Record<string, ModelCosts> }
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) return null
    return new Map(Object.entries(cached.data))
  } catch {
    return null
  }
}

export async function loadPricing(): Promise<void> {
  const cached = await loadCachedPricing()
  if (cached) {
    pricingCache = cached
    return
  }

  try {
    pricingCache = await fetchAndCachePricing()
  } catch (err) {
    // The bundled snapshot is already loaded, so pricing still works -- but it is
    // frozen at publish time and will not know models released since. Record why we
    // fell back so the CLI can say so instead of quietly reporting stale (or zero)
    // costs. Silently swallowing this is how "$0.00 for 546 calls" used to happen.
    pricingIsStale = true
    pricingStaleReason = err instanceof Error ? err.message : String(err)
  }
}

/// True when the live LiteLLM fetch failed and we are serving the bundled snapshot.
export function isPricingStale(): boolean {
  return pricingIsStale
}

export function getPricingStaleReason(): string {
  return pricingStaleReason
}

// Known model name variants that providers emit but LiteLLM/fallback don't index under.
// OMP emits 'anthropic--claude-4.6-opus' (double-dash, dot version, tier-last).
// getCanonicalName strips any 'provider/' prefix first, so only the post-strip
// forms need to be listed here.
const BUILTIN_ALIASES: Record<string, string> = {
  'anthropic--claude-4.6-opus':    'claude-opus-4-6',
  'anthropic--claude-4.6-sonnet':  'claude-sonnet-4-6',
  'anthropic--claude-4.5-opus':    'claude-opus-4-5',
  'anthropic--claude-4.5-sonnet':  'claude-sonnet-4-5',
  'anthropic--claude-4.5-haiku':   'claude-haiku-4-5',
  'cursor-auto':                    'claude-sonnet-4-5',
  'cursor-agent-auto':             'claude-sonnet-4-5',
  'copilot-auto':                  'claude-sonnet-4-5',
  'copilot-openai-auto':           'gpt-5.3-codex',
  'copilot-anthropic-auto':        'claude-sonnet-4-5',
  'kiro-auto':                     'claude-sonnet-4-5',
  'cline-auto':                    'claude-sonnet-4-5',
  'openclaw-auto':                 'claude-sonnet-4-5',
  'qwen-auto':                     'claude-sonnet-4-5',
  // Cursor emits dot-version tier-last names
  'claude-4.6-sonnet':              'claude-sonnet-4-6',
  'claude-4.5-sonnet-thinking':     'claude-sonnet-4-5',
  'claude-4-sonnet-thinking':       'claude-sonnet-4-5',
  'claude-4-opus':                  'claude-opus-4-5',
  'claude-4.5-opus-high-thinking':  'claude-opus-4-5',
  'gpt-4.1':                        'gpt-4.1',
  'gpt-5.2-low':                    'gpt-5',
  'gpt-5.1-codex-high':             'gpt-5.3-codex',
  // Codex writes its own turn labels into turn_context.model rather than a real model
  // id, so LiteLLM has no entry for them and the turns were costing $0 -- on real data
  // that hid 81 calls carrying 753K input and 3.1M cache-read tokens. These are
  // approximations: 'codex-auto-review' turns carry model_provider=openai and appear in
  // sessions whose explicitly-named model is gpt-5.5, and bare 'codex' matches the
  // codex provider's own unknown-model default. Override with `codeburn model-alias`.
  'codex-auto-review':              'gpt-5.5',
  'codex':                          'gpt-5',
  // Antigravity Gemini model IDs resolve to preview-priced entries.
  'gemini-3.1-pro':                 'gemini-3.1-pro-preview',
  'gemini-3-flash':                 'gemini-3-flash-preview',
  'gemini-3.1-pro-high':            'gemini-3.1-pro-preview',
  'gemini-3.1-pro-low':             'gemini-3.1-pro-preview',
  'gemini-3-flash-agent':           'gemini-3-flash-preview',
  'gemini-3-pro':                   'gemini-3-pro-preview',
  'gemini-3.1-flash-image':         'gemini-3.1-flash-image-preview',
  'gemini-3.1-flash-lite':          'gemini-3.1-flash-lite-preview',
}

let userAliases: Record<string, string> = {}

// Called once during CLI startup after config is loaded.
// User aliases take precedence over built-ins.
export function setModelAliases(aliases: Record<string, string>): void {
  userAliases = aliases
}

function resolveAlias(model: string): string {
  if (Object.hasOwn(userAliases, model)) return userAliases[model]!
  if (Object.hasOwn(BUILTIN_ALIASES, model)) return BUILTIN_ALIASES[model]!
  return model
}
function getCanonicalName(model: string): string {
  return model
    .replace(/@.*$/, '')       // strip pin: claude-sonnet-4-6@20250929 -> claude-sonnet-4-6
    .replace(/-\d{8}$/, '')   // strip date: claude-sonnet-4-20250514 -> claude-sonnet-4
    .replace(/^[^/]+\//, '') // strip provider prefix: anthropic/foo -> foo
}

export function getModelCosts(model: string): ModelCosts | null {
  // Try with provider prefix preserved (azure/gpt-5.4, openrouter/anthropic/claude-opus-4.6)
  const withPrefix = model.replace(/@.*$/, '').replace(/-\d{8}$/, '')
  if (pricingCache.has(withPrefix)) return pricingCache.get(withPrefix)!

  const canonical = resolveAlias(getCanonicalName(model))
  if (pricingCache.has(canonical)) return pricingCache.get(canonical)!

  // Longest prefix wins. Iterating in Map order and returning the FIRST match made the
  // price depend on LiteLLM's arbitrary key ordering: 'gpt-5.6-codex' matched 'gpt-5'
  // (index 334) before 'gpt-5.6' (index 394) and was billed at a quarter of the real
  // input rate, while 'gpt-5.5-codex' happened to resolve correctly because 'gpt-5.5'
  // sorted earlier. Two distinct keys of equal length cannot both prefix one string, so
  // longest-wins is total and order-independent.
  let bestKey = ''
  let bestCosts: ModelCosts | null = null
  for (const [key, costs] of pricingCache) {
    if (key.length <= bestKey.length) continue
    if (canonical.startsWith(key + '-') || canonical.startsWith(key)) {
      bestKey = key
      bestCosts = costs
    }
  }

  return bestCosts
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
  webSearchRequests: number,
  speed: 'standard' | 'fast' = 'standard',
): number {
  const costs = getModelCosts(model)
  if (!costs) {
    // Zero-token calls (Claude Code's `<synthetic>` error placeholders, for instance)
    // genuinely cost nothing; only flag a model when real usage went unpriced.
    const tokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens
    if (tokens > 0 || webSearchRequests > 0) recordUnpriced(model)
    return 0
  }

  const multiplier = speed === 'fast' ? costs.fastMultiplier : 1

  return multiplier * (
    inputTokens * costs.inputCostPerToken +
    outputTokens * costs.outputCostPerToken +
    cacheCreationTokens * costs.cacheWriteCostPerToken +
    cacheReadTokens * costs.cacheReadCostPerToken +
    webSearchRequests * costs.webSearchCostPerRequest
  )
}

const autoModelNames: Record<string, string> = {
  'cursor-auto': 'Cursor (auto)',
  'cursor-agent-auto': 'Cursor (auto)',
  'copilot-auto': 'Copilot (auto)',
  'copilot-openai-auto': 'Copilot (OpenAI)',
  'copilot-anthropic-auto': 'Copilot (Anthropic)',
  'kiro-auto': 'Kiro (auto)',
  'cline-auto': 'Cline (auto)',
  'openclaw-auto': 'OpenClaw (auto)',
  'qwen-auto': 'Qwen (auto)',
  // Checked before alias resolution, so these keep their own line in the breakdown
  // instead of disappearing into the model they are priced against -- same trick the
  // *-auto entries above use. Losing the distinction would trade one blind spot
  // (unpriced) for another (unattributable).
  'codex-auto-review': 'Codex Auto Review',
  'codex': 'Codex',
}

export function getShortModelName(model: string): string {
  if (autoModelNames[model]) return autoModelNames[model]
  const canonical = resolveAlias(getCanonicalName(model))
  const shortNames: Record<string, string> = {
    'claude-opus-4-7': 'Opus 4.7',
    'claude-opus-4-6': 'Opus 4.6',
    'claude-opus-4-5': 'Opus 4.5',
    'claude-opus-4-1': 'Opus 4.1',
    'claude-opus-4': 'Opus 4',
    'claude-sonnet-4-6': 'Sonnet 4.6',
    'claude-sonnet-4-5': 'Sonnet 4.5',
    'claude-sonnet-4': 'Sonnet 4',
    'claude-3-7-sonnet': 'Sonnet 3.7',
    'claude-3-5-sonnet': 'Sonnet 3.5',
    'claude-haiku-4-5': 'Haiku 4.5',
    'claude-3-5-haiku': 'Haiku 3.5',
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o': 'GPT-4o',
    'gpt-4.1-nano': 'GPT-4.1 Nano',
    'gpt-4.1-mini': 'GPT-4.1 Mini',
    'gpt-4.1': 'GPT-4.1',
    'codex-auto-review': 'Codex Auto Review',
    'gpt-5.5-pro': 'GPT-5.5 Pro',
    'gpt-5.5': 'GPT-5.5',
    'gpt-5.4-pro': 'GPT-5.4 Pro',
    'gpt-5.4-nano': 'GPT-5.4 Nano',
    'gpt-5.4-mini': 'GPT-5.4 Mini',
    'gpt-5.4': 'GPT-5.4',
    'gpt-5.3-codex': 'GPT-5.3 Codex',
    'gpt-5.3': 'GPT-5.3',
    'gpt-5.2-pro': 'GPT-5.2 Pro',
    'gpt-5.2-low': 'GPT-5.2 Low',
    'gpt-5.2': 'GPT-5.2',
    'gpt-5.1-codex-mini': 'GPT-5.1 Codex Mini',
    'gpt-5.1-codex': 'GPT-5.1 Codex',
    'gpt-5.1': 'GPT-5.1',
    'gpt-5-pro': 'GPT-5 Pro',
    'gpt-5-nano': 'GPT-5 Nano',
    'gpt-5-mini': 'GPT-5 Mini',
    'gpt-5': 'GPT-5',
    'gemini-3.1-pro-preview': 'Gemini 3.1 Pro',
    'gemini-3-flash-preview': 'Gemini 3 Flash',
    'gemini-2.5-pro': 'Gemini 2.5 Pro',
    'gemini-2.5-flash': 'Gemini 2.5 Flash',
    'deepseek-coder-max': 'DeepSeek Coder Max',
    'deepseek-coder': 'DeepSeek Coder',
    'deepseek-r1': 'DeepSeek R1',
    'o4-mini': 'o4-mini',
    'o3': 'o3',
    'MiniMax-M2.7-highspeed': 'MiniMax M2.7 Highspeed',
    'MiniMax-M2.7': 'MiniMax M2.7',
  }
  for (const [key, name] of Object.entries(shortNames)) {
    if (canonical.startsWith(key)) return name
  }
  return canonical
}

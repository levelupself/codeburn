import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  calculateCost,
  getModelCosts,
  getShortModelName,
  getUnpricedModels,
  resetUnpricedModels,
  setModelAliases,
} from '../src/models.js'

// This file deliberately never calls loadPricing(). That leaves the module serving the
// snapshot bundled into src/data/, which is exactly the code path a user hits when the
// LiteLLM fetch fails: offline, behind a proxy, or with raw.githubusercontent.com
// blocked. Every assertion below is therefore about the *shipped* price table, not about
// whatever the network happened to return.

beforeEach(() => resetUnpricedModels())
afterEach(() => {
  setModelAliases({})
  resetUnpricedModels()
})

// D1 -- the bundled snapshot went stale and shipped without the Claude 5 family, so an
// offline run reported "$0.00 for 546 calls" with no warning. These models must be
// priced from the snapshot alone; if this fails, the snapshot was published stale again.
describe('D1: bundled snapshot prices current models offline', () => {
  const currentModels = [
    'claude-opus-5',
    'claude-fable-5',
    'claude-sonnet-5',
    'claude-haiku-4-5',
    'gpt-5.6',
    'gpt-5.5',
  ]

  for (const model of currentModels) {
    it(`prices ${model} without a network fetch`, () => {
      const costs = getModelCosts(model)
      expect(costs, `${model} missing from the bundled snapshot`).not.toBeNull()
      expect(costs!.inputCostPerToken).toBeGreaterThan(0)
      expect(costs!.outputCostPerToken).toBeGreaterThan(0)
    })
  }

  it('costs a realistic Claude 5 session at more than zero offline', () => {
    // Real shape of a cached agent turn: almost everything is cache reads.
    const cost = calculateCost('claude-opus-5', 92, 42643, 118165, 4287328, 0)
    expect(cost).toBeGreaterThan(0)
    expect(getUnpricedModels()).toEqual([])
  })
})

// D1 -- an unrecognised model costs $0, which is indistinguishable from "this was free".
// It has to be recorded so the CLI can say so.
describe('D1: unpriced models are recorded, never silently zero', () => {
  it('records a model with no price at all', () => {
    const cost = calculateCost('totally-unknown-model-xyz', 1000, 500, 0, 0, 0)
    expect(cost).toBe(0)
    expect(getUnpricedModels()).toEqual(['totally-unknown-model-xyz'])
  })

  it('records each distinct model once, however often it is costed', () => {
    // A single command parses the same sessions more than once (today + month, plus
    // cache hydration), so the report must not multiply with the number of passes.
    calculateCost('unknown-a', 100, 0, 0, 0, 0)
    calculateCost('unknown-a', 0, 200, 0, 0, 0)
    calculateCost('unknown-a', 0, 200, 0, 0, 0)
    calculateCost('unknown-b', 0, 0, 0, 50, 0)

    expect(getUnpricedModels()).toEqual(['unknown-a', 'unknown-b'])
  })

  it('does not flag zero-token calls', () => {
    // Claude Code writes `<synthetic>` placeholders carrying no usage. Those really are
    // free and must not be reported as a pricing hole.
    expect(calculateCost('<synthetic>', 0, 0, 0, 0, 0)).toBe(0)
    expect(getUnpricedModels()).toEqual([])
  })

  it('does not flag a model that resolved to a price', () => {
    calculateCost('claude-opus-5', 100, 100, 0, 0, 0)
    expect(getUnpricedModels()).toEqual([])
  })

  it('flags a web-search-only call on an unknown model', () => {
    calculateCost('unknown-searcher', 0, 0, 0, 0, 3)
    expect(getUnpricedModels()).toEqual(['unknown-searcher'])
  })
})

// D2 -- Codex writes its own turn labels into turn_context.model. On real data
// 'codex-auto-review' covered 81 calls carrying 753K input and 3.1M cache-read tokens,
// all of it costing $0.00 and invisible in every total.
describe('D2: Codex pseudo-models are priced', () => {
  it('prices codex-auto-review', () => {
    const costs = getModelCosts('codex-auto-review')
    expect(costs).not.toBeNull()
    expect(costs!.inputCostPerToken).toBeGreaterThan(0)
  })

  it('prices bare codex', () => {
    expect(getModelCosts('codex')).not.toBeNull()
  })

  it('costs the real-world codex-auto-review volume above zero', () => {
    const cost = calculateCost('codex-auto-review', 753_712, 7_751, 0, 3_096_960, 0)
    expect(cost).toBeGreaterThan(0)
    expect(getUnpricedModels()).toEqual([])
  })

  it('leaves codex-mini-latest on its own real pricing entry', () => {
    // The bare-'codex' alias must not swallow longer, genuine model ids.
    const mini = getModelCosts('codex-mini-latest')
    expect(mini).not.toBeNull()
    expect(mini).not.toEqual(getModelCosts('codex'))
  })

  it('lets a user alias override the built-in guess', () => {
    setModelAliases({ 'codex-auto-review': 'claude-opus-5' })
    expect(getModelCosts('codex-auto-review')).toEqual(getModelCosts('claude-opus-5'))
  })
})

// D3 -- the prefix fallback returned the FIRST key in Map order that prefixed the model
// name, so pricing depended on LiteLLM's arbitrary key ordering. 'gpt-5.6-codex' matched
// 'gpt-5' and was billed at a quarter of the real input rate; 'gpt-5.5-codex' resolved
// correctly only because 'gpt-5.5' happened to sort earlier.
describe('D3: prefix resolution is deterministic (longest wins)', () => {
  it('resolves gpt-5.6-codex to gpt-5.6, not gpt-5', () => {
    const resolved = getModelCosts('gpt-5.6-codex')
    expect(resolved).not.toBeNull()
    expect(resolved).toEqual(getModelCosts('gpt-5.6'))
    expect(resolved).not.toEqual(getModelCosts('gpt-5'))
  })

  it('resolves gpt-5.5-codex to gpt-5.5, not gpt-5', () => {
    const resolved = getModelCosts('gpt-5.5-codex')
    expect(resolved).not.toBeNull()
    expect(resolved).toEqual(getModelCosts('gpt-5.5'))
  })

  it('does not undercharge a 5.6 variant at gpt-5 rates', () => {
    const five = getModelCosts('gpt-5')
    const variant = getModelCosts('gpt-5.6-codex')
    expect(five).not.toBeNull()
    expect(variant).not.toBeNull()
    expect(variant!.inputCostPerToken).toBeGreaterThan(five!.inputCostPerToken)
  })

  it('is stable across repeated lookups', () => {
    const first = getModelCosts('gpt-5.6-codex')
    for (let i = 0; i < 5; i++) {
      expect(getModelCosts('gpt-5.6-codex')).toEqual(first)
    }
  })

  it('still prefers an exact entry over any prefix match', () => {
    expect(getModelCosts('gpt-5.6')).toEqual(getModelCosts('gpt-5.6'))
    expect(getModelCosts('gpt-5.6')).not.toEqual(getModelCosts('gpt-5'))
  })
})

// D2 -- pricing a pseudo-model must not erase it from the breakdown. Aliasing is a
// pricing decision; the display name stays its own line so 'Codex Auto Review' spend
// remains attributable instead of silently folding into GPT-5.5.
describe('D2: priced pseudo-models keep their own identity', () => {
  it('still displays codex-auto-review under its own name', () => {
    expect(getShortModelName('codex-auto-review')).toBe('Codex Auto Review')
    expect(getShortModelName('codex-auto-review')).not.toBe(getShortModelName('gpt-5.5'))
  })

  it('still displays bare codex under its own name', () => {
    expect(getShortModelName('codex')).toBe('Codex')
  })

  it('does not shadow codex-mini-latest', () => {
    expect(getShortModelName('codex-mini-latest')).not.toBe('Codex')
  })
})

// D3 -- longest-prefix-wins has to scan the whole price table, so lookups are memoised.
// A memo is only as correct as its invalidation: if it outlives a change to the alias
// table or the price table, a user's `codeburn model-alias` override silently keeps
// resolving to the old price, which is the same class of quietly-wrong number this whole
// change set exists to remove.
describe('D3: memoised lookups follow their inputs', () => {
  it('re-resolves a model after a user alias is added', () => {
    const builtin = getModelCosts('gpt-5.6-codex')
    expect(builtin).toEqual(getModelCosts('gpt-5.6'))

    setModelAliases({ 'gpt-5.6-codex': 'gpt-5' })
    expect(getModelCosts('gpt-5.6-codex')).toEqual(getModelCosts('gpt-5'))
  })

  it('re-resolves a model after a user alias is removed', () => {
    setModelAliases({ 'gpt-5.6-codex': 'gpt-5' })
    expect(getModelCosts('gpt-5.6-codex')).toEqual(getModelCosts('gpt-5'))

    setModelAliases({})
    expect(getModelCosts('gpt-5.6-codex')).toEqual(getModelCosts('gpt-5.6'))
  })

  it('does not keep serving a miss that an alias has since fixed', () => {
    // Misses are cached too -- an unpriced model scans the whole table before being
    // recorded -- so the negative entry has to be dropped along with the positive ones.
    expect(getModelCosts('house-brand-model')).toBeNull()

    setModelAliases({ 'house-brand-model': 'claude-opus-5' })
    expect(getModelCosts('house-brand-model')).toEqual(getModelCosts('claude-opus-5'))
  })

  it('still records a repeat unpriced model even when the lookup is memoised', () => {
    calculateCost('unknown-memoised', 100, 0, 0, 0, 0)
    calculateCost('unknown-memoised', 100, 0, 0, 0, 0)
    expect(getUnpricedModels()).toEqual(['unknown-memoised'])
  })
})

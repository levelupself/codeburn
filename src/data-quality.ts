import { getModelCosts } from './models.js'
import type { DataQuality, ParsedApiCall, ProjectSummary, TokenUsage } from './types.js'

// Only use where the adapter's price calculation is known to match this lookup
// (currently Claude and Codex). Other adapters may use provider costs or hidden models.
export function usagePricingStatus(model: string, usage: TokenUsage): 'priced' | 'unpriced' {
  const hasUsage = usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens
    + usage.cacheReadInputTokens + usage.reasoningTokens + usage.webSearchRequests > 0
  return hasUsage && !getModelCosts(model) ? 'unpriced' : 'priced'
}

export function summarizeCallQuality(calls: Iterable<ParsedApiCall>): DataQuality {
  const quality: DataQuality = {
    observedCalls: 0, estimatedCalls: 0, unknownProvenanceCalls: 0,
    pricedCalls: 0, unpricedCalls: 0, unknownPricingCalls: 0,
    unpricedModels: [], costComplete: true,
  }
  const unpricedModels = new Set<string>()
  for (const call of calls) {
    if (call.costIsEstimated === true) quality.estimatedCalls++
    else if (call.costIsEstimated === false) quality.observedCalls++
    else quality.unknownProvenanceCalls++
    if (call.pricingStatus === 'priced') quality.pricedCalls++
    else if (call.pricingStatus === 'unpriced') {
      quality.unpricedCalls++
      unpricedModels.add(call.model)
    } else quality.unknownPricingCalls++
  }
  quality.unpricedModels = [...unpricedModels].sort((a, b) => a.localeCompare(b))
  quality.costComplete = quality.unpricedCalls === 0 && quality.unknownPricingCalls === 0
  return quality
}

export function summarizeProjectQuality(projects: ProjectSummary[]): DataQuality {
  return summarizeCallQuality(projects.flatMap(p => p.sessions.flatMap(s => s.turns.flatMap(t => t.assistantCalls))))
}

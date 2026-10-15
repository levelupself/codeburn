import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const unknown = 'fixture-unknown-model'
let home: string
let cache: string
let source: string
let original: string
let originalMtime: number
let date: string

function cli(args: string[]) {
  const result = spawnSync(process.execPath, [
    '--require', resolve('tests/fixtures/offline-home.cjs'), '--import', 'tsx', 'src/cli.ts', ...args,
  ], {
    encoding: 'utf8', timeout: 30_000,
    env: {
      ...process.env, HOME: home, CODEBURN_CACHE_DIR: cache, TZ: 'UTC', CODEBURN_TZ: 'UTC',
      NODE_OPTIONS: '', CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
      XDG_DATA_HOME: join(home, '.local/share'), FACTORY_DIR: join(home, '.factory'),
      QWEN_DATA_DIR: join(home, '.qwen'), GOOSE_PATH_ROOT: join(home, '.goose'),
    },
  })
  expect(result.status, result.stderr).toBe(0)
  return result
}

function report() {
  const result = cli(['report', '--provider', 'codex', '--format', 'json', '-p', 'all'])
  return { cost: JSON.parse(result.stdout).overview.cost as number, stderr: result.stderr }
}

function status() {
  return JSON.parse(cli(['status', '--format', 'menubar-json', '--period', 'all', '--no-optimize']).stdout)
}

async function coldReport() {
  await rm(join(cache, 'codex-results.json'), { force: true })
  return report()
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'codeburn-repricing-'))
  cache = join(home, 'cache')
  const day = new Date()
  day.setUTCDate(day.getUTCDate() - 10) // Yesterday refresh cannot mask stale historical costs.
  day.setUTCHours(12, 0, 0, 0)
  date = day.toISOString().slice(0, 10)
  const dir = join(home, '.codex/sessions', ...date.split('-'))
  await mkdir(dir, { recursive: true })
  source = join(dir, 'rollout-fixture.jsonl')
  original = [
    { type: 'session_meta', timestamp: day.toISOString(), payload: {
      session_id: 'fixture', originator: 'codex-cli', cwd: '/synthetic/project', model: unknown,
    } },
    { type: 'event_msg', timestamp: day.toISOString(), payload: { type: 'token_count', info: {
      last_token_usage: { input_tokens: 100000, cached_input_tokens: 40000, output_tokens: 1000, reasoning_output_tokens: 500 },
      total_token_usage: { total_tokens: 101500 },
    } } },
  ].map(record => JSON.stringify(record)).join('\n') + '\n'
  await writeFile(source, original)
  // Match real historical files, which may be skipped when parsing today's range.
  await utimes(source, day, day)
  originalMtime = (await stat(source)).mtimeMs
})

afterEach(async () => {
  expect(await readFile(source, 'utf8')).toBe(original)
  expect((await stat(source)).mtimeMs).toBe(originalMtime)
  await rm(home, { recursive: true, force: true })
})

describe('Codex CLI repricing across separate processes', () => {
  it('names unknown models on both cold and warm reports', () => {
    for (const result of [report(), report()]) {
      expect(result.cost).toBe(0)
      expect(result.stderr).toContain('no known price')
      expect(result.stderr).toContain(unknown)
    }
  })

  it('applies saved, changed and removed aliases with unchanged source fingerprints', async () => {
    report() // Appendix B cold
    report() // Appendix B warm
    for (const [target, expected] of [['claude-sonnet-4-5', 0.21], ['claude-opus-4-5', 0.36]] as const) {
      cli(['model-alias', unknown, target])
      const warm = report() // Appendix B aliased-warm
      const cold = await coldReport() // Appendix B aliased-cold
      expect(warm.cost).toBeCloseTo(expected, 8)
      expect(warm.cost).toBe(cold.cost)
      expect(warm.stderr).not.toContain('no known price')
    }
    cli(['model-alias', '--remove', unknown])
    const removed = report()
    expect(removed.cost).toBe(0)
    expect(removed.stderr).toContain(unknown)
    expect(removed.cost).toBe((await coldReport()).cost)
  }, 30_000)

  it('refreshes historical daily totals after alias and effective price changes', async () => {
    const historyArgs = ['status', '--format', 'menubar-json', '--period', 'all', '--no-optimize']
    for (const result of [cli(historyArgs), cli(historyArgs)]) {
      expect(result.stderr).toContain('no known price')
      expect(result.stderr).toContain(unknown)
    }
    const dayCost = () => status().history.daily.find((d: { date: string }) => d.date === date)?.cost
    expect(dayCost()).toBe(0)
    cli(['model-alias', unknown, 'claude-sonnet-4-5'])
    expect(dayCost()).toBeCloseTo(0.2145, 8)
    cli(['model-alias', unknown, 'claude-opus-4-5'])
    expect(dayCost()).toBeCloseTo(0.3575, 8)
    cli(['model-alias', '--remove', unknown])
    expect(dayCost()).toBe(0)

    // The persisted effective price table changes, while aliases and sources stay fixed.
    const pricingDir = join(home, '.cache/codeburn')
    await mkdir(pricingDir, { recursive: true })
    const priceFile = join(pricingDir, 'litellm-pricing.json')
    const setPrice = async (inputCostPerToken: number) => writeFile(priceFile, JSON.stringify({
      timestamp: Date.now(), data: { [unknown]: {
        inputCostPerToken, outputCostPerToken: 0.00002, cacheWriteCostPerToken: 0.00001,
        cacheReadCostPerToken: 0.000001, webSearchCostPerRequest: 0.01, fastMultiplier: 1,
      } },
    }))
    await setPrice(0.00001)
    expect(dayCost()).toBeCloseTo(0.67, 8)
    await setPrice(0.00002)
    expect(dayCost()).toBeCloseTo(1.27, 8)
  }, 30_000)
})

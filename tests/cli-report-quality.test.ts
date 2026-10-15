import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import stripAnsi from 'strip-ansi'

let home: string
let cache: string
let timestamp: string
const unknown = 'fixture-unpriced-quality'
const baseArgs = ['--require', resolve('tests/fixtures/offline-home.cjs'), '--import', 'tsx', 'src/cli.ts']
function env() {
  return { ...process.env, HOME: home, CODEBURN_CACHE_DIR: cache, TZ: 'UTC', CODEBURN_TZ: 'UTC',
    NODE_OPTIONS: '', CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
    XDG_DATA_HOME: join(home, '.local/share'), FACTORY_DIR: join(home, '.factory'),
    QWEN_DATA_DIR: join(home, '.qwen'), GOOSE_PATH_ROOT: join(home, '.goose') }
}
function report(args: string[] = []) {
  const result = spawnSync(process.execPath, [...baseArgs, 'report', '--provider', 'codex', '--format', 'json', ...args], {
    env: env(), encoding: 'utf8', timeout: 30_000,
  })
  expect(result.status, result.stderr).toBe(0)
  return { data: JSON.parse(result.stdout), stderr: result.stderr }
}
async function session(name: string, estimated: boolean, model = 'gpt-5') {
  const dir = join(home, '.codex/sessions', ...timestamp.slice(0, 10).split('-'))
  await mkdir(dir, { recursive: true })
  const records = [
    { type: 'session_meta', timestamp, payload: { session_id: name, originator: 'codex-cli', cwd: `/synthetic/${name}`, model } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'synthetic request' }] } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'synthetic response' }] } },
    { type: 'event_msg', timestamp, payload: { type: 'token_count', ...(estimated ? {} : { info: {
      last_token_usage: { input_tokens: 1000, output_tokens: 100 }, total_token_usage: { total_tokens: 1100 },
    } }) } },
  ]
  await writeFile(join(dir, `rollout-${name}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n')
}
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'codeburn-quality-'))
  cache = join(home, 'cache')
  timestamp = new Date().toISOString()
  await session('observed', false)
  await session('estimated', true)
})
afterEach(async () => { await rm(home, { recursive: true, force: true }) })

describe('report data quality', () => {
  it('distinguishes observed and estimated calls on cold and warm reports', async () => {
    for (let pass = 0; pass < 2; pass++) {
      const { data, stderr } = report()
      expect(data.overview.calls).toBe(2)
      expect(data.dataQuality).toMatchObject({ observedCalls: 1, estimatedCalls: 1, unknownProvenanceCalls: 0, unpricedCalls: 0, costComplete: true })
      expect(data.topSessions.find((s: { sessionId: string }) => s.sessionId === 'observed').dataQuality.observedCalls).toBe(1)
      expect(data.topSessions.find((s: { sessionId: string }) => s.sessionId === 'estimated').dataQuality.estimatedCalls).toBe(1)
      expect(data.pricing).toMatchObject({ source: 'bundled-snapshot', fallback: true, reason: 'test: network disabled' })
      expect(stderr).toContain('could not refresh model prices')
    }
    const stored = JSON.parse(await readFile(join(cache, 'codex-results.json'), 'utf8'))
    expect(Object.keys(stored.files)).toHaveLength(2)
  })

  it('preserves call markers and per-session counts through the parser on warm caches', () => {
    for (let pass = 0; pass < 2; pass++) {
      const result = spawnSync(process.execPath, [...baseArgs.slice(0, -1), '--input-type=module', '--eval', `
        const { parseAllSessions } = await import('./src/parser.ts');
        console.log(JSON.stringify(await parseAllSessions(undefined, 'codex')));
      `], { env: env(), encoding: 'utf8', timeout: 30_000 })
      expect(result.status, result.stderr).toBe(0)
      const sessions = JSON.parse(result.stdout).flatMap((p: { sessions: unknown[] }) => p.sessions)
      const observed = sessions.find((s: { sessionId: string }) => s.sessionId === 'observed')
      const estimated = sessions.find((s: { sessionId: string }) => s.sessionId === 'estimated')
      expect(observed.turns[0].assistantCalls[0].costIsEstimated).toBe(false)
      expect(estimated.turns[0].assistantCalls[0].costIsEstimated).toBe(true)
      expect(observed.dataQuality).toMatchObject({ observedCalls: 1, estimatedCalls: 0 })
      expect(estimated.dataQuality).toMatchObject({ observedCalls: 0, estimatedCalls: 1 })
    }
  })

  it('keeps unaudited usage provenance unknown rather than observed', async () => {
    const dir = join(home, '.claude/projects/legacy')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'legacy.jsonl'), JSON.stringify({
      type: 'assistant', sessionId: 'legacy', cwd: '/synthetic/legacy', timestamp,
      message: { id: 'legacy', model: 'claude-sonnet-4-5', role: 'assistant', content: [],
        usage: { input_tokens: 1000, output_tokens: 100 } },
    }) + '\n')
    const { data } = report(['--provider', 'claude'])
    expect(data.overview.calls).toBe(1)
    expect(data.dataQuality).toMatchObject({ observedCalls: 0, estimatedCalls: 0, unknownProvenanceCalls: 1, costComplete: true })
  })

  it('counts only selected calls even when hydration parsed an unpriced project', async () => {
    await session('unpriced', false, unknown)
    report() // Hydrate and warm every project before selecting one.
    const { data } = report(['--project', 'estimated'])
    expect(data.dataQuality).toMatchObject({ observedCalls: 0, estimatedCalls: 1, unpricedCalls: 0, unpricedModels: [], costComplete: true })
    const empty = report(['--project', 'absent']).data
    expect(empty.dataQuality).toMatchObject({ observedCalls: 0, estimatedCalls: 0, unpricedCalls: 0 })
  })

  it('marks missing amounts incomplete without changing legacy numeric fields', async () => {
    await session('unpriced', false, unknown)
    for (let pass = 0; pass < 2; pass++) {
      const { data, stderr } = report(['--project', 'unpriced'])
      expect(data.overview.cost).toBe(0)
      expect(data.overview.completeCost).toBeNull()
      expect(data.dataQuality).toMatchObject({ observedCalls: 1, unpricedCalls: 1, unpricedModels: [unknown], costComplete: false })
      expect(stderr).toContain('no known price')
    }
  })

  it('labels fresh cached rates without a fallback warning', async () => {
    const dir = join(home, '.cache/codeburn')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'litellm-pricing.json'), JSON.stringify({ timestamp: Date.now(), data: { 'gpt-5': {
      inputCostPerToken: 0.000001, outputCostPerToken: 0.00001, cacheWriteCostPerToken: 0.000001,
      cacheReadCostPerToken: 0.0000001, webSearchCostPerRequest: 0.01, fastMultiplier: 1,
    } } }))
    const { data, stderr } = report()
    expect(data.pricing).toEqual({ source: 'cache', fallback: false, reason: null })
    expect(data.overview.completeCost).toBe(data.overview.cost)
    expect(stderr).not.toContain('could not refresh model prices')
  })

  it('shows estimate and pricing warnings before the interactive dashboard exits', async () => {
    await session('unpriced', false, unknown)
    const child = spawn(process.execPath, [
      '--require', resolve('tests/fixtures/interactive-tty.cjs'), ...baseArgs,
      'report', '--provider', 'codex', '--refresh', '0',
    ], { env: env(), stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let stderr = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const exited = new Promise<number | null>(resolve => child.once('exit', resolve))
    try {
      await new Promise<void>((resolve, reject) => {
        const deadline = setTimeout(() => { cleanup(); reject(new Error(`dashboard did not show quality before exit: ${stripAnsi(output)} ${stderr}`)) }, 15_000)
        const check = () => {
          const plain = stripAnsi(output)
          if (plain.includes('1 estimated call') && plain.includes('1 unpriced call') && plain.includes('bundled snapshot')) {
            cleanup(); resolve()
          }
        }
        const cleanup = () => { clearTimeout(deadline); child.stdout.off('data', check) }
        child.stdout.on('data', check)
      })
      expect(child.exitCode).toBeNull()
      child.stdin.write('q')
      expect(await exited).toBe(0)
    } finally {
      if (child.exitCode === null) child.kill()
      await exited
    }
  }, 20_000)
})

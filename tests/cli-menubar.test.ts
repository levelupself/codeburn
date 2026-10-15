import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MenubarPayload } from '../src/menubar-json.js'

let home: string

function day(offset: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offset)
  date.setUTCHours(0, 0, 0, 0)
  return date.toISOString()
}

async function writeClaude(project: string, id: string, offset: number, tokens: number) {
  const dir = join(home, '.claude', 'projects', project)
  await mkdir(dir, { recursive: true })
  const base = { sessionId: id, cwd: join(home, project), timestamp: day(offset) }
  const records = [
    { ...base, type: 'user', message: { role: 'user', content: 'Explain this module' } },
    { ...base, type: 'assistant', message: {
      id, role: 'assistant', model: 'claude-sonnet-4-5', content: [],
      usage: { input_tokens: tokens, output_tokens: 1000 },
    } },
  ]
  await writeFile(join(dir, `${id}.jsonl`), records.map(r => JSON.stringify(r)).join('\n') + '\n')
}

async function writeCodex() {
  const dir = join(home, '.codex', 'sessions', ...day(-1).slice(0, 10).split('-'))
  await mkdir(dir, { recursive: true })
  const records = [
    { type: 'session_meta', timestamp: day(-1), payload: {
      cwd: join(home, 'alpha'), originator: 'codex-cli', session_id: 'codex-alpha', model: 'claude-sonnet-4-5',
    } },
    { type: 'event_msg', timestamp: day(-1), payload: {
      type: 'token_count', info: {
        last_token_usage: { input_tokens: 10000, output_tokens: 1000 },
        total_token_usage: { input_tokens: 10000, output_tokens: 1000 },
      },
    } },
  ]
  await writeFile(join(dir, 'rollout-alpha.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + '\n')
}

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [
    '--require', resolve('tests/helpers/offline-home.cjs'), '--import', 'tsx', 'src/cli.ts', ...args,
  ], {
    encoding: 'utf-8', timeout: 30000,
    env: {
      ...process.env, HOME: home, CODEBURN_TEST_HOME: home,
      CODEBURN_CACHE_DIR: join(home, 'cache'),
      CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'),
      QWEN_DATA_DIR: join(home, '.qwen'), FACTORY_DIR: join(home, '.factory'),
      XDG_DATA_HOME: join(home, '.local', 'share'), GOOSE_PATH_ROOT: join(home, '.goose'),
      TZ: 'UTC', CODEBURN_TZ: 'UTC',
    },
  })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

function menubar(filters: string[] = [], period = 'week'): MenubarPayload {
  return runCli(['status', '--format', 'menubar-json', '--no-optimize', '--period', period, ...filters])
}

function expectScope(payload: MenubarPayload, cost: number, calls: number, yesterdayCost: number) {
  expect(payload.current.cost).toBeCloseTo(cost, 6)
  expect(payload.current.calls).toBe(calls)
  expect(payload.current.sessions).toBe(calls)
  expect(Object.values(payload.current.providers).reduce((sum, value) => sum + value, 0)).toBeCloseTo(cost, 6)
  expect(payload.history.daily.find(d => d.date === day(-1).slice(0, 10))?.cost ?? 0).toBeCloseTo(yesterdayCost, 6)
  expect(payload.history.daily.reduce((sum, d) => sum + d.calls, 0)).toBe(calls)
  expect(payload.history.daily.reduce((sum, d) => sum + d.cost, 0)).toBeCloseTo(cost, 6)
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'codeburn-menubar-'))
  await writeClaude('alpha', 'alpha-yesterday', -1, 100000)
  await writeClaude('alpha', 'alpha-today', 0, 10000)
  await writeClaude('beta', 'beta-yesterday', -1, 300000)
})

afterEach(async () => { await rm(home, { recursive: true, force: true }) })

describe.each(['cold', 'warm'])('menubar CLI with %s aggregate cache', (cacheState) => {
  beforeEach(() => {
    if (cacheState === 'warm') expectScope(menubar(), 1.275, 3, 1.23)
  })

  it.each([
    { filters: ['--project', 'alpha'], cost: 0.36, calls: 2, yesterday: 0.315 },
    { filters: ['--exclude', 'beta'], cost: 0.36, calls: 2, yesterday: 0.315 },
    { filters: ['--project', 'beta'], cost: 0.915, calls: 1, yesterday: 0.915 },
    { filters: ['--project', 'missing'], cost: 0, calls: 0, yesterday: 0 },
    { filters: ['--project', 'alpha', '--exclude', 'alpha'], cost: 0, calls: 0, yesterday: 0 },
    { filters: [], cost: 1.275, calls: 3, yesterday: 1.23 },
  ])('scopes current, providers and history for $filters', ({ filters, cost, calls, yesterday }) => {
    expectScope(menubar(filters), cost, calls, yesterday)
    // A filtered request must not poison the shared all-project daily cache.
    expectScope(menubar(), 1.275, 3, 1.23)
  })

  it('combines project and provider filters across current and history', async () => {
    await writeCodex()
    const claude = menubar(['--project', 'alpha', '--provider', 'claude'])
    expectScope(claude, 0.36, 2, 0.315)
    expect(claude.current.providers).toEqual({ claude: expect.closeTo(0.36, 6) })
    const codex = menubar(['--exclude', 'beta', '--provider', 'codex'])
    expectScope(codex, 0.045, 1, 0.045)
    expect(codex.current.providers).toEqual({ codex: expect.closeTo(0.045, 6) })
    expectScope(menubar(['--project', 'beta', '--provider', 'codex']), 0, 0, 0)
    expectScope(menubar(['--project', 'alpha']), 0.405, 3, 0.36)
  })
})

it('keeps full filtered history outside the current period and leaves a warm cache untouched', async () => {
  await writeClaude('alpha', 'alpha-older', -10, 100000)
  await writeClaude('beta', 'beta-older', -10, 300000)
  menubar()
  const cachePath = join(home, 'cache', 'daily-cache.json')
  const cacheBefore = await readFile(cachePath, 'utf-8')
  const payload = menubar(['--project', 'alpha'], 'today')
  expect(payload.current.cost).toBeCloseTo(0.045, 6)
  expect(payload.current.calls).toBe(1)
  expect(payload.current.sessions).toBe(1)
  expect(payload.current.providers).toEqual({ claude: expect.closeTo(0.045, 6) })
  expect(payload.history.daily.map(d => d.date)).toEqual([day(-10), day(-1), day(0)].map(d => d.slice(0, 10)))
  expect(payload.history.daily.map(d => d.cost)).toEqual([
    expect.closeTo(0.315, 6), expect.closeTo(0.315, 6), expect.closeTo(0.045, 6),
  ])
  expect(payload.history.daily[0].inputTokens).toBe(100000)
  expect(payload.history.daily[0].topModels[0].cost).toBeCloseTo(0.315, 6)
  expect(await readFile(cachePath, 'utf-8')).toBe(cacheBefore)
})

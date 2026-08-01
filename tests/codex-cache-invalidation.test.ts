import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import type { ParsedProviderCall } from '../src/providers/types.js'

// The codex results cache persists each call's already-computed costUSD, keyed only on
// the session file's mtime and size. Historical session files never change, so a pricing
// correction that is not paired with a CODEX_CACHE_VERSION bump never reaches an install
// with a warm cache: the cached branch in the parser returns before calculateCost runs,
// and the user keeps seeing the same silent $0 with no sign the fix did not apply. These
// tests pin the invalidation mechanism the bump relies on.

let cacheDir: string
let sessionFile: string

async function loadModule() {
  return import('../src/codex-cache.js')
}

function call(costUSD: number): ParsedProviderCall {
  return {
    provider: 'codex',
    model: 'codex-auto-review',
    inputTokens: 753_712,
    outputTokens: 7_751,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 3_096_960,
    cachedInputTokens: 3_096_960,
    reasoningTokens: 0,
    webSearchRequests: 0,
    costUSD,
    tools: [],
    bashCommands: [],
    timestamp: '2026-04-14T10:01:00Z',
    speed: 'standard',
    deduplicationKey: 'sess-001:1',
    userMessage: '',
    sessionId: 'sess-001',
  }
}

async function writeCacheFile(version: number, entry: Record<string, unknown>): Promise<void> {
  await mkdir(cacheDir, { recursive: true })
  await writeFile(
    join(cacheDir, 'codex-results.json'),
    JSON.stringify({ version, files: { [sessionFile]: entry } }),
    'utf-8',
  )
}

beforeEach(async () => {
  vi.resetModules()
  cacheDir = await mkdtemp(join(tmpdir(), 'codeburn-codex-cache-'))
  process.env['CODEBURN_CACHE_DIR'] = cacheDir
  sessionFile = join(cacheDir, 'rollout-sess-001.jsonl')
  await writeFile(sessionFile, '{"type":"session_meta"}\n', 'utf-8')
})

afterEach(async () => {
  delete process.env['CODEBURN_CACHE_DIR']
  await rm(cacheDir, { recursive: true, force: true })
})

describe('codex results cache invalidation', () => {
  it('refuses entries written under an older cache version', async () => {
    const { CODEX_CACHE_VERSION } = await loadModule()
    const s = await stat(sessionFile)
    // A pre-fix entry: $0 for a codex-auto-review turn, and no cwd recorded.
    await writeCacheFile(CODEX_CACHE_VERSION - 1, {
      mtimeMs: s.mtimeMs,
      sizeBytes: s.size,
      project: 'myproject',
      calls: [call(0)],
    })

    vi.resetModules()
    const mod = await loadModule()
    expect(await mod.readCachedCodexResults(sessionFile)).toBeNull()
    expect(await mod.getCachedCodexProject(sessionFile)).toBeNull()
  })

  it('serves an entry written under the current cache version', async () => {
    const { CODEX_CACHE_VERSION } = await loadModule()
    const s = await stat(sessionFile)
    await writeCacheFile(CODEX_CACHE_VERSION, {
      mtimeMs: s.mtimeMs,
      sizeBytes: s.size,
      project: 'myproject',
      cwd: '/home/u/treehouse/proj',
      calls: [call(5.66)],
    })

    vi.resetModules()
    const mod = await loadModule()
    const cached = await mod.readCachedCodexResults(sessionFile)
    expect(cached).toHaveLength(1)
    expect(cached![0].costUSD).toBe(5.66)
    expect(await mod.getCachedCodexProject(sessionFile)).toEqual({
      project: 'myproject',
      cwd: '/home/u/treehouse/proj',
    })
  })

  it('stamps freshly written entries with the current version and their real cwd', async () => {
    const mod = await loadModule()
    const fp = await mod.fingerprintFile(sessionFile)
    expect(fp).not.toBeNull()
    await mod.writeCachedCodexResults(sessionFile, 'myproject', [call(5.66)], fp!, '/home/u/treehouse/proj')
    await mod.flushCodexCache()

    const raw = JSON.parse(await readFile(join(cacheDir, 'codex-results.json'), 'utf-8')) as {
      version: number
      files: Record<string, { cwd?: string }>
    }
    expect(raw.version).toBe(mod.CODEX_CACHE_VERSION)
    expect(raw.files[sessionFile].cwd).toBe('/home/u/treehouse/proj')
  })

  it('is at a version past the one that served pre-fix codex prices', async () => {
    // v1 entries carry costs computed before the codex aliases and longest-prefix
    // resolution landed. Reverting the bump would make those fixes inert on every
    // existing install without anything else failing, so pin it here.
    const { CODEX_CACHE_VERSION } = await loadModule()
    expect(CODEX_CACHE_VERSION).toBeGreaterThan(1)
  })
})

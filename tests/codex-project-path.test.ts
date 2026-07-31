import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { mkdtempSync } from 'fs'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// D4, provider half. Claude Code records `cwd` on every JSONL entry; Codex records it
// once in session_meta, and the provider puts it on SessionSource.cwd. That value has to
// survive all the way to ProjectSummary.projectPath, because `yield` tests
// isGitRepo(projectPath) -- a codex project that keeps its sanitized key resolves to no
// repo and every codex session is reported "abandoned".
//
// CODEX_HOME has to be set before src/providers/codex.js is loaded: the provider captures
// its directory once, when `export const codex = createCodexProvider()` runs. So the env
// is set at module scope here and the parser is imported dynamically afterwards.
const tmpRoot = mkdtempSync(join(tmpdir(), 'codeburn-codexpath-'))
process.env['CODEX_HOME'] = join(tmpRoot, 'codex')
process.env['CODEBURN_CACHE_DIR'] = join(tmpRoot, 'cache')

const { parseAllSessions, clearSessionCache } = await import('../src/parser.js')

const CWD = '/home/fungiman/.treehouse/proj-ab12/1/proj'

/// Codex's own encoding of the cwd into a display key: leading slash dropped, every
/// remaining '/' turned into '-'. Lossy in exactly the same way Claude Code's is.
const CODEX_PROJECT_KEY = 'home-fungiman-.treehouse-proj-ab12-1-proj'

async function writeCodexSession(cwd: string, sessionId: string): Promise<void> {
  const dir = join(tmpRoot, 'codex', 'sessions', '2026', '07', '31')
  await mkdir(dir, { recursive: true })
  const lines = [
    {
      type: 'session_meta',
      timestamp: '2026-07-31T07:10:00.000Z',
      payload: { cwd, originator: 'codex-cli', session_id: sessionId, model: 'gpt-5.5' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-07-31T07:11:00.000Z',
      payload: {
        type: 'token_count',
        info: {
          last_token_usage: { input_tokens: 9305, cached_input_tokens: 8000, output_tokens: 1200, reasoning_output_tokens: 400, total_tokens: 18905 },
          total_token_usage: { input_tokens: 9305, cached_input_tokens: 8000, output_tokens: 1200, reasoning_output_tokens: 400, total_tokens: 18905 },
        },
      },
    },
  ]
  await writeFile(join(dir, `rollout-${sessionId}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

beforeEach(() => clearSessionCache())

afterAll(async () => {
  clearSessionCache()
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('D4: codex projectPath comes from session_meta.cwd', () => {
  it('reports the recorded cwd rather than the sanitized project key', async () => {
    await writeCodexSession(CWD, 'codex-cwd-0001')

    const projects = await parseAllSessions(undefined, 'codex')
    expect(projects).toHaveLength(1)
    expect(projects[0]!.project).toBe(CODEX_PROJECT_KEY)
    expect(projects[0]!.projectPath).toBe(CWD)
  })
})

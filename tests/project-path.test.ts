import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

import { parseAllSessions, clearSessionCache } from '../src/parser.js'

// D4 -- ProjectSummary.projectPath was built by `dirName.replace(/-/g, '/')`, trying to
// invert Claude Code's project-directory encoding. That encoding turns every
// non-alphanumeric character into `-`, so `/` `.` and `-` all collapse to one byte and
// no inverse exists. A real worktree came back as a path that is not on disk, which also
// made `yield` fall through to the process cwd and report every session "abandoned".
//
// The transcript records the true cwd on every entry, so these tests assert we read it
// rather than reconstruct it.

let tmpRoot: string
let prevConfigDir: string | undefined

/// Claude Code's real encoding: every non-alphanumeric character becomes '-'.
function encodeProjectDir(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

async function writeSession(
  launchCwd: string,
  sessionId: string,
  opts: { omitCwd?: boolean; laterCwd?: string } = {},
): Promise<void> {
  const dir = join(tmpRoot, 'projects', encodeProjectDir(launchCwd))
  await mkdir(dir, { recursive: true })

  const base = { sessionId, version: '2.1.220', gitBranch: 'main' }
  const assistant = (cwd: string | undefined, id: string) => ({
    ...base,
    type: 'assistant',
    ...(cwd ? { cwd } : {}),
    timestamp: '2026-07-31T07:03:15.269Z',
    message: {
      id,
      role: 'assistant',
      model: 'claude-opus-5',
      content: [],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  })

  const lines = [
    { ...base, type: 'user', ...(opts.omitCwd ? {} : { cwd: launchCwd }), timestamp: '2026-07-31T07:03:10.000Z', message: { role: 'user', content: 'go' } },
    assistant(opts.omitCwd ? undefined : launchCwd, 'msg-1'),
    // Agents cd into subdirectories mid-session; only the first cwd is the project root.
    assistant(opts.laterCwd, 'msg-2'),
  ]

  await writeFile(join(dir, `${sessionId}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'codeburn-projectpath-'))
  prevConfigDir = process.env['CLAUDE_CONFIG_DIR']
  process.env['CLAUDE_CONFIG_DIR'] = tmpRoot
  clearSessionCache()
})

afterEach(async () => {
  if (prevConfigDir === undefined) delete process.env['CLAUDE_CONFIG_DIR']
  else process.env['CLAUDE_CONFIG_DIR'] = prevConfigDir
  clearSessionCache()
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('D4: projectPath comes from the transcript, not a decoded directory name', () => {
  it('recovers a worktree path containing dots and dashes exactly', async () => {
    // The exact shape that broke: a dotfile directory plus a dash inside a path segment.
    const cwd = '/home/fungiman/.treehouse/codeburn-6290cf/1/codeburn'
    await writeSession(cwd, 'sess-dots-and-dashes')

    const projects = await parseAllSessions(undefined, 'claude')
    expect(projects).toHaveLength(1)
    expect(projects[0]!.projectPath).toBe(cwd)
  })

  it('does not produce the old mangled path', async () => {
    const cwd = '/home/fungiman/.treehouse/psychogenesis-fd344f/2/psychogenesis'
    await writeSession(cwd, 'sess-mangle-check')

    const projects = await parseAllSessions(undefined, 'claude')
    expect(projects[0]!.projectPath).not.toBe('/home/fungiman//treehouse/psychogenesis/fd344f/2/psychogenesis')
    expect(projects[0]!.projectPath).toBe(cwd)
  })

  it('exposes the launch cwd on the session summary', async () => {
    const cwd = '/home/fungiman/work/my-repo'
    await writeSession(cwd, 'sess-launch-cwd')

    const projects = await parseAllSessions(undefined, 'claude')
    expect(projects[0]!.sessions[0]!.launchCwd).toBe(cwd)
  })

  it('uses the first cwd, not one the agent cd-ed into later', async () => {
    const cwd = '/home/fungiman/work/monorepo'
    await writeSession(cwd, 'sess-cd', { laterCwd: '/home/fungiman/work/monorepo/packages/web' })

    const projects = await parseAllSessions(undefined, 'claude')
    expect(projects[0]!.projectPath).toBe(cwd)
  })

  it('keeps the project key untouched as the stable identifier', async () => {
    const cwd = '/home/fungiman/.treehouse/codeburn-6290cf/1/codeburn'
    await writeSession(cwd, 'sess-key')

    const projects = await parseAllSessions(undefined, 'claude')
    expect(projects[0]!.project).toBe('-home-fungiman--treehouse-codeburn-6290cf-1-codeburn')
  })

  it('falls back to the project key rather than inventing a path when no cwd is recorded', async () => {
    const cwd = '/home/fungiman/no-cwd-recorded'
    await writeSession(cwd, 'sess-no-cwd', { omitCwd: true })

    const projects = await parseAllSessions(undefined, 'claude')
    // Never a fabricated path: either the truth, or the raw key we actually have.
    expect(projects[0]!.projectPath).toBe(encodeProjectDir(cwd))
    expect(projects[0]!.projectPath).not.toContain('//')
  })
})

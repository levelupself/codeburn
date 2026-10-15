import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const snapshot = new URL('../src/data/litellm-snapshot.json', import.meta.url)
const guard = fileURLToPath(new URL('./fixtures/deny-network.cjs', import.meta.url))

it('builds and loads CLI help offline without rewriting the committed price snapshot', () => {
  const before = readFileSync(snapshot)
  const env = { ...process.env, NODE_OPTIONS: `--require="${guard}"` }
  const build = spawnSync('npm', ['run', 'build'], {
    cwd: root, env, encoding: 'utf8', timeout: 60_000,
  })
  expect(build.error).toBeUndefined()
  expect(build.status, build.stdout + build.stderr).toBe(0)
  expect(readFileSync(snapshot)).toEqual(before)

  const help = spawnSync(process.execPath, ['dist/cli.js', '--help'], {
    cwd: root, env, encoding: 'utf8', timeout: 10_000,
  })
  expect(help.error).toBeUndefined()
  expect(help.status, help.stdout + help.stderr).toBe(0)
  expect(help.stdout).toContain('Usage:')
  expect(help.stdout).toContain('report')
}, 75_000)

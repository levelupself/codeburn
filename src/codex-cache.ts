import { readFile, mkdir, stat, open, rename, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { homedir } from 'os'

import type { ParsedProviderCall } from './providers/types.js'

// Bump whenever a cached entry's meaning changes. Entries persist the cost that
// `calculateCost` produced at parse time, so a pricing correction that is not paired with
// a bump never reaches an install with a warm cache: session files keep their mtime
// forever, so the stale entry is served verbatim and the fix reads as inert. v2 discards
// everything priced before the codex alias and longest-prefix fixes, which also re-derives
// the `cwd` those entries never carried.
export const CODEX_CACHE_VERSION = 2
const CACHE_FILE = 'codex-results.json'

type FileFingerprint = { mtimeMs: number; sizeBytes: number }

type FileEntry = {
  mtimeMs: number
  sizeBytes: number
  project: string
  /// Real cwd from the session's session_meta. Optional because a session file need not
  /// record one; consumers fall back to the project key rather than inventing a path.
  cwd?: string
  calls: ParsedProviderCall[]
}

type ResultCache = {
  version: number
  files: Record<string, FileEntry>
}

function getCacheDir(): string {
  return process.env['CODEBURN_CACHE_DIR'] ?? join(homedir(), '.cache', 'codeburn')
}

function getCachePath(): string {
  return join(getCacheDir(), CACHE_FILE)
}

let memCache: ResultCache | null = null

async function loadCache(): Promise<ResultCache> {
  if (memCache) return memCache
  try {
    const raw = await readFile(getCachePath(), 'utf-8')
    const cache = JSON.parse(raw) as ResultCache
    if (cache.version === CODEX_CACHE_VERSION && cache.files && typeof cache.files === 'object') {
      memCache = cache
      return cache
    }
  } catch {}
  memCache = { version: CODEX_CACHE_VERSION, files: {} }
  return memCache
}

function getEntry(cache: ResultCache, filePath: string, fp: FileFingerprint): FileEntry | null {
  if (!Object.hasOwn(cache.files, filePath)) return null
  const entry = cache.files[filePath]
  if (entry && entry.mtimeMs === fp.mtimeMs && entry.sizeBytes === fp.sizeBytes) {
    return entry
  }
  return null
}

export async function readCachedCodexResults(
  filePath: string,
): Promise<ParsedProviderCall[] | null> {
  try {
    const s = await stat(filePath)
    const cache = await loadCache()
    const entry = getEntry(cache, filePath, { mtimeMs: s.mtimeMs, sizeBytes: s.size })
    return entry?.calls ?? null
  } catch {}
  return null
}

export async function getCachedCodexProject(
  filePath: string,
): Promise<{ project: string; cwd?: string } | null> {
  try {
    const s = await stat(filePath)
    const cache = await loadCache()
    const entry = getEntry(cache, filePath, { mtimeMs: s.mtimeMs, sizeBytes: s.size })
    if (!entry) return null
    return { project: entry.project, ...(entry.cwd ? { cwd: entry.cwd } : {}) }
  } catch {}
  return null
}

export async function fingerprintFile(
  filePath: string,
): Promise<FileFingerprint | null> {
  try {
    const s = await stat(filePath)
    return { mtimeMs: s.mtimeMs, sizeBytes: s.size }
  } catch {
    return null
  }
}

export async function writeCachedCodexResults(
  filePath: string,
  project: string,
  calls: ParsedProviderCall[],
  fingerprint: FileFingerprint,
  cwd?: string,
): Promise<void> {
  try {
    const cache = await loadCache()
    cache.files[filePath] = {
      mtimeMs: fingerprint.mtimeMs,
      sizeBytes: fingerprint.sizeBytes,
      project,
      ...(cwd ? { cwd } : {}),
      calls,
    }
  } catch {}
}

export async function flushCodexCache(): Promise<void> {
  if (!memCache) return
  try {
    // Evict entries for files that no longer exist on disk
    const paths = Object.keys(memCache.files)
    for (const p of paths) {
      try {
        await stat(p)
      } catch {
        delete memCache.files[p]
      }
    }

    const dir = getCacheDir()
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    const finalPath = getCachePath()
    const tempPath = `${finalPath}.${randomBytes(8).toString('hex')}.tmp`
    const payload = JSON.stringify(memCache)
    const handle = await open(tempPath, 'w', 0o600)
    try {
      await handle.writeFile(payload, { encoding: 'utf-8' })
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await rename(tempPath, finalPath)
    } catch (err) {
      try { await unlink(tempPath) } catch {}
      throw err
    }
  } catch {}
}

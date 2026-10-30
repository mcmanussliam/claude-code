import type { EngineInterface } from 'claude-code'
import type { RulesSource } from '../../temporary-rule-poc/types'
import type { RuleDirectory } from './sources'
import { below, normalize } from './paths'

export type RuleFile = RulesSource & { realPath: string; text: string }

/** Scan directories in source order, deduplicating canonical targets across them. */
export async function scan($: EngineInterface, directories: readonly RuleDirectory[]): Promise<RuleFile[]> {
  const files: RuleFile[] = []
  const seen = new Set<string>()
  for (const { source, allowedRoot } of directories) {
    files.push(...await walk($, source, allowedRoot, seen))
  }

  return files
}

/** Recursively discover markdown, following in-root symlinks once per real directory. */
async function walk($: EngineInterface, source: RulesSource, allowedRoot: string, seen: Set<string>): Promise<RuleFile[]> {
  const stat = await $.fs.stat(source.path, { resolve: true }).catch(() => undefined)
  if (stat === undefined) {
    return []
  }

  const real = normalize(stat.realPath ?? source.path)
  // External links need native project consent, which this API cannot grant.
  // Native-approved files already in instructionFiles are left untouched.
  if (!below(real, allowedRoot) || /^(?:\/\/|\/net\/|\/Network\/)/.test(real) || seen.has(real)) {
    return []
  }

  seen.add(real)
  if (stat.kind === 'file') {
    if (!source.path.endsWith('.md')) {
      return []
    }

    const text = await $.fs.read(source.path).catch(() => undefined)
    return text === undefined ? [] : [{ ...source, realPath: real, text }]
  }

  if (stat.kind !== 'dir') {
    return []
  }

  const entries = await $.fs.list(source.path).catch(() => [])
  const found: RuleFile[] = []
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    found.push(...await walk($, { ...source, path: `${source.path}/${entry.name}` }, allowedRoot, seen))
  }

  return found
}

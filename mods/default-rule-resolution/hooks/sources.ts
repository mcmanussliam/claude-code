import type { EngineInterface } from 'claude-code'
import type { RulesSource, RulesStatus } from '../../temporary-rule-poc/types'
import { ancestry, below, normalize, parent } from './paths'

export type DiscoveryOptions = { user: boolean; project: boolean }
export type RuleDirectory = { source: RulesSource; allowedRoot: string }

/** Select personal rules and project ancestors, retaining discovered nested bases. */
export async function selectSources(
  $: EngineInterface,
  options: DiscoveryOptions,
  previous: readonly RulesStatus[],
  file?: string,
): Promise<RuleDirectory[]> {
  const [root, cwd, home, profile, config] = await Promise.all([
    $.session.root(), $.session.cwd(), $.env.get('HOME'), $.env.get('USERPROFILE'),
    $.env.get('CLAUDE_CONFIG_DIR'),
  ])
  const base = normalize(root)
  const working = normalize(cwd)
  const userHome = working.includes(':') ? profile ?? home : home ?? profile
  const userDir = config ?? (userHome === undefined ? undefined : `${userHome}/.claude`)
  const sources: RuleDirectory[] = []
  if (options.user && userDir !== undefined) {
    sources.push({
      source: { path: `${normalize(userDir)}/rules`, root: base, kind: 'user' },
      allowedRoot: normalize(config ?? userHome ?? userDir),
    })
  }

  if (options.project) {
    const dirs = new Set(ancestry(working))
    for (const rule of previous) {
      if (rule.source?.kind === 'project' && below(rule.source.root, base)) {
        dirs.add(rule.source.root)
      }
    }

    if (file !== undefined) {
      const target = normalize(/^(?:[A-Za-z]:)?[\\/]/.test(file) ? file : `${working}/${file}`)
      if (below(target, base)) {
        for (const dir of ancestry(parent(target))) {
          dirs.add(dir)
        }
      }
    }

    for (const dir of [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))) {
      sources.push({ source: { path: normalize(`${dir}/.claude/rules`), root: dir, kind: 'project' }, allowedRoot: dir })
    }
  }

  return sources
}

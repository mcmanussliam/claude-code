import type { EngineInterface } from 'claude-code'
import { withoutComments } from './content'
import { scan } from './files'
import { selectSources, type DiscoveryOptions } from './sources'

/** Reconcile discovered rule files through the provider's caller-scoped noun. */
export async function discover($: EngineInterface, options: DiscoveryOptions, file?: string): Promise<void> {
  const simple = await $.env.get('CLAUDE_CODE_SIMPLE')
  if (simple !== undefined && ['1', 'true', 'yes', 'on'].includes(simple.toLowerCase())) {
    return
  }

  const [settings, previous] = await Promise.all([$.settings.read(), $.rules.list()])
  const rawExcludes = settings.claudeMdExcludes
  const excludes = Array.isArray(rawExcludes) ? rawExcludes.filter((item): item is string => typeof item === 'string') : []
  const directories = await selectSources($, options, previous, file)
  const files = await scan($, directories)

  const active = new Set<string>()
  for (const found of files) {
    if (excludes.length > 0 && (await $.rules.matches({ paths: excludes, path: found.path }) ||
      await $.rules.matches({ paths: excludes, path: found.realPath }))) {
      continue
    }

    const parsed = await $.rules.parse({ text: found.text })
    const content = withoutComments(parsed.content)
    if (content.trim() === '') {
      continue
    }

    const name = `file:${found.path}`
    active.add(name)
    await $.rules.add({ name, ...parsed, content, source: { path: found.path, root: found.root, kind: found.kind } })
  }

  for (const rule of previous) {
    if (rule.source !== undefined && !active.has(rule.name)) {
      await $.rules.remove({ name: rule.name })
    }
  }
}

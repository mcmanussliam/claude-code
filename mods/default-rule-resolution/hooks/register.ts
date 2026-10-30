import type { EngineInterface, On, PluginOptions } from 'claude-code'
import { discover } from './discover'
import type { DiscoveryOptions } from './sources'

async function resolve($: EngineInterface, sources: DiscoveryOptions, file?: string): Promise<void> {
  try {
    await discover($, sources, file)
  } catch {
    /* Missing/withheld rule capabilities must not block a prompt or tool. */
  }
}

/** Discover native-style rule directories and register them with the rules service. */
export function register(on: On, options: PluginOptions = {}): void {
  const sources = { user: options.sources !== 'project-only', project: options.sources !== 'user-only' }
  on('session.start', {}, async ($, e, next) => {
    await resolve($, sources)
    return next(e)
  })

  on('prompt.context', {}, async ($, e, next) => {
    if (e.instructionFiles !== undefined) {
      await resolve($, sources)
    }

    return next(e)
  })

  on('tool.call', {}, async ($, e, next) => {
    if ((e.tool === 'Read' || e.tool === 'Edit' || e.tool === 'Write') && typeof e.file_path === 'string') {
      await resolve($, sources, e.file_path)
    }

    return next(e)
  })

  on('prompt.mention', {}, async ($, e, next) => {
    await resolve($, sources, e.path)
    return next(e)
  })
}

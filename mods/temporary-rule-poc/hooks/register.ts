import type { EngineInterface, On } from 'claude-code'
import { createRules, type RulesService } from './service'

async function attachmentsEnabled($: EngineInterface): Promise<boolean> {
  const values = await Promise.all([$.env.get('CLAUDE_CODE_SIMPLE'), $.env.get('CLAUDE_CODE_DISABLE_ATTACHMENTS')])
  return !values.some(value => value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase()))
}

export function register(on: On): void {
  let service: RulesService | undefined
  on('engine.create', async (_$, e, next) => {
    const beneath = await next(e)
    if (Object.keys(beneath).includes('rules')) {
      return beneath
    }

    service = createRules({
      id: () => beneath.session.id(), root: () => beneath.session.root(), cwd: () => beneath.session.cwd(),
      get: key => beneath.store.get(key), set: (key, value) => beneath.store.set(key, value),
      delete: key => beneath.store.delete(key), invalidate: () => beneath.ui.invalidate('prompt.context'),
    })
    const rules: EngineInterface['rules'] = service.forOwner('temporary-rule-poc')
    return { ...beneath, rules }
  })

  on('rules.add', (_$, e, next) => service === undefined ? next(e) : service.forOwner(next.origin.plugin).add(e).then(value => ({ value })))
  on('rules.remove', (_$, e, next) => service === undefined ? next(e) : service.forOwner(next.origin.plugin).remove(e).then(value => ({ value })))
  on('rules.clear', (_$, e, next) => service === undefined ? next(e) : service.forOwner(next.origin.plugin).clear().then(value => ({ value })))
  on('rules.list', (_$, e, next) => service === undefined ? next(e) : service.forOwner(next.origin.plugin).list().then(value => ({ value })))
  on('rules.parse', (_$, e, next) => service === undefined ? next(e) : service.forOwner(next.origin.plugin).parse(e).then(value => ({ value })))
  on('rules.matches', (_$, e, next) => service === undefined ? next(e) : service.forOwner(next.origin.plugin).matches(e).then(value => ({ value })))

  on('prompt.context', {}, async (_$, e, next) => {
    if (service === undefined || e.instructionFiles === undefined) {
      return next(e)
    }

    const result = await next(e)
    const changed = result.blocks.find(block => block.name === 'claudeMd')?.text !== e.blocks.find(block => block.name === 'claudeMd')?.text
    if (result.instructionFiles === undefined && changed) {
      return result
    }

    try {
      return { ...result, instructionFiles: await service.context(result.instructionFiles ?? e.instructionFiles) }
    } catch {
      return result
    }
  })

  on('prompt.submit', {}, async ($, e, next) => {
    let fresh: string[] = []
    try {
      if (service !== undefined && await attachmentsEnabled($)) {
        fresh = await service.fallback()
      }
    } catch {
      /* Pass the prompt on. */
    }

    return next(fresh.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...fresh] })
  })

  on('tool.call', {}, async ($, e, next) => {
    const result = await next(e)
    if (service === undefined || result.deny !== undefined || result.isError) {
      return result
    }

    try {
      if (!await attachmentsEnabled($)) {
        return result
      }

      const scoped = (e.tool === 'Read' || e.tool === 'Edit' || e.tool === 'Write') && typeof e.file_path === 'string'
        ? await service.attach(e.file_path, e.agentId, result.context, e.tool === 'Read' && e.offset === undefined && e.limit === undefined) : []
      const fresh = [...await service.fallback(e.agentId), ...scoped]
      return fresh.length === 0 ? result : { ...result, context: [...(result.context ?? []), ...fresh] }
    } catch {
      return result
    }
    // Never call next twice after a tool has executed.
  })

  on('prompt.mention', {}, async ($, e, next) => {
    const result = await next(e)
    if (service === undefined || result.deny !== undefined || result.type === null) {
      return result
    }

    try {
      if (!await attachmentsEnabled($)) {
        return result
      }

      const fresh = await service.attach(e.path, e.agentId, result.context, true)
      return fresh.length === 0 ? result : { ...result, context: [...(result.context ?? []), ...fresh] }
    } catch {
      return result
    }
  })

  on('session.compact', {}, async (_$, e, next) => {
    const result = await next(e)
    try {
      if (!result.skip) {
        await service?.compact(e.agentId)
      }
    } catch {
      /* Keep the host result. */
    }

    return result
  })

  on('prompt.attachment', {}, async (_$, e, next) => {
    const result = await next(e)
    if (service === undefined || result.text === null) {
      return result
    }

    try {
      const text = await service.attachment(result.text, e.agentId)
      return text === result.text ? result : { ...result, text }
    } catch {
      return result
    }
  })

  on('agent.spawn', { fork: true }, async (_$, e, next) => {
    const result = await next(e)
    try {
      if (e.resume === undefined && result.agentId !== undefined) {
        await service?.fork(e.parentAgentId, result.agentId)
      }
    } catch {
      /* Do not spawn twice. */
    }

    return result
  })

  on('session.end', { reason: 'clear' }, async (_$, e, next) => {
    const result = await next(e)
    try {
      await service?.end(e.sessionId)
    } catch {
      /* Keep the host result. */
    }

    return result
  })
}

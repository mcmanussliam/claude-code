import type { Rules } from '../../../temporary-rule-poc/types'
import type { Plugin } from 'claude-code/testing'

/** Recording contract fixture: default discovery is tested separately from delivery. */
export const PROVIDER: Plugin = {
  name: 'temporary-rule-poc',
  tier: 'builtin',
  register(on) {
    on('engine.create', async (_$, e, next) => {
      const beneath = await next(e)
      const entries: Awaited<ReturnType<Rules['list']>> = []
      const rules: Rules = {
        async add(rule) {
          const at = entries.findIndex(item => item.name === rule.name)
          const result = { ...rule, sent: false }
          if (at === -1) {
            entries.push(result)
          } else {
            entries[at] = result
          }

          return result
        },

        async remove({ name }) {
          const at = entries.findIndex(item => item.name === name);
          if (at !== -1) {
            entries.splice(at, 1)
          }
        },

        async clear() {
          entries.splice(0)
        },

        async list() {
          return entries
        },

        async parse({ text }) {
          return { content: text }
        },

        async matches() {
          return false
        },
      }

      return { ...beneath, rules }
    })
  },
}

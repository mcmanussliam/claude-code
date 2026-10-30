import type { On } from 'claude-code'

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    for (const name of ['rule-add', 'rule-remove', 'rule-list', 'rule-clear']) {
      await $.command.register({ name, description: 'Manage this conversation\'s temporary demo rules' })
    }

    return next(e)
  })

  on('command.run', { command: ['rule-add', 'rule-remove', 'rule-list', 'rule-clear'] }, async ($, e) => {
    try {
      if (e.command === 'rule-add') {
        return { text: JSON.stringify(await $.rules.add(JSON.parse(e.args)), null, 2) }
      }

      if (e.command === 'rule-remove') {
        await $.rules.remove({ name: e.args.trim() })
        return { text: 'Rule removed.' }
      }

      if (e.command === 'rule-clear') {
        await $.rules.clear()
        return { text: 'Demo rules cleared.' }
      }

      return { text: JSON.stringify(await $.rules.list(), null, 2) }
    } catch (error) {
      return { text: `Could not change temporary rules: ${String(error)}` }
    }
  })
}

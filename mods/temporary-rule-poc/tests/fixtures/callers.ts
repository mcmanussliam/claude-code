import type { Plugin } from 'claude-code/testing'

/** Calls through real plugin dispatch, so next.origin identifies the caller. */
function caller(name: string): Plugin {
  return {
    name,
    tier: 'user',
    register(on) {
      on('command.run', { command: `${name}-rules` }, async ($, e) => {
        const request = JSON.parse(e.args)
        if (request.op === 'add') {
          return { text: JSON.stringify(await $.rules.add(request.rule)) }
        }

        if (request.op === 'remove') {
          await $.rules.remove({ name: request.name });
          return { text: 'removed' }
        }

        if (request.op === 'clear') {
          await $.rules.clear();
          return { text: 'cleared' }
        }

        return { text: JSON.stringify(await $.rules.list()) }
      })
    },
  }
}

export const ALPHA = caller('alpha')
export const BETA = caller('beta')

export function command(owner: string, request: unknown) {
  return {
    command: `${owner}-rules`, args: JSON.stringify(request), origin: { kind: 'composer' as const },
    presentation: { isFullscreen: false, columns: 80 }
  }
}

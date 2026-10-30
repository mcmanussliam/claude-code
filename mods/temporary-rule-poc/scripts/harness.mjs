/**
 * A deterministic event-chain harness, NOT Claude Code's host or a native
 * discovery oracle. It exercises the real modules and store-backed lifecycle.
 */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(new URL('../.checks/', import.meta.url), { recursive: true })
for (const [entry, outfile] of [
  ['hooks/register.ts', '.checks/temporary.mjs'],
]) {
  await build({ absWorkingDir: root, entryPoints: [entry], outfile, bundle: true, platform: 'neutral', format: 'esm', target: 'es2023' })
}

let sequence = 0
function matches(matcher, input) {
  return Object.entries(matcher).every(([key, expected]) => {
    const value = input[key]
    if (Array.isArray(expected)) {
      return expected.includes(value)
    }

    if (expected !== null && typeof expected === 'object') {
      return value !== undefined && matches(expected, value)
    }

    return value === expected
  })
}

export async function harness({ store = new Map(), env = {}, files = {}, links = {}, settings = {}, sources } = {}) {
  const temporary = await import(new URL(`../.checks/temporary.mjs?instance=${sequence++}`, import.meta.url))
  const hooks = new Map()
  let registering = 'temporary-rule-poc'
  function on(event, matcher, handler) {
    if (typeof matcher === 'function') {
      handler = matcher;
      matcher = {}
    }

    const hook = { matcher, handler, owner: registering }
    const list = hooks.get(event) ?? []
    list.push(hook)
    hooks.set(event, list)
    return {
      catch(handler) {
        hook.catcher = handler;
        return this
      }
    }
  }

  const loadTemporary = () => {
    registering = 'temporary-rule-poc';
    temporary.register(on)
  }

  loadTemporary()
  const state = { sessionId: 's1', root: '/repo', cwd: '/repo', env, toolResult: { result: {}, text: 'ok' }, invalidated: [], files, links, settings, failStore: false, toolCalls: 0 }
  const real = path => {
    for (const [link, target] of Object.entries(state.links)) {
      if (path === link || path.startsWith(`${link}/`)) {
        return target + path.slice(link.length)
      }
    }

    return path
  }

  const known = () => [...Object.keys(state.files), ...Object.keys(state.links)]
  const kind = path => path in state.files ? 'file' : known().some(file => file.startsWith(`${path}/`)) ? 'dir' : undefined
  const core = {
    session: { id: async () => state.sessionId, root: async () => state.root, cwd: async () => state.cwd },
    store: {
      get: async key => structuredClone(store.get(key)),
      set: async (key, value) => {
        if (state.failStore) {
          throw new Error('Store unavailable');
        }

        store.set(key, structuredClone(value))
      },

      delete: async key => {
        store.delete(key)
      },

      keys: async () => [...store.keys()],
    },

    env: { get: async name => env[name] },
    plugin: { name: 'temporary-rule-poc', root: '/plugin' },
    ui: {
      invalidate: event => {
        state.invalidated.push(event)
      }
    },

    settings: { read: async () => structuredClone(state.settings) },
    fs: {
      stat: async path => {
        const actual = real(path)
        const type = kind(actual)
        if (type === undefined) {
          throw new Error(`ENOENT: ${path}`)
        }

        return { kind: type, realPath: actual, size: state.files[actual]?.length ?? 0, mtimeMs: 0, isLink: actual !== path }
      },

      list: async path => {
        const actual = real(path)
        const names = [...new Set(known().filter(file => file.startsWith(`${actual}/`)).map(file => file.slice(actual.length + 1).split('/')[0]))]
        return names.map(name => ({ name, kind: kind(`${actual}/${name}`) ?? 'other', isLink: `${actual}/${name}` in state.links, size: 0, mtimeMs: 0 }))
      },

      read: async path => {
        const text = state.files[real(path)]
        if (text === undefined) {
          throw new Error(`ENOENT: ${path}`)
        }

        return text
      },
    },
  }

  let engine = core
  async function terminal(event, e) {
    if (event === 'engine.create') {
      return core
    }

    if (event === 'prompt.context') {
      return { blocks: e.blocks, ...(e.instructionFiles === undefined ? {} : { instructionFiles: e.instructionFiles }) }
    }

    if (event === 'prompt.submit') {
      return { text: e.text, ...(e.context === undefined ? {} : { context: e.context }) }
    }

    if (event === 'prompt.mention') {
      return { type: 'file' }
    }

    if (event === 'prompt.attachment') {
      return { text: e.text }
    }

    if (event === 'tool.call') {
      state.toolCalls++;
      return structuredClone(state.toolResult)
    }

    if (event === 'session.start') {
      return { cwd: state.cwd }
    }

    if (event === 'session.end') {
      return { sessionId: e.sessionId }
    }

    if (event === 'session.compact') {
      return { messages: [{ role: 'user', text: 'Summary', toolUses: [] }] }
    }

    if (event === 'agent.spawn') {
      return { model: 'test-model', agentId: e.resume?.agentId ?? 'child' }
    }

    if (event === 'turn.complete') {
      return { text: e.answer }
    }

    if (event.startsWith('rules.')) {
      return { value: await engine.rules[event.slice(6)](e) }
    }

    throw new Error(`Missing harness event ${event}`)
  }

  async function dispatch(event, input = {}, origin = { plugin: 'engine', tier: 'core' }) {
    const chain = (hooks.get(event) ?? []).filter(hook => matches(hook.matcher, input))
    async function run(index, e) {
      const hook = chain[index]
      if (hook === undefined) {
        return terminal(event, e)
      }

      const next = changed => run(index + 1, changed)
      next.origin = origin
      next.is = name => name === event
      const bound = { ...engine, rules: api(hook.owner) }
      try {
        return await hook.handler(bound, structuredClone(e), next)
      } catch (error) {
        if (hook.catcher === undefined) {
          throw error
        }

        return hook.catcher(bound, structuredClone(e), next, error)
      }
    }

    return run(0, input)
  }

  const api = owner => Object.fromEntries(['add', 'remove', 'clear', 'list', 'parse', 'matches'].map(method => [method,
    async input => {
      const answer = await dispatch(`rules.${method}`, input ?? {}, { plugin: owner, tier: 'user' })
      if (answer.deny !== undefined) {
        throw new Error(answer.deny)
      }

      return answer.value
    },
  ]))

  engine = await dispatch('engine.create', { plugins: ['temporary-rule-poc'] })
  return { api, dispatch, state, store, engine }
}

export const context = (files = []) => ({ blocks: [{ name: 'claudeMd', text: 'native' }], instructionFiles: files })
export const access = (tool = 'Read', file_path = '/repo/src/app.ts', agentId) => ({ tool, file_path, ...(agentId === undefined ? {} : { agentId }) })

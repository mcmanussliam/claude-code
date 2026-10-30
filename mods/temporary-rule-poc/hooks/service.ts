import type { InstructionFile } from 'claude-code'
import type { Rules, RulesRule, RulesStatus } from '../types'
import { isMatch, parseRule, pathsOf } from './rule'
import { normalized } from './path'

export type RulesHost = {
  id: () => Promise<string>
  root: () => Promise<string>
  cwd: () => Promise<string>
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  invalidate: () => void
}
type Stored = { id: string; owner: string; rule: RulesRule; path: string; root: string; kind: 'user' | 'project' }
type State = { entries: Stored[]; sent: Record<string, string[]>; carried: string[]; rendered: Record<string, string[]> }
const empty = (): State => ({ entries: [], sent: {}, carried: [], rendered: {} })
const loop = (agent?: string): string => agent ?? 'main'
const key = (session: string): string => `rules:v2:${session}`
const identity = (owner: string, name: string): string => `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
const frame = (entry: Stored, instruction = false): string =>
  `Contents of ${entry.path}${instruction && entry.kind === 'user' ? " (user's private global instructions for all projects)" : ''}:\n\n${entry.rule.content}`

function checked(input: RulesRule): RulesRule {
  if (typeof input.name !== 'string' || input.name.trim() === '' || typeof input.content !== 'string') {
    throw new Error('A rule needs a non-empty name and string content')
  }

  if (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.some(path => typeof path !== 'string'))) {
    throw new Error('Rule paths must be a list of strings')
  }

  const source = input.source
  if (source !== undefined && (typeof source.path !== 'string' || typeof source.root !== 'string' ||
    (source.kind !== 'user' && source.kind !== 'project'))) {
    throw new Error('Invalid rule source')
  }

  return {
    name: input.name, content: input.content, ...pathsOf(input.paths),
    ...(source === undefined ? {} : { source: { ...source, path: normalized(source.path), root: normalized(source.root) } })
  }
}

/** Standalone implementation of the rules noun and its delivery ledger. */
export function createRules(host: RulesHost) {
  let queue: Promise<unknown> = Promise.resolve()
  async function read(session: string): Promise<State> {
    return { ...empty(), ...(await host.get(key(session)) as Partial<State> | undefined) }
  }

  async function transaction<T>(work: (state: State) => T | Promise<T>): Promise<T> {
    const id = await host.id()
    const run = queue.then(async () => {
      const state = await read(id)
      const result = await work(state)
      await host.set(key(id), state)
      return result
    })

    queue = run.catch(() => undefined)
    return run
  }

  function invalidate(): void {
    try {
      host.invalidate()
    } catch {
      /* Host policy may withhold this. */
    }
  }

  const status = (state: State, entry: Stored): RulesStatus => ({
    ...entry.rule,
    sent: state.carried.includes(entry.id) || (state.sent.main ?? []).includes(entry.id)
  })
  function forget(state: State, entries: Stored[]): void {
    const ids = new Set(entries.map(entry => entry.id))
    const texts = new Set(entries.flatMap(entry => [frame(entry), frame(entry, true)]))
    state.carried = state.carried.filter(id => !ids.has(id))
    for (const name of Object.keys(state.sent)) {
      state.sent[name] = state.sent[name]!.filter(id => !ids.has(id))
    }

    for (const name of Object.keys(state.rendered)) {
      state.rendered[name] = state.rendered[name]!.filter(text => !texts.has(text))
    }
  }

  function forOwner(owner: string): Rules {
    return {
      async add(input) {
        const rule = checked(input)
        const root = normalized(rule.source?.root ?? await host.root()).replace(/\/$/, '') || '/'
        const id = identity(owner, rule.name)
        let changed = false
        const value = await transaction(state => {
          const prior = state.entries.find(entry => entry.id === id)
          if (prior !== undefined && JSON.stringify(prior.rule) === JSON.stringify(rule)) {
            return status(state, prior)
          }

          changed = true
          if (prior !== undefined) {
            forget(state, [prior])
          }

          const entry: Stored = { id, owner, rule, root, path: rule.source?.path ?? `rules:${id}`, kind: rule.source?.kind ?? 'user' }
          const index = state.entries.findIndex(item => item.id === id)
          if (index === -1) {
            state.entries.push(entry)
          } else {
            state.entries[index] = entry
          }

          state.carried = state.carried.filter(item => item !== id)
          for (const name of Object.keys(state.sent)) {
            state.sent[name] = state.sent[name]!.filter(item => item !== id)
          }

          return status(state, entry)
        })

        if (changed) {
          invalidate()
        }

        return value
      },

      async remove(request) {
        if (typeof request.name !== 'string') {
          throw new Error('Rule name must be a string')
        }

        await transaction(state => {
          const id = identity(owner, request.name)
          forget(state, state.entries.filter(entry => entry.id === id))
          state.entries = state.entries.filter(entry => entry.id !== id)
        })

        invalidate()
      },

      async clear() {
        await transaction(state => {
          forget(state, state.entries.filter(entry => entry.owner === owner))
          state.entries = state.entries.filter(entry => entry.owner !== owner)
        })

        invalidate()
      },

      async list() {
        await queue
        const state = await read(await host.id())
        return state.entries.filter(entry => entry.owner === owner).map(entry => status(state, entry))
      },

      async parse(request) {
        return parseRule(request.text)
      },

      async matches(request) {
        return isMatch({ paths: [...request.paths] }, request.path)
      },
    }
  }

  async function context(files: readonly InstructionFile[]): Promise<InstructionFile[]> {
    return transaction(state => {
      const present = new Set(files.map(file => normalized(file.path)))
      const told = new Set(state.sent.main ?? [])
      const always = state.entries.filter(entry => entry.rule.paths === undefined)
      const added = always.filter(entry => !present.has(normalized(entry.path)) && !told.has(entry.id))
      state.carried = always.filter(entry => !told.has(entry.id)).map(entry => entry.id)
      let answer = [...files]
      for (const entry of added) {
        const file: InstructionFile = { path: entry.path, kind: entry.kind, content: entry.rule.content }
        let at = entry.kind === 'user'
          ? answer.findIndex(item => item.kind !== 'managed' && item.kind !== 'user')
          : answer.findIndex(item => item.kind === 'local' || item.kind === 'memory')
        if (entry.kind === 'project') {
          const own = answer.findLastIndex(item => item.kind === 'project' &&
            (normalized(item.path).startsWith(`${entry.root}/.claude/`) || normalized(item.path) === `${entry.root}/CLAUDE.md`))
          if (own !== -1) {
            at = own + 1
          }
        }

        if (at === -1) {
          at = answer.length
        }

        answer = [...answer.slice(0, at), file, ...answer.slice(at)]
      }

      return answer
    })
  }

  async function fallback(agent?: string): Promise<string[]> {
    return transaction(state => {
      const name = loop(agent)
      const sent = new Set([...(state.sent[name] ?? []), ...state.carried])
      const fresh = state.entries.filter(entry => entry.rule.paths === undefined && !sent.has(entry.id))
      state.sent[name] = [...new Set([...(state.sent[name] ?? []), ...fresh.map(entry => entry.id)])]
      return fresh.map(entry => frame(entry, true))
    })
  }

  async function attach(path: string, agent?: string, existing: readonly string[] = [], wholeRead = false): Promise<string[]> {
    const absolute = normalized(/^(?:[A-Za-z]:)?[\\/]/.test(path) ? path : `${await host.cwd()}/${path}`)
    return transaction(state => {
      const name = loop(agent)
      const sent = new Set(state.sent[name] ?? [])
      if (wholeRead) {
        for (const entry of state.entries) {
          if (entry.path === absolute) {
            sent.add(entry.id)
          }
        }
      }

      const fresh = state.entries.filter(entry => {
        if (entry.rule.paths === undefined || sent.has(entry.id) || absolute === entry.path) {
          return false
        }

        const prefix = entry.root === '/' ? '/' : `${entry.root}/`
        return absolute.startsWith(prefix) && isMatch(entry.rule, absolute.slice(prefix.length))
      })

      for (const entry of fresh) {
        sent.add(entry.id)
      }

      state.sent[name] = [...sent]
      return fresh.filter(entry => !existing.some(text => text.includes(`Contents of ${entry.path}:`))).map(entry => frame(entry))
    })
  }

  async function compact(agent?: string): Promise<void> {
    await transaction(state => {
      delete state.sent[loop(agent)];
      delete state.rendered[loop(agent)];
      if (agent === undefined) {
        state.carried = []
      }
    })
  }

  async function fork(parent: string | undefined, child: string): Promise<void> {
    await transaction(state => {
      state.sent[child] = [...(state.sent[loop(parent)] ?? [])]
      state.rendered[child] = [...(state.rendered[loop(parent)] ?? [])]
    })
  }

  /** Deduplicate exact file-backed rule frames when the native loader also emits them. */
  async function attachment(text: string, agent?: string): Promise<string | null> {
    return transaction(state => {
      const entries = state.entries.filter(entry => entry.rule.source !== undefined && frame(entry) === text)
      if (entries.length === 0) {
        return text
      }

      const name = loop(agent)
      const rendered = state.rendered[name] ?? []
      state.sent[name] = [...new Set([...(state.sent[name] ?? []), ...entries.map(entry => entry.id)])]
      if (rendered.includes(text)) {
        return null
      }

      state.rendered[name] = [...rendered, text]
      return text
    })
  }

  async function end(session: string): Promise<void> {
    const run = queue.then(() => host.delete(key(session)))
    queue = run.catch(() => undefined)
    await run
  }

  return { forOwner, context, fallback, attach, compact, fork, attachment, end }
}

export type RulesService = ReturnType<typeof createRules>

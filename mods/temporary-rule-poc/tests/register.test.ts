import { describe, expect, test, tier } from 'claude-code/testing'

import { ALPHA, BETA, command } from './fixtures/callers'
import { context, read, world, typed } from './fixtures/world'

tier('builtin')

describe('register', () => {
  test('the noun adds, lists and removes temporary instructions', { plugins: [ALPHA] }, async ($, on) => {
    world(on, { files: {} }, { stored: { 'prompt.context': 'seen' } })
    await $.command.run(command('alpha', { op: 'add', rule: { name: 'style', content: 'Use types.' } }))
    const loaded = await $.prompt.context(context())
    expect(loaded.instructionFiles?.map(file => file.path)).toEqual(['rules:alpha/style', '/repo/CLAUDE.md'])
    await $.command.run(command('alpha', { op: 'remove', name: 'style' }))
    expect((await $.prompt.context(context())).instructionFiles).toEqual(context().instructionFiles)
  })

  test('a plugin cannot list, replace or clear another plugin\'s rules', { plugins: [ALPHA, BETA] }, async ($, on) => {
    world(on, { files: {} })
    await $.command.run(command('alpha', { op: 'add', rule: { name: 'same', content: 'Alpha.' } }))
    await $.command.run(command('beta', { op: 'add', rule: { name: 'same', content: 'Beta.' } }))
    await $.command.run(command('alpha', { op: 'clear' }))
    expect((await $.command.run(command('alpha', { op: 'list' }))).text).toBe('[]')
    expect((await $.command.run(command('beta', { op: 'list' }))).text).toContain('Beta.')
  })

  test('matching Read/Edit/Write accesses attach scoped rules once per loop', { plugins: [ALPHA] }, async ($, on) => {
    world(on, { files: {} }, { stored: { 'prompt.context': 'seen' } })
    await $.command.run(command('alpha', { op: 'add', rule: { name: 'ts', content: 'Scoped.', paths: ['src/**/*.ts'] } }))
    await $.prompt.context(context())
    const edited = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' } as never)
    expect(edited.context).toEqual(['Contents of rules:alpha/ts:\n\nScoped.'])
    expect((await $.tool.call(read('/repo/src/app.ts'))).context).toBeUndefined()
    expect((await $.tool.call(read('/repo/src/app.ts', 'child'))).context).toHaveLength(1)
  })

  test('fallback rules arrive once without rewriting an unavailable instruction list', { plugins: [ALPHA] }, async ($, on) => {
    world(on, { files: {} })
    await $.command.run(command('alpha', { op: 'add', rule: { name: 'one', content: 'Temporary.' } }))
    expect((await $.prompt.context({ blocks: [] })).instructionFiles).toBeUndefined()
    expect((await $.prompt.submit(typed('hello'))).context).toHaveLength(1)
    expect((await $.prompt.submit(typed('again'))).context).toBeUndefined()
  })

  test('clear drops sources and rules do not leak into the new conversation', { plugins: [ALPHA] }, async ($, on) => {
    world(on, { files: {} })
    await $.command.run(command('alpha', { op: 'add', rule: { name: 'one', content: 'Temporary.' } }))
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect((await $.command.run(command('alpha', { op: 'list' }))).text).toBe('[]')
  })
})

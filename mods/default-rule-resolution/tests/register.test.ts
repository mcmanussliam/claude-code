import { describe, expect, mock, test, tier } from 'claude-code/testing'

import { PROVIDER } from './fixtures/provider'

tier('builtin')

describe('register', () => {
  test('registers discovered file-backed rules through the noun', { plugins: [PROVIDER] }, async ($, on) => {
    const registered: unknown[] = []
    on('rules.add', (_$, e, next) => {
      registered.push(e);
      return next(e)
    })

    mock.env(on, {})
    on('session.root', () => ({ value: '/repo' }))
    on('session.cwd', () => ({ value: '/repo' }))
    on('settings.read', () => ({ value: {} }))
    on('fs.stat', (_$, e) => {
      if (e.path !== '/repo/.claude/rules' && e.path !== '/repo/.claude/rules/style.md') {
        throw new Error('ENOENT')
      }

      return { value: { kind: e.path.endsWith('.md') ? 'file' : 'dir', realPath: e.path, size: 9, mtimeMs: 1, isLink: false } }
    })

    on('fs.list', () => ({ value: [{ name: 'style.md', kind: 'file', size: 9, mtimeMs: 1, isLink: false }] }))
    on('fs.read', () => ({ value: 'Physical.' }))
    on('prompt.context', (_$, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))
    await $.prompt.context({ blocks: [], instructionFiles: [] })
    expect(registered).toEqual([{
      name: 'file:/repo/.claude/rules/style.md', content: 'Physical.',
      source: { path: '/repo/.claude/rules/style.md', root: '/repo', kind: 'project' },
    }])
  })

  test('native tiers, imported parents and other blocks pass through unchanged', { plugins: [PROVIDER] }, async ($, on) => {
    mock.env(on, {})
    on('session.root', () => ({ value: '/repo' }))
    on('session.cwd', () => ({ value: '/repo' }))
    on('settings.read', () => ({ value: {} }))
    on('fs.stat', () => {
      throw new Error('ENOENT')
    })

    on('prompt.context', (_$, e) => ({ blocks: e.blocks, instructionFiles: e.instructionFiles }))
    const input = {
      blocks: [{ name: 'claudeMd', text: 'native' }, { name: 'currentDate', text: 'today' }],
      instructionFiles: [
        { path: '/policy/CLAUDE.md', kind: 'managed' as const, content: 'Policy.' },
        { path: '/home/me/.claude/CLAUDE.md', kind: 'user' as const, content: 'User.' },
        { path: '/repo/CLAUDE.md', kind: 'project' as const, content: 'Project.' },
        { path: '/repo/import.md', kind: 'project' as const, content: 'Imported.', parent: '/repo/CLAUDE.md' },
        { path: '/repo/CLAUDE.local.md', kind: 'local' as const, content: 'Local.' },
        { path: '/memory/MEMORY.md', kind: 'memory' as const, content: 'Memory.' },
      ],
    }
    expect(await $.prompt.context(input)).toEqual(input)
  })

  test('unknown instruction files are not reconstructed', { plugins: [PROVIDER] }, async ($, on) => {
    mock.env(on, {})
    on('session.root', () => ({ value: '/repo' }))
    on('session.cwd', () => ({ value: '/repo' }))
    on('settings.read', () => ({ value: {} }))
    on('fs.stat', () => {
      throw new Error('ENOENT')
    })

    on('prompt.context', (_$, e) => ({ blocks: e.blocks }))
    expect(await $.prompt.context({ blocks: [{ name: 'claudeMd', text: 'rewritten' }] })).toEqual({
      blocks: [{ name: 'claudeMd', text: 'rewritten' }],
    })
  })

  test('native nested rule attachments preserve text and origin', { plugins: [PROVIDER] }, async ($, on) => {
    mock.env(on, {})
    on('session.root', () => ({ value: '/repo' }))
    on('session.cwd', () => ({ value: '/repo' }))
    on('settings.read', () => ({ value: {} }))
    on('fs.stat', () => {
      throw new Error('ENOENT')
    })

    on('prompt.attachment', (_$, e) => ({ text: e.text }))
    expect(await $.prompt.attachment({ type: 'nested_memory', origin: { kind: 'engine' }, text: 'Native.' }))
      .toEqual({ text: 'Native.' })
  })
})

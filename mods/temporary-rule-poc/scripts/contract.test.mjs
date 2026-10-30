import assert from 'node:assert/strict'
import { test } from 'node:test'
import { access, context, harness } from './harness.mjs'

const native = [
  { path: '/policy/CLAUDE.md', kind: 'managed', content: 'Policy.' },
  { path: '/home/me/.claude/CLAUDE.md', kind: 'user', content: 'User.' },
  { path: '/repo/CLAUDE.md', kind: 'project', content: 'Project.' },
  { path: '/repo/import.md', kind: 'project', content: 'Imported.', parent: '/repo/CLAUDE.md' },
  { path: '/repo/CLAUDE.local.md', kind: 'local', content: 'Local.' },
  { path: '/memory/MEMORY.md', kind: 'memory', content: 'Memory.' },
]

test('native instruction boundary preserves native files, parents, order and blocks', async () => {
  const h = await harness()
  assert.deepEqual(await h.dispatch('prompt.context', context(native)), context(native))
})

test('native attachments are unchanged and unknown instructions stay unknown', async () => {
  const h = await harness()
  assert.deepEqual(await h.dispatch('prompt.context', { blocks: [{ name: 'claudeMd', text: 'rewritten' }] }),
    { blocks: [{ name: 'claudeMd', text: 'rewritten' }] })
  assert.deepEqual(await h.dispatch('prompt.attachment', { type: 'nested_memory', origin: { kind: 'engine' }, text: 'Native.' }), { text: 'Native.' })
})

test('add replaces by owner/name without duplicating the instruction', async () => {
  const h = await harness()
  const api = h.api('alpha')
  await api.add({ name: 'one', content: 'First.' })
  await api.add({ name: 'one', content: 'Second.' })
  assert.deepEqual(await api.list(), [{ name: 'one', content: 'Second.', sent: false }])
  const result = await h.dispatch('prompt.context', context(native))
  assert.equal(result.instructionFiles.filter(file => file.path === 'rules:alpha/one').length, 1)
  assert.equal(result.instructionFiles.find(file => file.path === 'rules:alpha/one').content, 'Second.')
})

test('caller-scoped list, remove and clear preserve another plugin and native policy', async () => {
  const h = await harness()
  await h.api('alpha').add({ name: 'one', content: 'A.' })
  await h.api('beta').add({ name: 'one', content: 'B.' })
  await h.api('alpha').remove({ name: 'beta/one' })
  await h.api('alpha').clear()
  assert.deepEqual(await h.api('alpha').list(), [])
  assert.deepEqual(await h.api('beta').list(), [{ name: 'one', content: 'B.', sent: false }])
  const loaded = (await h.dispatch('prompt.context', context(native))).instructionFiles
  assert.deepEqual(loaded.filter(file => !file.path.startsWith('rules:')), native)
})

test('names with separators cannot collide across owners', async () => {
  const h = await harness()
  await h.api('a/b').add({ name: 'c', content: 'First.' })
  await h.api('a').add({ name: 'b/c', content: 'Second.' })
  assert.equal((await h.api('a/b').list())[0].content, 'First.')
  assert.equal((await h.api('a').list())[0].content, 'Second.')
})

for (const tool of ['Read', 'Edit', 'Write']) {
  test(`${tool} activates matching rules once, and only in the matching loop`, async () => {
    const h = await harness()
    await h.api('alpha').add({ name: 'ts', content: 'Scoped.', paths: ['src/**/*.ts'] })
    await h.dispatch('prompt.context', context())
    assert.equal((await h.dispatch('tool.call', access(tool))).context.length, 1)
    assert.equal((await h.dispatch('tool.call', access(tool))).context, undefined)
    assert.equal((await h.dispatch('tool.call', access(tool, '/repo/src/other.ts', 'child'))).context.length, 1)
  })
}

test('unmatched, sibling and escaping paths do not activate rules', async () => {
  const h = await harness()
  await h.api('alpha').add({ name: 'ts', content: 'Scoped.', paths: ['src/**/*.ts'] })
  await h.dispatch('prompt.context', context())
  for (const path of ['/repo/README.md', '/repo-other/src/app.ts', '/repo/../elsewhere/src/app.ts']) {
    assert.equal((await h.dispatch('tool.call', access('Read', path))).context, undefined)
  }

  assert.equal((await h.dispatch('tool.call', access('Read', './src/../src/app.ts'))).context.length, 1)
})

test('denied and failed calls do not consume the delivery ledger', async () => {
  const h = await harness()
  await h.api('alpha').add({ name: 'ts', content: 'Scoped.', paths: ['src/**/*.ts'] })
  await h.dispatch('prompt.context', context())
  h.state.toolResult = { deny: 'No.' }
  assert.equal((await h.dispatch('tool.call', access())).context, undefined)
  h.state.toolResult = { result: {}, isError: true }
  assert.equal((await h.dispatch('tool.call', access())).context, undefined)
  h.state.toolResult = { result: {}, text: 'ok', context: ['Existing.'] }
  assert.equal((await h.dispatch('tool.call', access())).context.length, 2)
})

test('mentions attach matching rules and share deduplication with file tools', async () => {
  const h = await harness()
  await h.api('alpha').add({ name: 'ts', content: 'Scoped.', paths: ['src/**/*.ts'] })
  await h.dispatch('prompt.context', context())
  assert.equal((await h.dispatch('prompt.mention', { mention: '@src/app.ts', path: '/repo/src/app.ts' })).context.length, 1)
  assert.equal((await h.dispatch('tool.call', access())).context, undefined)
})

test('fallback delivery is once and unavailable native instructions are never reconstructed', async () => {
  const h = await harness()
  await h.api('alpha').add({ name: 'one', content: 'Temporary.' })
  await h.dispatch('prompt.context', { blocks: [] })
  const first = await h.dispatch('prompt.submit', { text: 'hi', context: ['Existing.'] })
  assert.equal(first.context.length, 2)
  assert.equal((await h.dispatch('prompt.submit', { text: 'again' })).context, undefined)
})

for (const flag of ['CLAUDE_CODE_SIMPLE', 'CLAUDE_CODE_DISABLE_ATTACHMENTS']) {
  test(`${flag} suppresses fallback and scoped attachments`, async () => {
    const h = await harness({ env: { [flag]: '1' } })
    await h.api('alpha').add({ name: 'always', content: 'Always.' })
    await h.api('alpha').add({ name: 'ts', content: 'Scoped.', paths: ['src/**'] })
    assert.equal((await h.dispatch('prompt.submit', { text: 'hi' })).context, undefined)
    assert.equal((await h.dispatch('tool.call', access())).context, undefined)
  })
}

test('compaction allows scoped rules to be sent again to only the compacted loop', async () => {
  const h = await harness()
  await h.api('alpha').add({ name: 'ts', content: 'Scoped.', paths: ['src/**'] })
  await h.dispatch('prompt.context', context())
  await h.dispatch('tool.call', access())
  await h.dispatch('tool.call', access('Read', '/repo/src/app.ts', 'other'))
  await h.dispatch('session.compact', { agentId: undefined })
  assert.equal((await h.dispatch('tool.call', access())).context.length, 1)
  assert.equal((await h.dispatch('tool.call', access('Read', '/repo/src/app.ts', 'other'))).context, undefined)
})

test('forked agents inherit the parent ledger while independent agents do not', async () => {
  const h = await harness()
  await h.api('alpha').add({ name: 'ts', content: 'Scoped.', paths: ['src/**'] })
  await h.dispatch('prompt.context', context())
  await h.dispatch('tool.call', access())
  await h.dispatch('agent.spawn', { fork: true })
  assert.equal((await h.dispatch('tool.call', access('Read', '/repo/src/app.ts', 'child'))).context, undefined)
  assert.equal((await h.dispatch('tool.call', access('Read', '/repo/src/app.ts', 'independent'))).context.length, 1)
})

test('hot reload retains conversation sources, clear removes them, and new sessions start empty', async () => {
  const h = await harness()
  await h.api('alpha').add({ name: 'one', content: 'Temporary.' })
  const reloaded = await harness({ store: h.store })
  assert.equal((await reloaded.api('alpha').list()).length, 1)
  await reloaded.dispatch('session.end', { reason: 'clear', sessionId: 's1' })
  assert.deepEqual(await reloaded.api('alpha').list(), [])
  reloaded.state.sessionId = 's2'
  assert.deepEqual(await reloaded.api('alpha').list(), [])
})

test('concurrent additions retain every rule', async () => {
  const h = await harness()
  await Promise.all(Array.from({ length: 12 }, (_, i) => h.api('alpha').add({ name: `rule-${i}`, content: `Rule ${i}` })))
  assert.equal((await h.api('alpha').list()).length, 12)
})

test('frontmatter accepts comma-separated strings without splitting brace groups', async () => {
  const api = (await harness()).api('alpha')
  assert.deepEqual(await api.parse({ text: '---\npaths: src/**/*.{ts,tsx}, tests/**\n---\nBody.' }),
    { content: 'Body.', paths: ['src/**/*.{ts,tsx}', 'tests/**'] })
  assert.deepEqual(await api.parse({ text: '---\npaths: [\n---\nBody.' }), { content: 'Body.' })
  assert.equal(await api.matches({ paths: ['src/**/*.{ts,tsx}'], path: 'src/nested/app.tsx' }), true)
  assert.equal(await api.matches({ paths: ['*.md'], path: 'docs/README.md' }), false)
  assert.equal(await api.matches({ paths: ['photos [2024/**'], path: 'photos [2024/a' }), false)
  assert.equal(await api.matches({ paths: ['{1..1000000}/*.ts'], path: '1/app.ts' }), false)
})

test('invalid input is rejected and unsupported instruction tiers cannot be added', async () => {
  const h = await harness()
  await assert.rejects(h.api('alpha').add({ name: '', content: 'Bad.' }))
  await assert.rejects(h.api('alpha').add({ name: 'one', content: 'Bad.', paths: [42] }))
  await h.api('alpha').add({ name: 'one', content: 'Ordinary.', kind: 'managed' })
  assert.equal((await h.dispatch('prompt.context', context())).instructionFiles[0].kind, 'user')
})

test('engine.create installs working backing methods, not dispatch-only placeholders', async () => {
  const h = await harness({ withDefault: false })
  const raw = h.engine.rules
  assert.equal((await raw.add({ name: 'raw', content: 'Direct.' })).name, 'raw')
  assert.equal((await raw.list())[0].content, 'Direct.')
  assert.deepEqual(await raw.parse({ text: '---\npaths: src/**\n---\nBody.' }), { paths: ['src/**'], content: 'Body.' })
  assert.equal(await raw.matches({ paths: ['src/**'], path: 'src/app.ts' }), true)
  await raw.remove({ name: 'raw' })
  assert.deepEqual(await raw.list(), [])
  await raw.add({ name: 'again', content: 'Again.' })
  await raw.clear()
  assert.deepEqual(await raw.list(), [])
})

test('delivery failure preserves the native tool result without executing the tool twice', async () => {
  const h = await harness({ withDefault: false })
  await h.api('alpha').add({ name: 'ts', content: 'Scoped.', paths: ['src/**'] })
  await h.dispatch('prompt.context', context())
  h.state.failStore = true
  const result = await h.dispatch('tool.call', access())
  assert.deepEqual(result, h.state.toolResult)
  assert.equal(h.state.toolCalls, 1)
  h.state.failStore = false
  assert.equal((await h.dispatch('tool.call', access())).context.length, 1)
})

import { build } from 'esbuild'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
await build({
  absWorkingDir: root,
  entryPoints: ['scripts/dependencies.mjs'],
  outfile: 'hooks/vendor/dependencies.js',
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'es2023',
  legalComments: 'external',
})

const notices = []
for (const name of ['yaml', 'minimatch', 'brace-expansion', 'balanced-match']) {
  let dir = dirname(require.resolve(name))
  while (true) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
      if (pkg.name === name) {
        break
      }
    } catch {
      /* Find the package root above its export directory. */
    }

    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`Cannot locate license for ${name}`)
    }

    dir = parent
  }

  let license
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try {
      license = await readFile(join(dir, filename), 'utf8');
      break
    } catch {
      /* Try next spelling. */
    }
  }

  if (license === undefined) {
    throw new Error(`Missing license for ${name}`)
  }

  notices.push(`${name}\n${'='.repeat(name.length)}\n${license}`)
}

await writeFile(join(root, 'hooks/vendor/THIRD_PARTY_NOTICES.txt'), notices.join('\n\n'))

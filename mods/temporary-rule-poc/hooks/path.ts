/** Lexical path normalization only; never invents filesystem consent. */
export function normalized(path: string): string {
  const forward = path.replace(/\\/g, '/')
  const prefix = /^[A-Za-z]:/.exec(forward)?.[0] ?? (forward.startsWith('/') ? '/' : '')
  const rest = prefix === '/' ? forward.slice(1) : forward.slice(prefix.length).replace(/^\//, '')
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') {
      continue
    }

    if (part === '..') {
      parts.pop();
      continue
    }

    parts.push(part)
  }

  return `${prefix}${prefix !== '' && prefix !== '/' ? '/' : ''}${parts.join('/')}`
}

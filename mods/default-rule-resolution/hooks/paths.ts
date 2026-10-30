export function normalize(path: string): string {
  const value = path.replace(/\\/g, '/')
  const prefix = /^[A-Za-z]:/.exec(value)?.[0] ?? (value.startsWith('/') ? '/' : '')
  const parts: string[] = []
  for (const part of value.slice(prefix.length).split('/')) {
    if (part === '' || part === '.') {
      continue
    }

    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }

  return `${prefix}${prefix !== '' && prefix !== '/' ? '/' : ''}${parts.join('/')}`
}

export function parent(path: string): string {
  const normalized = normalize(path).replace(/\/$/, '')
  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized}/`
  }

  const cut = normalized.lastIndexOf('/')
  const up = cut <= 0 ? '/' : normalized.slice(0, cut)
  return /^[A-Za-z]:$/.test(up) ? `${up}/` : up
}

export function below(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)
}

export function ancestry(path: string): string[] {
  const dirs: string[] = []
  let current = normalize(path)
  while (true) {
    dirs.unshift(current)
    const up = parent(current)
    if (up === current) {
      return dirs
    }

    current = up
  }
}

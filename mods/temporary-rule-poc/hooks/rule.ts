import { expand, minimatch, parse } from './vendor/dependencies'

type Rule = { paths?: readonly string[] }

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Splits a rule file into its `paths` globs (a string or a list of strings)
 * and its body.
 *
 * Frontmatter that is not valid YAML is treated as absent.
 */
export function parseRule(text: string): { paths?: string[]; content: string } {
  const match = FRONTMATTER.exec(text)
  if (!match) {
    return { content: text }
  }

  const content = text.slice(match[0].length)
  let data: unknown
  try {
    data = parse(match[1] ?? '')
  } catch {
    return { content }
  }

  return { ...pathsOf((data as { paths?: unknown } | null)?.paths), content }
}

/** Normalises a `paths` value to a non-empty list of globs, or nothing. */
export function pathsOf(raw: unknown): { paths?: string[] } {
  // Claude accepts a comma-separated string as well as a YAML list. Commas
  // inside a brace group belong to the glob, not to the list of patterns.
  const values = typeof raw === 'string' ? splitPaths(raw) : [raw].flat()
  const paths = values.filter((p): p is string => typeof p === 'string' && p !== '')

  return paths.length > 0 ? { paths } : {}
}

function splitPaths(value: string): string[] {
  const paths: string[] = []
  let depth = 0
  let start = 0
  let escaped = false
  for (let i = 0;i < value.length;i++) {
    const char = value[i]
    if (escaped) {
      escaped = false;
      continue
    }

    if (char === '\\') {
      escaped = true;
      continue
    }

    if (char === '{') {
      depth++
    }

    if (char === '}') {
      depth = Math.max(0, depth - 1)
    }

    if (char === ',' && depth === 0) {
      paths.push(value.slice(start, i).trim())
      start = i + 1
    }
  }

  paths.push(value.slice(start).trim())
  return paths
}

/** Whether `relative` matches one of the rule's globs. */
export function isMatch(rule: Rule, relative: string): boolean {
  let remaining = 1000
  let bytes = 4 * 1024 * 1024
  for (const glob of rule.paths ?? []) {
    if (!validBrackets(glob)) {
      continue
    }

    const braced = /(?<!\\)\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(glob)
    if (!braced) {
      if (minimatch(relative, glob, { dot: true, nobrace: true })) {
        return true
      }

      continue
    }

    if (remaining <= 0 || bytes <= 0) {
      continue
    }

    // Ask for one sentinel expansion beyond the remaining budget so a
    // truncating expander cannot turn an overflowing pattern into a partial match.
    const patterns = expand(glob, { max: remaining + 1, maxLength: bytes + 1 })
    // The bounded expander leaves an overflowing expression unexpanded.
    if (patterns.length === 1 && patterns[0] === glob) {
      continue
    }

    const size = patterns.reduce((total, item) => total + new TextEncoder().encode(item).length, 0)
    if (patterns.length > remaining || size > bytes) {
      continue
    }

    remaining -= patterns.length
    bytes -= size
    if (patterns.some(pattern => minimatch(relative, pattern, { dot: true, nobrace: true }))) {
      return true
    }
  }

  return false
}

/** An unclosed bracket expression matches nothing in the native rule loader. */
function validBrackets(pattern: string): boolean {
  let opened = false
  for (let i = 0;i < pattern.length;i++) {
    if (pattern[i] === '\\') {
      i++;
      continue
    }

    if (pattern[i] === '[') {
      opened = true
    }

    if (pattern[i] === ']') {
      opened = false
    }
  }

  return !opened
}

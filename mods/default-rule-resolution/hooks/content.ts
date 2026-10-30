/** Strip block comments outside fenced code; unknown frontmatter is handled by $.rules.parse. */
export function withoutComments(text: string): string {
  let fence: string | undefined
  let comment = false
  const lines: string[] = []
  for (const line of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (!comment && marker !== undefined) {
      if (fence === undefined) {
        fence = marker[0]
      } else if (marker[0] === fence) {
        fence = undefined
      }

      lines.push(line)
      continue
    }

    if (fence !== undefined) {
      lines.push(line)
      continue
    }

    let remaining = line
    let kept = ''
    while (remaining !== '') {
      const at = remaining.indexOf(comment ? '-->' : '<!--')
      if (at === -1) {
        if (!comment) {
          kept += remaining
        }

        break
      }

      if (!comment) {
        kept += remaining.slice(0, at)
      }

      remaining = remaining.slice(at + (comment ? 3 : 4))
      comment = !comment
    }

    lines.push(kept)
  }

  return lines.join('\n')
}

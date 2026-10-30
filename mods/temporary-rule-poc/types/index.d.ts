/** Conversation-scoped rule utilities. No filesystem or native policy mutation. */
export type RulesRule = {
  name: string
  content: string
  paths?: readonly string[]
  /** File-backed rules retain their base directory and instruction tier. */
  source?: RulesSource
}

export type RulesSource = { path: string; root: string; kind: 'user' | 'project' }

export type RulesStatus = RulesRule & { sent: boolean }
export type RulesParsed = { content: string; paths?: string[] }

export type Rules = {
  /** Add or replace a rule owned by the calling plugin, until /clear. */
  add: (rule: RulesRule) => Promise<RulesStatus>
  /** Remove the caller's rule. Previously attached conversation text remains. */
  remove: (request: { name: string }) => Promise<void>
  /** Clear only the caller's temporary rules, never native or other plugins' rules. */
  clear: () => Promise<void>
  /** List the caller's active rules and their main-loop delivery status. */
  list: () => Promise<RulesStatus[]>
  /** Parse Claude-style YAML frontmatter, without executing or importing text. */
  parse: (request: { text: string }) => Promise<RulesParsed>
  /** Match a project-relative path against a rule's globs. */
  matches: (request: { paths: readonly string[]; path: string }) => Promise<boolean>
}

declare module 'claude-code' {
  interface EngineInterface {
    /** Provided by temporary-rule-poc; rule names are scoped to the caller. */
    rules: Rules
  }
}

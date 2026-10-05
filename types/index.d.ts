export type CompactLine = { role: 'user' | 'assistant'; text: string }

export type CompactRecord = {
  at: number
  trigger: 'manual' | 'auto' | 'plugin'
  instructions?: string
  tokensBefore?: number
  tokensAfter?: number
  before: CompactLine[]
  after: CompactLine[]
}

declare module 'claude-code' {
  interface PluginState {
    'visible-compact': { last: CompactRecord | null }
  }
}

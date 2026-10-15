import { vi } from 'vitest'

/**
 * Makes `window.matchMedia` answer as a phone or touch screen would: the queries in `matching`
 * match, every other one doesn't. Undo with vi.unstubAllGlobals().
 */
export function stubMedia(matching: readonly string[]): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matching.includes(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

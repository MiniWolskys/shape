import type { Screen } from '../state/navigation.ts'

/**
 * The screen as scroll memory knows it. The editor is one screen whatever its painting: a draft's
 * first save and a rename (R17) change the id in the URL while the player stays put.
 */
export function scrollKey(screen: Screen): string {
  return screen.name
}

/**
 * Where each screen was scrolled to, so browser Back and Forward return the player to the same
 * place (e.g. deep in the Library), while links and buttons open a screen at its top.
 */
export function createScrollMemory() {
  const positions = new Map<string, number>()
  return {
    save(key: string, y: number): void {
      positions.set(key, y)
    },
    /** Where `key` opens: its saved place when reached through the browser history, else 0. */
    target(key: string, fromHistory: boolean): number {
      return fromHistory ? (positions.get(key) ?? 0) : 0
    },
  }
}

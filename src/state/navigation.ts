import { create } from 'zustand'

export type Screen =
  | { name: 'home' }
  | { name: 'library' }
  /** `paintingId: null` is a new painting, not in the workspace until its first change (R18). */
  | { name: 'editor'; paintingId: string | null }
  | { name: 'export' }

/** The draft's place in the URL (ids Shape makes always hold a `_`, so none is `new`). */
const DRAFT = 'new'

/** The URL hash of a screen: `#/`, `#/library`, `#/edit/<id>` (`#/edit/new` for a draft), `#/export`. */
export function formatHash(screen: Screen): string {
  switch (screen.name) {
    case 'home':
      return '#/'
    case 'library':
      return '#/library'
    case 'export':
      return '#/export'
    case 'editor':
      return `#/edit/${screen.paintingId === null ? DRAFT : encodeURIComponent(screen.paintingId)}`
  }
}

/** The screen a URL hash names; anything unknown is home. */
export function parseHash(hash: string): Screen {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter((part) => part !== '')
  const [first, second, ...rest] = parts
  if (first === 'library' && second === undefined) return { name: 'library' }
  if (first === 'export' && second === undefined) return { name: 'export' }
  if (first === 'edit' && second !== undefined && rest.length === 0) {
    let id: string
    try {
      id = decodeURIComponent(second)
    } catch (error) {
      console.warn('Ignoring a malformed painting id in the URL', error)
      return { name: 'home' }
    }
    return { name: 'editor', paintingId: id === DRAFT ? null : id }
  }
  return { name: 'home' }
}

/**
 * The screen a page load opens: the one in the URL, except a draft, which only lived in the
 * editor that was closed (the library sends players home when it has nothing to show).
 */
export function screenAtStartup(hash: string): Screen {
  const screen = parseHash(hash)
  return screen.name === 'editor' && screen.paintingId === null ? { name: 'library' } : screen
}

function sameScreen(a: Screen, b: Screen): boolean {
  return formatHash(a) === formatHash(b)
}

/**
 * Asked before the browser (Back, Forward, a typed URL) leaves the current screen; false keeps
 * the player there. The editor sets one that saves first (and refuses when the save fails).
 */
export type LeaveGuard = (next: Screen) => boolean

let leaveGuard: LeaveGuard | null = null

export function setLeaveGuard(guard: LeaveGuard | null): void {
  leaveGuard = guard
}

interface NavigationState {
  screen: Screen
  /**
   * Shows `screen` and records it in the browser history: a new entry, or with `replace` in
   * place of the current one (a redirect, or the open painting getting its id).
   */
  go(screen: Screen, options?: { replace?: boolean }): void
}

function writeHistory(screen: Screen, replace: boolean): void {
  const hash = formatHash(screen)
  if (location.hash === hash) return
  if (replace) history.replaceState(null, '', hash)
  else history.pushState(null, '', hash)
}

export const useNavigation = create<NavigationState>()((set) => ({
  screen: screenAtStartup(typeof location === 'undefined' ? '' : location.hash),
  go: (screen, options) => {
    writeHistory(screen, options?.replace ?? false)
    set({ screen })
  },
}))

/** The browser moved to another URL: show its screen, unless the leave guard keeps this one. */
function followLocation(): void {
  const next = parseHash(location.hash)
  const { screen } = useNavigation.getState()
  if (sameScreen(next, screen)) return
  if (leaveGuard && !leaveGuard(next)) {
    // Staying: the URL goes back to this screen.
    history.pushState(null, '', formatHash(screen))
    return
  }
  // The guard's save may have rewritten the URL (a renamed painting, R17): it shows `next`.
  writeHistory(next, true)
  useNavigation.setState({ screen: next })
}

/**
 * Keeps the screen and the URL together (I10): writes the current screen into the URL, then
 * follows Back, Forward and typed hashes. Returns the function that stops it.
 */
export function startHashRouting(): () => void {
  writeHistory(useNavigation.getState().screen, true)
  window.addEventListener('popstate', followLocation)
  window.addEventListener('hashchange', followLocation)
  return () => {
    window.removeEventListener('popstate', followLocation)
    window.removeEventListener('hashchange', followLocation)
  }
}

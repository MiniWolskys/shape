import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  formatHash,
  parseHash,
  screenAtStartup,
  setLeaveGuard,
  startHashRouting,
  useNavigation,
} from './navigation.ts'

/** What the browser does on Back/Forward or a typed hash: the URL changes, then popstate. */
function browserGoesTo(hash: string) {
  history.replaceState(null, '', hash)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

describe('hash routes', () => {
  it('formats every screen', () => {
    expect(formatHash({ name: 'home' })).toBe('#/')
    expect(formatHash({ name: 'library' })).toBe('#/library')
    expect(formatHash({ name: 'export' })).toBe('#/export')
    expect(formatHash({ name: 'editor', paintingId: 'rose_ab12' })).toBe('#/edit/rose_ab12')
    expect(formatHash({ name: 'editor', paintingId: null })).toBe('#/edit/new')
  })

  it('parses what it formats, and anything unknown as home', () => {
    for (const screen of [
      { name: 'home' },
      { name: 'library' },
      { name: 'export' },
      { name: 'editor', paintingId: 'rose_ab12' },
      { name: 'editor', paintingId: null },
    ] as const) {
      expect(parseHash(formatHash(screen))).toEqual(screen)
    }
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#')).toEqual({ name: 'home' })
    expect(parseHash('#/nowhere')).toEqual({ name: 'home' })
    expect(parseHash('#/edit/')).toEqual({ name: 'home' })
    expect(parseHash('#/edit/a/b')).toEqual({ name: 'home' })
    expect(parseHash('#/library/')).toEqual({ name: 'library' })
  })

  it('reopens the screen of a reload, except a draft that was never saved', () => {
    expect(screenAtStartup('#/edit/rose_ab12')).toEqual({ name: 'editor', paintingId: 'rose_ab12' })
    expect(screenAtStartup('#/export')).toEqual({ name: 'export' })
    // The draft only lived in the editor: the library (or home, when there is none) instead.
    expect(screenAtStartup('#/edit/new')).toEqual({ name: 'library' })
  })
})

describe('navigation with the browser history', () => {
  let stop: () => void = () => {}
  beforeEach(() => {
    history.replaceState(null, '', '#/')
    useNavigation.setState({ screen: { name: 'home' } })
    stop = startHashRouting()
  })
  afterEach(() => {
    stop()
    setLeaveGuard(null)
  })

  it('pushes a history entry for each screen, and replaces one when asked', () => {
    const before = history.length
    useNavigation.getState().go({ name: 'library' })
    expect(location.hash).toBe('#/library')
    useNavigation.getState().go({ name: 'editor', paintingId: null })
    expect(location.hash).toBe('#/edit/new')
    expect(history.length).toBe(before + 2)
    useNavigation.getState().go({ name: 'editor', paintingId: 'rose_ab12' }, { replace: true })
    expect(location.hash).toBe('#/edit/rose_ab12')
    expect(history.length).toBe(before + 2)
  })

  it('follows Back and Forward', () => {
    browserGoesTo('#/library')
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
    browserGoesTo('#/edit/rose_ab12')
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: 'rose_ab12' })
    // hashchange follows popstate for the same move: nothing more happens.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: 'rose_ab12' })
  })

  it('follows a hash typed in the address bar', () => {
    history.replaceState(null, '', '#/export')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(useNavigation.getState().screen).toEqual({ name: 'export' })
  })

  it('asks the leave guard first, and stays (restoring the URL) when it refuses', () => {
    useNavigation.getState().go({ name: 'editor', paintingId: 'rose_ab12' })
    const asked: string[] = []
    let allow = false
    setLeaveGuard((next) => {
      asked.push(formatHash(next))
      return allow
    })
    browserGoesTo('#/library')
    expect(asked).toEqual(['#/library'])
    expect(useNavigation.getState().screen).toEqual({ name: 'editor', paintingId: 'rose_ab12' })
    expect(location.hash).toBe('#/edit/rose_ab12')

    allow = true
    browserGoesTo('#/library')
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('keeps the URL of the new screen when the guard renames the one being left', () => {
    useNavigation.getState().go({ name: 'editor', paintingId: 'painting_abc' })
    // Saving on the way out gives the painting its title's id (R17), which the route follows.
    setLeaveGuard(() => {
      useNavigation.getState().go({ name: 'editor', paintingId: 'rose_abc' }, { replace: true })
      return true
    })
    browserGoesTo('#/library')
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
    expect(location.hash).toBe('#/library')
  })

  it('does not ask the guard when the app itself navigates', () => {
    let asked = 0
    setLeaveGuard(() => {
      asked += 1
      return false
    })
    useNavigation.getState().go({ name: 'library' })
    expect(asked).toBe(0)
    expect(useNavigation.getState().screen).toEqual({ name: 'library' })
  })

  it('writes the startup screen into the URL without a new entry', () => {
    stop()
    history.replaceState(null, '', '#/edit/new')
    useNavigation.setState({ screen: screenAtStartup(location.hash) })
    const before = history.length
    stop = startHashRouting()
    expect(location.hash).toBe('#/library')
    expect(history.length).toBe(before)
  })
})

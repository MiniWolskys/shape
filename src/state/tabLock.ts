import { create } from 'zustand'

/**
 * One tab at a time edits the workspace (R38): two tabs saving the same IndexedDB records would
 * delete each other's pictures. `waiting` while finding out, `active` when this tab is the one,
 * `elsewhere` while another tab is (this one shows a notice with "Use here").
 */
export type TabStatus = 'waiting' | 'active' | 'elsewhere'

/** How a tab learns whether it is the active one. */
export interface TabLockDriver {
  /** Starts finding out; `onChange` reports every status from then on. */
  start(onChange: (status: TabStatus) => void): void
  /** Makes this tab the active one, taking over from the other. */
  takeOver(): void
  /** Lets go (the page is closing, or the app unmounted). */
  stop(): void
}

export const LOCK_NAME = 'shape-workspace'

/** The part of the Web Locks API Shape uses (navigator.locks). */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<unknown>
}

/** DOMExceptions are not Errors in every realm (jsdom): only the name is checked. */
const isAbort = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'

/**
 * The active tab holds an exclusive Web Lock. A tab that finds it taken waits in line for it
 * (so it becomes active once the other tab closes) and can steal it with "Use here"; the tab it
 * was stolen from learns at once, from its lock request failing with an AbortError.
 */
export function webLockDriver(locks: LockManagerLike): TabLockDriver {
  let report: (status: TabStatus) => void = () => {}
  let stopped = false
  /** Ends the hold on the lock this tab has, if any. */
  let release: (() => void) | null = null
  /** A request of this tab already waits in line. */
  let inLine = false

  function request(options: { ifAvailable?: boolean; steal?: boolean }) {
    const queued = !options.ifAvailable && !options.steal
    if (queued) {
      if (inLine) return
      inLine = true
    }
    const hold = (lock: unknown): Promise<void> | void => {
      if (queued) inLine = false
      if (stopped) return
      if (lock === null) {
        // Another tab has it: wait in line behind it.
        report('elsewhere')
        request({})
        return
      }
      report('active')
      return new Promise<void>((resolve) => {
        release = resolve
      })
    }
    locks.request(LOCK_NAME, options, hold).then(
      () => {},
      (error: unknown) => {
        if (queued) inLine = false
        if (stopped) return
        if (!isAbort(error)) {
          console.error('Could not hold the workspace lock', error)
          return
        }
        // Stolen by a tab that chose "Use here": stop at once, and wait in line again.
        release = null
        report('elsewhere')
        request({})
      },
    )
  }

  return {
    start(onChange) {
      report = onChange
      stopped = false
      report('waiting')
      request({ ifAvailable: true })
    },
    takeOver() {
      request({ steal: true })
    },
    stop() {
      stopped = true
      release?.()
      release = null
    },
  }
}

/** The part of BroadcastChannel the fallback uses. */
export interface ChannelLike {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent) => void) | null
  close(): void
}

type TabMessage =
  | { type: 'hello'; id: string }
  | { type: 'active'; id: string; since: number }
  | { type: 'take'; id: string; since: number }

const isTabMessage = (v: unknown): v is TabMessage =>
  typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string'

/** How long a new tab waits for an active tab to answer before it becomes the active one. */
export const ANSWER_MS = 400

/**
 * Without Web Locks: tabs talk over a BroadcastChannel. A new tab says hello; the active tab
 * answers at once, else the new tab becomes active after ANSWER_MS. "Use here" tells the
 * active tab to stop. If two tabs ever both think they are active, the later one wins.
 */
export function channelDriver(
  channel: ChannelLike,
  options: { id?: string; now?: () => number } = {},
): TabLockDriver {
  const id = options.id ?? Math.random().toString(36).slice(2)
  const now = options.now ?? Date.now
  let report: (status: TabStatus) => void = () => {}
  let status: TabStatus = 'waiting'
  let since = 0
  let wait: ReturnType<typeof setTimeout> | undefined

  const set = (next: TabStatus) => {
    status = next
    report(next)
  }
  const becomeActive = (type: 'active' | 'take') => {
    clearTimeout(wait)
    since = now()
    set('active')
    channel.postMessage({ type, id, since } satisfies TabMessage)
  }

  channel.onmessage = (event) => {
    const message = event.data
    if (!isTabMessage(message) || message.id === id) return
    if (message.type === 'hello') {
      if (status === 'active') channel.postMessage({ type: 'active', id, since })
      return
    }
    if (message.type === 'take') {
      if (status !== 'elsewhere') set('elsewhere')
      clearTimeout(wait)
      return
    }
    // Another tab is active.
    if (status === 'waiting') {
      clearTimeout(wait)
      set('elsewhere')
    } else if (status === 'active') {
      const theyAreLater = message.since > since || (message.since === since && message.id > id)
      if (theyAreLater) set('elsewhere')
      else channel.postMessage({ type: 'active', id, since })
    }
  }

  return {
    start(onChange) {
      report = onChange
      set('waiting')
      channel.postMessage({ type: 'hello', id } satisfies TabMessage)
      wait = setTimeout(() => {
        if (status === 'waiting') becomeActive('active')
      }, ANSWER_MS)
    },
    takeOver() {
      becomeActive('take')
    },
    stop() {
      clearTimeout(wait)
      channel.onmessage = null
      channel.close()
    },
  }
}

/** Without Web Locks or BroadcastChannel there is no other tab to know of. */
export function soloDriver(): TabLockDriver {
  return {
    start(onChange) {
      onChange('active')
    },
    takeOver() {},
    stop() {},
  }
}

/** Web Locks where the browser has them, else a BroadcastChannel, else this tab alone. */
export function browserDriver(): TabLockDriver {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (locks) return webLockDriver(locks)
  if (typeof BroadcastChannel === 'function') {
    return channelDriver(new BroadcastChannel(LOCK_NAME))
  }
  return soloDriver()
}

let makeDriver: () => TabLockDriver = browserDriver

/** Chooses how tabs find each other (tests use soloDriver or fakes). */
export function setTabLockDriver(factory: () => TabLockDriver): void {
  makeDriver = factory
}

interface TabLockState {
  status: TabStatus
  /** "Use here": this tab becomes the active one. */
  takeOver(): void
}

let driver: TabLockDriver | null = null

export const useTabLock = create<TabLockState>(() => ({
  status: 'waiting',
  takeOver() {
    driver?.takeOver()
  },
}))

/**
 * Starts finding out whether this tab is the active one; returns a function that stops.
 * `onLost` runs at once when another tab takes over (stop saving). `onRegained` runs when this
 * tab becomes active again after it had been (what it holds in memory may be stale).
 */
export function startTabLock(
  handlers: { onLost?: () => void; onRegained?: () => void } = {},
): () => void {
  const current = makeDriver()
  driver = current
  let wasActive = false
  useTabLock.setState({ status: 'waiting' })
  current.start((status) => {
    const previous = useTabLock.getState().status
    useTabLock.setState({ status })
    if (status === 'active') {
      if (wasActive && previous !== 'active') handlers.onRegained?.()
      wasActive = true
    } else if (previous === 'active') {
      handlers.onLost?.()
    }
  })
  return () => {
    current.stop()
    if (driver === current) driver = null
  }
}

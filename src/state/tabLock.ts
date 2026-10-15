import { create } from 'zustand'

/**
 * One tab at a time edits the workspace (R38): two tabs saving the same IndexedDB records would
 * delete each other's pictures. `waiting` while finding out, `active` when this tab is the one,
 * `elsewhere` while another tab is (this one shows a notice with "Use here").
 */
export type TabStatus = 'waiting' | 'active' | 'elsewhere'

/** How a tab learns whether it is the active one. */
export interface TabLockDriver {
  /**
   * Starts finding out; `onChange` reports every status from then on. With `takeOver`, this
   * tab takes over at once (the page reloaded to do so). `settle` resolves once this tab's
   * storage work in flight has finished: a tab losing its place lets the next one read the
   * storage only after that.
   */
  start(
    onChange: (status: TabStatus) => void,
    options?: { takeOver?: boolean; settle?: () => Promise<void> },
  ): void
  /** Makes this tab the active one, taking over from the other. */
  takeOver(): void
  /** Lets go (the page is closing, or the app unmounted). */
  stop(): void
}

export const LOCK_NAME = 'shape-workspace'
/**
 * Held around every read and write of the stored workspace, and never stolen: a tab that
 * takes over reads the storage only once the old tab's save in flight has finished.
 */
export const IO_LOCK_NAME = 'shape-workspace-io'

/** The part of the Web Locks API Shape uses (navigator.locks). */
export interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; steal?: boolean },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>
}

/** DOMExceptions are not Errors in every realm (jsdom): only the name is checked. */
const isAbort = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'

const browserLocks = (): LockManagerLike | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.locks

/**
 * Runs a read or write of the stored workspace under IO_LOCK_NAME (see there). Without Web
 * Locks, or when that lock can't be had at all, it just runs.
 */
export function withWorkspaceIo<T>(
  task: () => Promise<T>,
  locks: LockManagerLike | undefined = browserLocks(),
): Promise<T> {
  if (!locks) return task()
  let started = false
  const held = locks.request(IO_LOCK_NAME, {}, () => {
    started = true
    return task()
  }) as Promise<T>
  return held.catch((error: unknown) => {
    // The task's own failure goes to the caller; only a lock that never came is worked around.
    if (started) throw error
    console.error('Could not take the storage lock; using the storage without it', error)
    return task()
  })
}

/**
 * The active tab holds an exclusive Web Lock. A tab that finds it taken waits in line for it
 * (so it becomes active once the other tab closes) and can steal it with "Use here"; the tab it
 * was stolen from learns at once, from its lock request failing with an AbortError. Storage
 * work is ordered by IO_LOCK_NAME (withWorkspaceIo), not by this lock. If the lock can't be had
 * at all (a SecurityError, say), the tab works alone rather than wait forever.
 */
export function webLockDriver(locks: LockManagerLike): TabLockDriver {
  let report: (status: TabStatus) => void = () => {}
  let status: TabStatus = 'waiting'
  let stopped = false
  /** Locks are unusable here: this tab works alone. */
  let alone = false
  /** Ends the hold on the lock this tab has, if any. */
  let release: (() => void) | null = null
  /** A request of this tab already waits in line. */
  let inLine = false
  /** A "Use here" steal was asked for and not answered yet. */
  let stealing = false
  /** The request holding the lock now: an older request failing changes nothing. */
  let holder = 0
  let requests = 0

  const set = (next: TabStatus) => {
    status = next
    report(next)
  }

  function request(options: { ifAvailable?: boolean; steal?: boolean }, first = false) {
    const queued = !options.ifAvailable && !options.steal
    if (queued) {
      if (inLine) return
      inLine = true
    }
    const token = ++requests
    const hold = (lock: unknown): Promise<void> | void => {
      if (queued) inLine = false
      if (options.steal) stealing = false
      if (stopped) return
      if (lock === null) {
        // Another tab has it: wait in line behind it.
        set('elsewhere')
        request({})
        return
      }
      holder = token
      set('active')
      return new Promise<void>((resolve) => {
        release = resolve
      })
    }
    locks.request(LOCK_NAME, options, hold).then(
      () => {},
      (error: unknown) => {
        if (queued) inLine = false
        if (options.steal) stealing = false
        if (stopped) return
        if (!isAbort(error)) {
          console.error('Could not hold the workspace lock', error)
          if (first && status === 'waiting') {
            // Better one tab without the lock than a page that never opens.
            alone = true
            set('active')
          }
          return
        }
        // Only the request that holds the lock losing it means another tab took over.
        if (token !== holder) return
        holder = 0
        release = null
        set('elsewhere')
        request({})
      },
    )
  }

  return {
    start(onChange, options) {
      report = onChange
      stopped = false
      set('waiting')
      if (options?.takeOver) stealing = true
      request(options?.takeOver ? { steal: true } : { ifAvailable: true }, true)
    },
    takeOver() {
      // A second click, or a click once this tab is the one, must not steal from itself.
      if (alone || stealing || status === 'active') return
      stealing = true
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
  | { type: 'take'; id: string }
  /** The active tab stops for `to`, which waits for `released` before it reads the storage. */
  | { type: 'releasing'; id: string; to: string }
  | { type: 'released'; id: string; to: string }

const isTabMessage = (v: unknown): v is TabMessage =>
  typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string'

/** How long a new tab waits for an active tab to answer before it becomes the active one. */
export const ANSWER_MS = 400

/**
 * Without Web Locks: tabs talk over a BroadcastChannel. A new tab says hello; the active tab
 * answers at once, else the new tab becomes active after ANSWER_MS. "Use here" asks the active
 * tab to stop: it answers at once (releasing), stops saving, and says released once its save in
 * flight has settled; only then does the new tab become active and read the storage. If two
 * tabs ever both think they are active, the later one wins.
 */
export function channelDriver(
  channel: ChannelLike,
  options: { id?: string; now?: () => number } = {},
): TabLockDriver {
  const id = options.id ?? Math.random().toString(36).slice(2)
  const now = options.now ?? Date.now
  let report: (status: TabStatus) => void = () => {}
  let settle: () => Promise<void> = () => Promise.resolve()
  let status: TabStatus = 'waiting'
  let since = 0
  let wait: ReturnType<typeof setTimeout> | undefined
  /** "Use here" was asked: waiting for the active tab to let go. */
  let taking = false

  const set = (next: TabStatus) => {
    status = next
    report(next)
  }
  const becomeActive = () => {
    clearTimeout(wait)
    taking = false
    since = now()
    set('active')
    channel.postMessage({ type: 'active', id, since } satisfies TabMessage)
  }
  const take = () => {
    if (taking || status === 'active') return
    taking = true
    set('waiting')
    channel.postMessage({ type: 'take', id } satisfies TabMessage)
    // No active tab answers: there is nothing to wait for.
    wait = setTimeout(becomeActive, ANSWER_MS)
  }

  channel.onmessage = (event) => {
    const message: unknown = event.data
    if (!isTabMessage(message) || message.id === id) return
    switch (message.type) {
      case 'hello':
        if (status === 'active') channel.postMessage({ type: 'active', id, since })
        return
      case 'take':
        if (status === 'active') {
          channel.postMessage({ type: 'releasing', id, to: message.id } satisfies TabMessage)
          set('elsewhere')
          void settle().then(() =>
            channel.postMessage({ type: 'released', id, to: message.id } satisfies TabMessage),
          )
        } else if (status === 'waiting' && !taking) {
          clearTimeout(wait)
          set('elsewhere')
        }
        return
      case 'releasing':
        // The active tab is finishing its save: wait for it, however long that takes.
        if (message.to === id && taking) clearTimeout(wait)
        return
      case 'released':
        if (message.to === id && taking) becomeActive()
        return
      case 'active':
        if (status === 'waiting' && !taking) {
          clearTimeout(wait)
          set('elsewhere')
        } else if (status === 'active') {
          const theyAreLater = message.since > since || (message.since === since && message.id > id)
          if (theyAreLater) set('elsewhere')
          else channel.postMessage({ type: 'active', id, since })
        }
        return
    }
  }

  return {
    start(onChange, startOptions) {
      report = onChange
      if (startOptions?.settle) settle = startOptions.settle
      if (startOptions?.takeOver) {
        take()
        return
      }
      set('waiting')
      channel.postMessage({ type: 'hello', id } satisfies TabMessage)
      wait = setTimeout(() => {
        if (status === 'waiting' && !taking) becomeActive()
      }, ANSWER_MS)
    },
    takeOver: take,
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
  const locks = browserLocks()
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
/** How "Use here" takes over in a tab whose memory may be stale (see startTabLock). */
let takeOverStale: (() => boolean) | null = null
let hadBeenActive = false

export const useTabLock = create<TabLockState>((_set, get) => ({
  status: 'waiting',
  takeOver() {
    if (get().status === 'active') return
    if (hadBeenActive && takeOverStale?.()) return
    driver?.takeOver()
  },
}))

/**
 * Starts finding out whether this tab is the active one; returns a function that stops.
 * `onLost` runs at once when another tab takes over (stop saving). `onRegained` runs when this
 * tab becomes active again after it had been (what it holds in memory may be stale: reload).
 * `takeOverOnStart` makes this tab active at once (it reloaded for "Use here"). In a tab that
 * had been active, "Use here" calls `reloadToTakeOver` instead of taking over in place, so the
 * other tab keeps the lock until this one has reloaded (no other tab can grab it in between);
 * when that returns false (it could not), the tab takes over in place, then `onRegained` runs.
 * `settle` resolves once this tab's storage work in flight has finished.
 */
export function startTabLock(
  handlers: {
    onLost?: () => void
    onRegained?: () => void
    takeOverOnStart?: boolean
    reloadToTakeOver?: () => boolean
    settle?: () => Promise<void>
  } = {},
): () => void {
  const current = makeDriver()
  driver = current
  takeOverStale = handlers.reloadToTakeOver ?? null
  hadBeenActive = false
  useTabLock.setState({ status: 'waiting' })
  current.start(
    (status) => {
      const previous = useTabLock.getState().status
      useTabLock.setState({ status })
      if (status === 'active') {
        if (hadBeenActive && previous !== 'active') handlers.onRegained?.()
        hadBeenActive = true
      } else if (previous === 'active') {
        handlers.onLost?.()
      }
    },
    {
      takeOver: handlers.takeOverOnStart ?? false,
      ...(handlers.settle ? { settle: handlers.settle } : {}),
    },
  )
  return () => {
    current.stop()
    if (driver === current) driver = null
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANSWER_MS,
  channelDriver,
  setTabLockDriver,
  soloDriver,
  startTabLock,
  useTabLock,
  webLockDriver,
  type ChannelLike,
  type LockManagerLike,
  type TabStatus,
} from './tabLock.ts'

interface Request {
  callback: (lock: unknown) => Promise<void> | void
  resolve: () => void
  reject: (error: unknown) => void
}

/** A Web Locks manager for one exclusive lock name, shared by the fake tabs. */
function fakeLocks(): LockManagerLike {
  let holder: Request | null = null
  const queue: Request[] = []

  function grant(request: Request) {
    holder = request
    Promise.resolve(request.callback({ name: 'shape-workspace' })).then(
      () => {
        if (holder === request) {
          holder = null
          request.resolve()
          next()
        }
      },
      (error: unknown) => request.reject(error),
    )
  }
  function next() {
    const waiting = queue.shift()
    if (waiting) grant(waiting)
  }

  return {
    request(_name, options, callback) {
      return new Promise((resolve, reject) => {
        const request: Request = { callback, resolve: () => resolve(undefined), reject }
        if (options.steal) {
          const stolen = holder
          holder = null
          stolen?.reject(new DOMException('The lock was stolen', 'AbortError'))
          grant(request)
        } else if (holder === null && queue.length === 0) {
          grant(request)
        } else if (options.ifAvailable) {
          Promise.resolve(callback(null)).then(() => resolve(undefined), reject)
        } else {
          queue.push(request)
        }
      })
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function tab(driver: ReturnType<typeof webLockDriver>) {
  const seen: TabStatus[] = []
  driver.start((status) => seen.push(status))
  return { driver, seen, now: () => seen.at(-1) }
}

describe('webLockDriver (R38)', () => {
  it('makes the first tab active and the second one wait elsewhere', async () => {
    const locks = fakeLocks()
    const a = tab(webLockDriver(locks))
    await settle()
    const b = tab(webLockDriver(locks))
    await settle()
    expect(a.now()).toBe('active')
    expect(b.now()).toBe('elsewhere')
  })

  it('"Use here" takes over, and the old tab learns at once', async () => {
    const locks = fakeLocks()
    const a = tab(webLockDriver(locks))
    await settle()
    const b = tab(webLockDriver(locks))
    await settle()
    b.driver.takeOver()
    await settle()
    expect(b.now()).toBe('active')
    expect(a.now()).toBe('elsewhere')
    // And back again.
    a.driver.takeOver()
    await settle()
    expect(a.now()).toBe('active')
    expect(b.now()).toBe('elsewhere')
  })

  it('a waiting tab becomes active once the active one closes', async () => {
    const locks = fakeLocks()
    const a = tab(webLockDriver(locks))
    await settle()
    const b = tab(webLockDriver(locks))
    await settle()
    a.driver.stop()
    await settle()
    expect(b.now()).toBe('active')
  })
})

/** BroadcastChannels between fake tabs: a message reaches every other channel. */
function fakeChannels() {
  const all: ChannelLike[] = []
  return () => {
    const channel: ChannelLike = {
      onmessage: null,
      postMessage(message) {
        for (const other of all) {
          if (other !== channel)
            queueMicrotask(() => other.onmessage?.(new MessageEvent('message', { data: message })))
        }
      },
      close() {
        all.splice(all.indexOf(channel), 1)
      },
    }
    all.push(channel)
    return channel
  }
}

describe('channelDriver (no Web Locks)', () => {
  afterEach(() => vi.useRealTimers())

  it('becomes active when nobody answers, and the next tab waits elsewhere', async () => {
    vi.useFakeTimers()
    const channel = fakeChannels()
    let time = 1
    const now = () => time++
    const a = tab(channelDriver(channel(), { id: 'a', now }))
    expect(a.now()).toBe('waiting')
    await vi.advanceTimersByTimeAsync(ANSWER_MS)
    expect(a.now()).toBe('active')
    const b = tab(channelDriver(channel(), { id: 'b', now }))
    await vi.advanceTimersByTimeAsync(ANSWER_MS)
    expect(b.now()).toBe('elsewhere')
    expect(a.now()).toBe('active')

    b.driver.takeOver()
    await vi.advanceTimersByTimeAsync(0)
    expect(b.now()).toBe('active')
    expect(a.now()).toBe('elsewhere')
  })
})

describe('startTabLock', () => {
  afterEach(() => setTabLockDriver(soloDriver))

  it('stops saving at once when another tab takes over, and reloads when it comes back', async () => {
    const locks = fakeLocks()
    const other = tab(webLockDriver(locks))
    await settle()
    setTabLockDriver(() => webLockDriver(locks))
    const onLost = vi.fn()
    const onRegained = vi.fn()
    const stop = startTabLock({ onLost, onRegained })
    await settle()
    expect(useTabLock.getState().status).toBe('elsewhere')
    // Never active here before: becoming active needs no reload.
    useTabLock.getState().takeOver()
    await settle()
    expect(useTabLock.getState().status).toBe('active')
    expect(onRegained).not.toHaveBeenCalled()
    expect(other.now()).toBe('elsewhere')

    other.driver.takeOver()
    await settle()
    expect(useTabLock.getState().status).toBe('elsewhere')
    expect(onLost).toHaveBeenCalledTimes(1)

    useTabLock.getState().takeOver()
    await settle()
    expect(useTabLock.getState().status).toBe('active')
    expect(onRegained).toHaveBeenCalledTimes(1)
    stop()
  })
})

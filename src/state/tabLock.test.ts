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
import { fakeLocks } from '../test/fakeLocks.ts'

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

describe('webLockDriver edge cases', () => {
  it('works alone when the lock cannot be had at all, instead of never opening', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: LockManagerLike = {
      request: () => Promise.reject(new DOMException('Access denied', 'SecurityError')),
    }
    const a = tab(webLockDriver(broken))
    await settle()
    expect(a.now()).toBe('active')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('a double "Use here" never leaves the new holder showing the notice', async () => {
    const locks = fakeLocks()
    const a = tab(webLockDriver(locks))
    await settle()
    const request = vi.spyOn(locks, 'request')
    const b = tab(webLockDriver(locks))
    await settle()
    b.driver.takeOver()
    b.driver.takeOver()
    await settle()
    await settle()
    expect(b.now()).toBe('active')
    expect(a.now()).toBe('elsewhere')
    expect(b.seen.slice(b.seen.indexOf('active'))).toEqual(['active'])
    // Once active, "Use here" asks for nothing more.
    const asked = request.mock.calls.length
    b.driver.takeOver()
    expect(request.mock.calls.length).toBe(asked)
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

describe('channelDriver take over', () => {
  afterEach(() => vi.useRealTimers())

  it('waits for the old tab to finish its save before becoming active', async () => {
    vi.useFakeTimers()
    const channel = fakeChannels()
    let finish: () => void = () => {}
    const saving = new Promise<void>((resolve) => {
      finish = resolve
    })
    const old = channelDriver(channel(), { id: 'a' })
    const seenOld: TabStatus[] = []
    old.start((s) => seenOld.push(s), { settle: () => saving })
    await vi.advanceTimersByTimeAsync(ANSWER_MS)
    const b = tab(channelDriver(channel(), { id: 'b' }))
    await vi.advanceTimersByTimeAsync(ANSWER_MS)
    expect(b.now()).toBe('elsewhere')
    b.driver.takeOver()
    await vi.advanceTimersByTimeAsync(ANSWER_MS * 10)
    expect(seenOld.at(-1)).toBe('elsewhere')
    expect(b.now()).toBe('waiting')
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(b.now()).toBe('active')
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

  it('a tab that had been active reloads to take over, and the reloaded page takes over', async () => {
    const locks = fakeLocks()
    setTabLockDriver(() => webLockDriver(locks))
    const reloadToTakeOver = vi.fn(() => true)
    const stop = startTabLock({ reloadToTakeOver })
    await settle()
    expect(useTabLock.getState().status).toBe('active')
    const other = tab(webLockDriver(locks))
    other.driver.takeOver()
    await settle()
    expect(useTabLock.getState().status).toBe('elsewhere')
    useTabLock.getState().takeOver()
    await settle()
    // The other tab keeps the lock until this page has reloaded.
    expect(reloadToTakeOver).toHaveBeenCalledTimes(1)
    expect(other.now()).toBe('active')
    stop()
    // The reloaded page.
    const again = startTabLock({ takeOverOnStart: true })
    await settle()
    expect(useTabLock.getState().status).toBe('active')
    expect(other.now()).toBe('elsewhere')
    again()
  })
})

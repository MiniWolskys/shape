import type { LockManagerLike } from '../state/tabLock.ts'

interface Request {
  callback: (lock: unknown) => unknown
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/**
 * A Web Locks manager with exclusive locks per name, shared by fake tabs: ifAvailable, steal
 * (the holder's request rejects with an AbortError) and a queue, as in browsers.
 */
export function fakeLocks(): LockManagerLike {
  const holders = new Map<string, Request>()
  const queues = new Map<string, Request[]>()
  const queueOf = (name: string) => {
    let queue = queues.get(name)
    if (!queue) queues.set(name, (queue = []))
    return queue
  }

  function grant(name: string, request: Request) {
    holders.set(name, request)
    Promise.resolve()
      .then(() => request.callback({ name }))
      .then(
        (value) => {
          if (holders.get(name) !== request) return
          holders.delete(name)
          request.resolve(value)
          next(name)
        },
        (error: unknown) => {
          if (holders.get(name) === request) {
            holders.delete(name)
            next(name)
          }
          request.reject(error)
        },
      )
  }
  function next(name: string) {
    const waiting = queueOf(name).shift()
    if (waiting) grant(name, waiting)
  }

  return {
    request(name, options, callback) {
      return new Promise((resolve, reject) => {
        const request: Request = { callback, resolve, reject }
        if (options.steal) {
          const stolen = holders.get(name)
          holders.delete(name)
          stolen?.reject(new DOMException('The lock was stolen', 'AbortError'))
          grant(name, request)
        } else if (!holders.has(name) && queueOf(name).length === 0) {
          grant(name, request)
        } else if (options.ifAvailable) {
          Promise.resolve()
            .then(() => callback(null))
            .then(resolve, reject)
        } else {
          queueOf(name).push(request)
        }
      })
    },
  }
}

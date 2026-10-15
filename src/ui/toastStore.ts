import { create } from 'zustand'

export type ToastKind = 'info' | 'error'

/** A button on the toast (e.g. Undo); clicking it runs `run` and closes the toast. */
export interface ToastAction {
  label: string
  run(): void
}

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
  action?: ToastAction
}

const LIFETIME_MS: Record<ToastKind, number> = { info: 4000, error: 8000 }
/** A toast with an action stays long enough to reach its button. */
const ACTION_LIFETIME_MS = 8000

let nextId = 1

interface Timer {
  /** Milliseconds left to show the toast. */
  remaining: number
  /** When the running countdown started (it is running when `handle` is set). */
  started: number
  handle?: ReturnType<typeof setTimeout>
}

const timers = new Map<number, Timer>()
/** Why the countdowns wait: the pointer is over the toasts, or focus is in them. */
const holds = new Set<'hover' | 'focus'>()

function run(id: number, timer: Timer) {
  timer.started = Date.now()
  timer.handle = setTimeout(() => useToasts.getState().dismiss(id), timer.remaining)
}

export const useToasts = create<{
  toasts: ToastItem[]
  dismiss(id: number): void
}>((set) => ({
  toasts: [],
  dismiss(id) {
    clearTimeout(timers.get(id)?.handle)
    timers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

/**
 * Stops or restarts every toast's countdown: toasts wait while the player hovers them or has
 * focus in them, so an action (Undo) never vanishes on the way to it (WCAG 2.2.1).
 */
export function holdToasts(reason: 'hover' | 'focus', held: boolean): void {
  const wasHeld = holds.size > 0
  if (held) holds.add(reason)
  else holds.delete(reason)
  const isHeld = holds.size > 0
  if (isHeld === wasHeld) return
  for (const [id, timer] of timers) {
    if (isHeld) {
      clearTimeout(timer.handle)
      timer.handle = undefined
      timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.started))
    } else {
      run(id, timer)
    }
  }
}

/**
 * Shows a short message; info toasts last 4 s, errors and toasts with an action 8 s, not
 * counting the time the player hovers or focuses them.
 */
export function toast(message: string, kind: ToastKind = 'info', action?: ToastAction): void {
  const id = nextId++
  const item: ToastItem = action ? { id, message, kind, action } : { id, message, kind }
  useToasts.setState((s) => ({ toasts: [...s.toasts, item] }))
  const timer: Timer = {
    remaining: action ? ACTION_LIFETIME_MS : LIFETIME_MS[kind],
    started: Date.now(),
  }
  timers.set(id, timer)
  if (holds.size === 0) run(id, timer)
}

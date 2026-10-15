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

export const useToasts = create<{
  toasts: ToastItem[]
  dismiss(id: number): void
}>((set) => ({
  toasts: [],
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },
}))

/** Shows a short message; info toasts last 4 s, errors and toasts with an action 8 s. */
export function toast(message: string, kind: ToastKind = 'info', action?: ToastAction): void {
  const id = nextId++
  const item: ToastItem = action ? { id, message, kind, action } : { id, message, kind }
  useToasts.setState((s) => ({ toasts: [...s.toasts, item] }))
  setTimeout(
    () => useToasts.getState().dismiss(id),
    action ? ACTION_LIFETIME_MS : LIFETIME_MS[kind],
  )
}

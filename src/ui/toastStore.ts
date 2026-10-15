import { create } from 'zustand'

export type ToastKind = 'info' | 'error'

export interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

const LIFETIME_MS: Record<ToastKind, number> = { info: 4000, error: 8000 }

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

/** Shows a short message; info toasts last 4 s, errors 8 s. */
export function toast(message: string, kind: ToastKind = 'info'): void {
  const id = nextId++
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, message, kind }] }))
  setTimeout(() => useToasts.getState().dismiss(id), LIFETIME_MS[kind])
}

import { create } from 'zustand'

export type Screen =
  | { name: 'home' }
  | { name: 'library' }
  /** `paintingId: null` is a new painting, not in the workspace until its first change (R18). */
  | { name: 'editor'; paintingId: string | null }
  | { name: 'export' }

interface NavigationState {
  screen: Screen
  go(screen: Screen): void
}

export const useNavigation = create<NavigationState>()((set) => ({
  screen: { name: 'home' },
  go: (screen) => set({ screen }),
}))

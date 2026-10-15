import { create } from 'zustand'

export type Screen =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'editor'; paintingId: string }
  | { name: 'export' }

interface NavigationState {
  screen: Screen
  go(screen: Screen): void
}

export const useNavigation = create<NavigationState>()((set) => ({
  screen: { name: 'home' },
  go: (screen) => set({ screen }),
}))

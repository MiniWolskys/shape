import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import { useLanguage } from './i18n/i18n.ts'
import { useNavigation } from './state/navigation.ts'
import { useWorkspace } from './state/workspace.ts'
import { memoryStorage } from './storage/persistence.ts'

const realInit = useWorkspace.getState().init

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    useLanguage.setState({ language: 'en' })
    useNavigation.setState({ screen: { name: 'home' } })
    useWorkspace.setState({ ready: false, library: null, loose: [], assets: {} })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useWorkspace.setState({ init: realInit })
  })

  it('shows a loading state, then the home screen once the workspace is ready', async () => {
    let finish: () => void = () => {}
    const init = () =>
      new Promise<void>((resolve) => {
        finish = () => {
          useWorkspace.setState({ ready: true })
          resolve()
        }
      })
    useWorkspace.setState({ init })
    render(<App />)
    expect(screen.getByText('Opening your workspace…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create a painting' })).not.toBeInTheDocument()
    finish()
    expect(await screen.findByRole('button', { name: 'Create a painting' })).toBeInTheDocument()
    expect(screen.getByText('Shape', { selector: 'header *' })).toBeInTheDocument()
  })

  it('explains when browser storage cannot be opened and lets the player go on', async () => {
    useWorkspace.setState({ init: () => Promise.reject(new Error('no IndexedDB')) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: "Your browser storage couldn't be opened" }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue without saving' }))
    expect(useWorkspace.getState().ready).toBe(true)
    expect(screen.getByRole('button', { name: 'Create a painting' })).toBeInTheDocument()
  })

  it('routes to the export screen, which sends players without a library home', async () => {
    await useWorkspace.getState().init(memoryStorage())
    useNavigation.setState({ screen: { name: 'export' } })
    render(<App />)
    expect(await screen.findByText(/Exporting needs a library/)).toBeInTheDocument()
    expect(useNavigation.getState().screen).toEqual({ name: 'home' })
    expect(screen.getByRole('button', { name: 'Create a painting' })).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { App } from './App.tsx'

describe('App', () => {
  it('shows the app name', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Shape' })).toBeInTheDocument()
  })
})

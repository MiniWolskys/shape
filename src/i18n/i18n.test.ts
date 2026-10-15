import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FRAME_MATERIAL_IDS, MC_COLORS, SHAPE_IDS } from '../domain/types.ts'
import { en } from './en.ts'
import { fr } from './fr.ts'
import { detectLanguage, format, plural, useLanguage, useT } from './i18n.ts'

function leaves(node: unknown, path = ''): [string, unknown][] {
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
  }
  return [[path, node]]
}

function valueAt(node: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], node)
}

describe('detectLanguage', () => {
  it('picks French when the first matching language is fr', () => {
    expect(detectLanguage(['fr-FR', 'en'])).toBe('fr')
  })
  it('falls back to English', () => {
    expect(detectLanguage(['de', 'en-GB'])).toBe('en')
    expect(detectLanguage([])).toBe('en')
  })
})

describe('format', () => {
  it('replaces placeholders', () => {
    expect(format('{n} new', { n: 3 })).toBe('3 new')
  })
  it('leaves unknown placeholders as is', () => {
    expect(format('{a} and {b}', { a: 'x' })).toBe('x and {b}')
  })
})

describe('dictionaries', () => {
  it('has a non-empty French string for every English leaf', () => {
    for (const [path, value] of leaves(en)) {
      expect(value, path).toBeTypeOf('string')
      const french = valueAt(fr, path)
      expect(french, path).toBeTypeOf('string')
      // headlineBefore is intentionally empty in both languages
      if (path !== 'home.headlineBefore') expect((french as string).length, path).toBeGreaterThan(0)
    }
    const paths = (d: unknown) =>
      leaves(d)
        .map(([p]) => p)
        .sort()
    expect(paths(fr)).toEqual(paths(en))
  })
  it('keeps the same placeholders in both languages', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const [path, value] of leaves(en)) {
      expect(names(valueAt(fr, path) as string), path).toEqual(names(value as string))
    }
  })
  it('covers every shape, frame material and color', () => {
    for (const dict of [en, fr]) {
      expect(Object.keys(dict.shapes).sort()).toEqual([...SHAPE_IDS].sort())
      expect(Object.keys(dict.materials).sort()).toEqual([...FRAME_MATERIAL_IDS].sort())
      expect(Object.keys(dict.mcColors).sort()).toEqual([...MC_COLORS].sort())
    }
  })
  it('uses non-breaking spaces before : ; ! ? and % in French', () => {
    for (const [path, value] of leaves(fr)) {
      expect(value as string, path).not.toMatch(/ [:;!?%]/)
    }
  })
})

describe('useLanguage / useT', () => {
  afterEach(() => {
    localStorage.clear()
    act(() => useLanguage.getState().setLanguage('en'))
  })

  it('switches dictionary, persists and sets the document language', () => {
    const { result } = renderHook(() => useT())
    expect(result.current.app.tagline).toBe('Minecraft paintings')
    act(() => useLanguage.getState().setLanguage('fr'))
    expect(result.current.app.tagline).toBe('tableaux Minecraft')
    expect(localStorage.getItem('shape:lang')).toBe('fr')
    expect(document.documentElement.lang).toBe('fr')
  })
})

describe('plural', () => {
  const forms = { one: '{count} tableau de {name}', other: '{count} tableaux de {name}' }
  it('uses the singular for 0 and 1 in French', () => {
    expect(plural(fr, forms, 0, { name: 'Zoé' })).toBe('0 tableau de Zoé')
    expect(plural(fr, forms, 1, { name: 'Zoé' })).toBe('1 tableau de Zoé')
    expect(plural(fr, forms, 2, { name: 'Zoé' })).toBe('2 tableaux de Zoé')
  })
  it('uses the singular only for 1 in English', () => {
    const english = { one: '{count} painting', other: '{count} paintings' }
    expect(plural(en, english, 0)).toBe('0 paintings')
    expect(plural(en, english, 1)).toBe('1 painting')
    expect(plural(en, english, 12)).toBe('12 paintings')
  })
})

import { create } from 'zustand'
import type { Dictionary } from './en.ts'
import { en } from './en.ts'
import { fr } from './fr.ts'

export type Language = 'en' | 'fr'

const STORAGE_KEY = 'shape:lang'

const dictionaries: Record<Language, Dictionary> = { en, fr }

/** First `fr*` browser language wins; anything else is English. */
export function detectLanguage(navigatorLanguages: readonly string[]): Language {
  for (const tag of navigatorLanguages) {
    const primary = tag.toLowerCase().split('-')[0]
    if (primary === 'fr') return 'fr'
    if (primary === 'en') return 'en'
  }
  return 'en'
}

function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'fr'
}

function detectFromNavigator(): Language {
  return detectLanguage(typeof navigator === 'undefined' ? [] : (navigator.languages ?? []))
}

function readInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch (error) {
    console.warn('Could not read the saved language', error)
  }
  return detectFromNavigator()
}

function applyDocumentLanguage(language: Language): void {
  if (typeof document !== 'undefined') document.documentElement.lang = language
}

const initial = readInitialLanguage()
applyDocumentLanguage(initial)

export const useLanguage = create<{ language: Language; setLanguage(l: Language): void }>(
  (set) => ({
    language: initial,
    setLanguage(language) {
      try {
        localStorage.setItem(STORAGE_KEY, language)
      } catch (error) {
        console.warn('Could not save the language', error)
      }
      applyDocumentLanguage(language)
      set({ language })
    },
  }),
)

/** The active dictionary; components re-render when the language changes. */
export function useT(): Dictionary {
  return dictionaries[useLanguage((s) => s.language)]
}

/** Replaces `{name}` placeholders; unknown placeholders are left as is. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  )
}

/** A message in the singular and the plural; `{count}` stands for the number. */
export interface PluralForms {
  one: string
  other: string
}

/**
 * The form of `forms` the dictionary's language uses for `count`, with placeholders filled in.
 * French takes the singular for 0 and 1, English only for 1.
 */
export function plural(
  t: Dictionary,
  forms: PluralForms,
  count: number,
  values: Record<string, string | number> = {},
): string {
  const form = new Intl.PluralRules(t.locale).select(count) === 'one' ? forms.one : forms.other
  return format(form, { ...values, count })
}

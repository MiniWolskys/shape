import type { Random } from './types.ts'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

const randomChars = (n: number, random: Random) =>
  Array.from(
    { length: n },
    () => ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length],
  ).join('')

const baseSlug = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

export function slugify(text: string): string {
  return baseSlug(text).slice(0, 24).replace(/_+$/, '') || 'painting'
}

export function makePaintingId(title: string, random: Random): string {
  return `${slugify(title)}_${randomChars(3, random)}`
}

export function makeAssetId(random: Random): string {
  return randomChars(12, random)
}

export function isValidNamespace(ns: string): boolean {
  return /^[a-z0-9_.-]{1,64}$/.test(ns) && ns !== 'minecraft'
}

export function namespaceFromName(name: string): string {
  return baseSlug(name) || 'paintings'
}

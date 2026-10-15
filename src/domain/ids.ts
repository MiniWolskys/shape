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

/** A namespace never starts with `.` or `-`, so `.`, `..` and hidden names can't become paths. */
export function isValidNamespace(ns: string): boolean {
  return /^[a-z0-9_][a-z0-9_.-]{0,63}$/.test(ns) && ns !== 'minecraft'
}

/** Names that are properties of every object: never usable as keys of an assets record. */
const OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Asset ids become zip paths and object keys, so only plain file-name characters are accepted
 * (R6), and never a name every object already has.
 */
export function isValidAssetId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id) && !OBJECT_KEYS.has(id)
}

export function namespaceFromName(name: string): string {
  return baseSlug(name) || 'paintings'
}

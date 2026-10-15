/** Every Minecraft pack number lives here, so a game update is a one-line change. */
export const MC_VERSION = '26.3'
export const PACK_FORMATS = {
  data: { min_format: 121, max_format: 121 },
  resources: { min_format: 97, max_format: [97, 1] },
} as const

/** Pack JSON files: two-space indent and a trailing newline, as in the reference packs. */
export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n')
}

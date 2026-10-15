export type ShapeErrorCode =
  | 'not-an-image'
  | 'not-a-library-pack'
  | 'newer-format'
  | 'namespace-mismatch'
  | 'storage-full'
  | 'export-failed'
  | 'published-locked'

export class ShapeError extends Error {
  readonly code: ShapeErrorCode
  /** The title (or id, when untitled) of the painting the error is about, if any. */
  readonly painting?: string

  constructor(code: ShapeErrorCode, message?: string, painting?: string) {
    super(message)
    this.name = 'ShapeError'
    this.code = code
    if (painting !== undefined) this.painting = painting
  }
}

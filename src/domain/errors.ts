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

  constructor(code: ShapeErrorCode, message?: string) {
    super(message)
    this.name = 'ShapeError'
    this.code = code
  }
}

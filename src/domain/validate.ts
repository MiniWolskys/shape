import { exportSet, isChanged } from './library.ts'
import type { Assets, Library } from './types.ts'

export type IssueCode =
  'no-image' | 'edits-missing' | 'duplicate-id' | 'no-title' | 'no-author' | 'nothing-new'
export interface Issue {
  code: IssueCode
  paintingId?: string
  blocking: boolean
}

export function validateForExport(lib: Library, ids: string[], assets: Assets): Issue[] {
  const issues: Issue[] = []
  const seen = new Set<string>()
  const reported = new Set<string>()
  for (const p of exportSet(lib, ids)) {
    if (seen.has(p.id)) {
      if (!reported.has(p.id)) {
        reported.add(p.id)
        issues.push({ code: 'duplicate-id', paintingId: p.id, blocking: true })
      }
      continue
    }
    seen.add(p.id)
    const source = p.recipe.source
    if (!source || !Object.hasOwn(assets, source.imageId)) {
      issues.push({ code: 'no-image', paintingId: p.id, blocking: true })
    }
    // The texture would be built without them: say so instead of dropping them silently.
    const edits = p.recipe.editsId
    if (
      edits !== null &&
      !(Object.hasOwn(assets, edits) && Object.hasOwn(assets, `${edits}.mask`))
    ) {
      issues.push({ code: 'edits-missing', paintingId: p.id, blocking: false })
    }
    if (p.title.trim() === '') issues.push({ code: 'no-title', paintingId: p.id, blocking: false })
    if (p.author.trim() === '') {
      issues.push({ code: 'no-author', paintingId: p.id, blocking: false })
    }
  }
  // Changed published paintings make a new version worth exporting even with nothing selected.
  if (ids.length === 0 && !lib.paintings.some((p) => isChanged(p, lib))) {
    issues.push({ code: 'nothing-new', blocking: false })
  }
  return issues
}

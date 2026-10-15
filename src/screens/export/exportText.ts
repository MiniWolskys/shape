import { whatsNew } from '../../domain/library.ts'
import type { Library, Painting } from '../../domain/types.ts'
import type { Issue } from '../../domain/validate.ts'
import type { Dictionary } from '../../i18n/en.ts'
import { format, plural } from '../../i18n/i18n.ts'

/** The painting's title, or "Untitled". */
export function titleOf(p: Painting | undefined, t: Dictionary): string {
  return p && p.title.trim() !== '' ? p.title : t.library.untitled
}

/** "Sam · 2×3", or "2×3" without an author (M8). */
export function pickMeta(p: Painting, t: Dictionary): string {
  const size = { width: p.width, height: p.height }
  return p.author.trim() === ''
    ? format(t.library.cardSize, size)
    : format(t.library.cardMeta, { author: p.author, ...size })
}

/** "Sunset Chapel by Sam", or the title alone without an author. */
export function newsLine(p: Painting, t: Dictionary): string {
  const title = titleOf(p, t)
  return p.author.trim() === '' ? title : format(t.export.whatsNewItem, { title, author: p.author })
}

/** `**Library vN**` then one `- title by author` line per painting new in that version. */
export function discordText(lib: Library, version: number, t: Dictionary): string {
  const lines = whatsNew(lib, version).map((p) => `- ${newsLine(p, t)}`)
  if (lines.length === 0) lines.push(`- ${t.export.nothingNew}`)
  return [`**${lib.name} v${version}**`, ...lines].join('\n')
}

/** "2 paintings (1 published)" (M8). */
export function libraryDetail(lib: Library, t: Dictionary): string {
  const count = plural(t, t.export.insideLibraryDetail, lib.paintings.length)
  const published = lib.paintings.filter((p) => p.status === 'published').length
  return published === 0 ? count : `${count} (${plural(t, t.export.insidePublished, published)})`
}

/** A check's message, naming the painting it is about. */
export function issueMessage(issue: Issue, lib: Library, t: Dictionary): string {
  const painting = lib.paintings.find((p) => p.id === issue.paintingId)
  const values = { title: titleOf(painting, t), id: issue.paintingId ?? '' }
  switch (issue.code) {
    case 'no-image':
      return format(t.export.issue.noImage, values)
    case 'duplicate-id':
      return format(t.export.issue.duplicateId, values)
    case 'no-title':
      return format(t.export.issue.noTitle, values)
    case 'no-author':
      return format(t.export.issue.noAuthor, values)
    case 'nothing-new':
      return format(t.export.issue.nothingNew, { version: lib.version })
  }
}

import type { Dictionary } from '../i18n/en.ts'
import { currentDictionary, plural } from '../i18n/i18n.ts'
import { readLibraryPack } from '../packs/libraryPack.ts'
import { useWorkspace, type ImportResult, type ReadPack } from '../state/workspace.ts'
import { errorMessage } from '../ui/errors.ts'
import { toast } from '../ui/toastStore.ts'
import { askImport } from './importConfirm.ts'

/** What an import did, in the player's words (M9). */
export function importMessage(result: ImportResult, t: Dictionary): string {
  const { kind, added, kept, sourceName } = result
  switch (kind) {
    case 'opened':
      return plural(t, t.packImport.opened, added, { name: sourceName })
    case 'copied':
      return plural(t, t.packImport.copied, added, { name: sourceName })
    case 'merged':
      if (added > 0) return plural(t, t.packImport.added, added)
      return kept > 0 ? plural(t, t.packImport.nothingNew, kept) : t.packImport.empty
  }
}

/**
 * Asks what importing `pack` needs asking (R21, R25); false when the player said no.
 * Another library's paintings join the open one as copies, and a demo the player changed would
 * be replaced. Same-library merges and opening with no library ask nothing.
 */
async function confirmImport(pack: ReadPack): Promise<boolean> {
  const workspace = useWorkspace.getState()
  const { library, demo } = workspace
  if (!library) return true
  if (demo) return workspace.unexportedCount() === 0 || askImport({ kind: 'replaceDemo' })
  if (pack.library.namespace === library.namespace) return true
  return askImport({
    kind: 'copy',
    count: pack.library.paintings.length,
    source: pack.library.name,
    library: library.name,
  })
}

/**
 * Opens or imports a library pack file (R21) and says how it went in a toast; true once the
 * pack is in the workspace. Shared by the buttons and by drops anywhere in the app.
 */
export async function importPackFile(file: File): Promise<boolean> {
  try {
    // Read once: the question and the import share it.
    const pack = readLibraryPack(new Uint8Array(await file.arrayBuffer()))
    if (!(await confirmImport(pack))) return false
    const result = useWorkspace.getState().importPack(pack)
    toast(importMessage(result, currentDictionary()))
    return true
  } catch (error) {
    const namespace = useWorkspace.getState().library?.namespace ?? ''
    toast(errorMessage(error, currentDictionary(), { namespace }), 'error')
    return false
  }
}

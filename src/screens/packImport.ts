import { currentDictionary, plural } from '../i18n/i18n.ts'
import { useWorkspace } from '../state/workspace.ts'
import { errorMessage } from '../ui/errors.ts'
import { toast } from '../ui/toastStore.ts'

/**
 * Opens or imports a library pack file (R21) and says how it went in a toast; true once the
 * pack is in the workspace. Shared by the buttons and by drops anywhere in the app.
 */
export async function importPackFile(file: File): Promise<boolean> {
  const t = currentDictionary()
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const { added } = useWorkspace.getState().importPack(bytes)
    toast(plural(t, t.home.packAdded, added))
    return true
  } catch (error) {
    const namespace = useWorkspace.getState().library?.namespace ?? ''
    toast(errorMessage(error, t, { namespace }), 'error')
    return false
  }
}

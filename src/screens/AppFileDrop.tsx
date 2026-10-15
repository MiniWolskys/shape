import { useT } from '../i18n/i18n.ts'
import { useNavigation } from '../state/navigation.ts'
import { useWorkspace } from '../state/workspace.ts'
import { WindowFileDrop } from '../ui/FileDrop.tsx'
import { predictRoute, receiveFiles, routeLabel } from './appDrop.ts'
import { ImportConfirmDialog } from './ImportConfirmDialog.tsx'

/**
 * Files dropped or pasted anywhere in the app, routed by screen and type (C4), and the questions
 * a pack import asks (R21).
 */
export function AppFileDrop() {
  const t = useT()
  const screen = useNavigation((s) => s.screen)
  return (
    <>
      <ImportConfirmDialog />
      <WindowFileDrop
        label={(types) => routeLabel(predictRoute(screen, types), t)}
        blockedLabel={t.drop.closeDialog}
        onFiles={(files) => {
          // Before the workspace is open there is nothing to put a file in (the drop is still
          // kept from the browser).
          if (useWorkspace.getState().ready) void receiveFiles(files)
        }}
      />
    </>
  )
}

import { useState, useCallback } from 'react'
import { type MovementHeader, createDefaultHeader } from '../../components/workspace/types'
import type { WorkspaceCommand } from './commands'

export function useHeaderState(initial: MovementHeader = createDefaultHeader()) {
  const [header, setHeaderState] = useState<MovementHeader>(initial)

  const dispatchHeaderCommand = useCallback((cmd: WorkspaceCommand) => {
    if (cmd.type === 'UPDATE_HEADER') {
      setHeaderState(prev => ({ ...prev, [cmd.field]: cmd.value }))
    } else if (cmd.type === 'REPLACE_HEADER') {
      setHeaderState(cmd.payload)
    }
  }, [])

  return { header, dispatchHeaderCommand }
}

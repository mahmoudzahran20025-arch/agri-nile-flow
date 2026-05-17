import { useState, useCallback } from 'react'
import { type MovementDimensions, createDefaultDimensions } from '../../components/workspace/types'
import type { WorkspaceCommand } from './commands'

export function useDimensionState(initial: MovementDimensions = createDefaultDimensions()) {
  const [dimensions, setDimensionsState] = useState<MovementDimensions>(initial)

  const dispatchDimensionsCommand = useCallback((cmd: WorkspaceCommand) => {
    if (cmd.type === 'UPDATE_DIMENSIONS') {
      setDimensionsState(prev => ({ ...prev, [cmd.field]: cmd.value }))
    } else if (cmd.type === 'REPLACE_DIMENSIONS') {
      setDimensionsState(cmd.payload)
    }
  }, [])

  return { dimensions, dispatchDimensionsCommand }
}

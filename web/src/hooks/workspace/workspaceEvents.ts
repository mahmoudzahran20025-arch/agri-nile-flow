import type { WorkspaceCommand } from './commands'

// Strict event types instead of generic strings
export type OrchestratorEvent =
  | { type: 'COMMAND_DISPATCHED'; command: WorkspaceCommand }
  | { type: 'PERSISTENCE_START' }
  | { type: 'PERSISTENCE_SUCCESS'; durationMs: number }
  | { type: 'PERSISTENCE_ERROR'; error: Error }
  | { type: 'MODE_REJECTED'; commandType: string; reason: string }

type EventCallback = (event: OrchestratorEvent) => void

class WorkspaceEventBus {
  private listeners: Record<string, EventCallback[]> = {}

  on(eventType: OrchestratorEvent['type'], callback: EventCallback) {
    if (!this.listeners[eventType]) this.listeners[eventType] = []
    this.listeners[eventType].push(callback)
    return () => this.off(eventType, callback)
  }

  off(eventType: OrchestratorEvent['type'], callback: EventCallback) {
    if (!this.listeners[eventType]) return
    this.listeners[eventType] = this.listeners[eventType].filter(cb => cb !== callback)
  }

  emit(event: OrchestratorEvent) {
    if (!this.listeners[event.type]) return
    this.listeners[event.type].forEach(cb => cb(event))
  }
}

export const workspaceEvents = new WorkspaceEventBus()

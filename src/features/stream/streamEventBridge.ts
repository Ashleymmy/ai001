import type { FrameStreamEvent, GenerateStreamEvent, StudioBatchGenerateStreamEvent, VideoStreamEvent } from '../../services/api'

export type UnifiedStreamStage = 'elements' | 'frames' | 'videos' | 'audio' | 'batch'

export interface UnifiedStreamEvent {
  stage: UnifiedStreamStage
  type: string
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed'
  message: string
  progress?: number
  mode?: 'legacy' | 'task_queue'
  taskId?: string
  raw?: unknown
}

function statusFromType(type: string): UnifiedStreamEvent['status'] {
  if (type === 'done' || type === 'complete' || type === 'item_complete') return 'completed'
  if (type === 'error' || type === 'timeout') return 'failed'
  if (type === 'submitted' || type === 'queued' || type === 'start' || type === 'stage_start') return 'queued'
  return 'processing'
}

export function fromAgentElementStream(event: GenerateStreamEvent): UnifiedStreamEvent {
  const progress =
    typeof event.current === 'number' && typeof event.total === 'number' && event.total > 0
      ? Math.min(100, Math.max(0, Math.round((event.current / event.total) * 100)))
      : undefined
  return {
    stage: 'elements',
    type: event.type,
    status: statusFromType(event.type),
    message: event.element_name || event.error || event.type,
    progress,
    mode: event.mode,
    taskId: event.task_id,
    raw: event,
  }
}

export function fromAgentFrameStream(event: FrameStreamEvent): UnifiedStreamEvent {
  return {
    stage: 'frames',
    type: event.type,
    status: statusFromType(event.type),
    message: event.shot_name || event.error || event.type,
    progress: event.percent,
    mode: event.mode,
    taskId: event.task_id,
    raw: event,
  }
}

export function fromAgentVideoStream(event: VideoStreamEvent): UnifiedStreamEvent {
  return {
    stage: 'videos',
    type: event.type,
    status: statusFromType(event.type),
    message: event.shot_name || event.message || event.error || event.type,
    progress: event.percent,
    mode: event.mode,
    taskId: event.task_id,
    raw: event,
  }
}

export function fromStudioBatchStream(event: StudioBatchGenerateStreamEvent): UnifiedStreamEvent {
  const stage = event.stage === 'audio' ? 'audio' : 'batch'
  return {
    stage,
    type: event.type,
    status: statusFromType(event.type),
    message: event.item_name || event.detail || event.error || event.type,
    progress: event.percent,
    mode: event.mode,
    taskId: event.task_id,
    raw: event,
  }
}

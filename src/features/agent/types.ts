export type ModuleType = 'elements' | 'storyboard' | 'timeline'
export type GenerationStage = 'idle' | 'planning' | 'elements' | 'frames' | 'videos' | 'audio' | 'complete'
export type TaskCardType = 'brief' | 'storyboard' | 'visual' | 'genPath' | 'narration' | 'music' | 'timeline'

export type ExportDialogPhase = 'packing' | 'downloading' | 'saving' | 'done' | 'error' | 'canceled'
export type ExportToastMode = 'floating' | 'pinned' | 'completed'

export interface ExportDialogState {
  open: boolean
  mode: ExportToastMode
  phase: ExportDialogPhase
  loaded: number
  total?: number
  percent?: number
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  data?: unknown
  options?: ChatOption[]
  confirmButton?: { label: string; action: string; payload?: unknown }
  progress?: ProgressItem[]
}

export interface ChatOption {
  id: string
  label: string
  value: string
  selected?: boolean
}

export interface ProgressItem {
  label: string
  completed: boolean
}

export interface VisualAsset {
  id: string
  name: string
  url: string
  duration?: string
  type: 'element' | 'start_frame' | 'video'
  elementId?: string
  shotId?: string
  status?: 'pending' | 'generating' | 'completed' | 'failed'
}

export interface AudioAsset {
  id: string
  name: string
  url?: string
  type: 'narration' | 'dialogue' | 'music' | 'sfx'
  duration?: string
  status?: 'pending' | 'generating' | 'completed'
}

export interface CreativeBrief {
  title?: string
  videoType?: string
  narrativeDriver?: string
  emotionalTone?: string
  visualStyle?: string
  duration?: string
  aspectRatio?: string
  language?: string
  narratorVoiceProfile?: string
  [key: string]: string | undefined
}


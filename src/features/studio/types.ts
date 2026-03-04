export interface StudioToast {
  id: string
  message: string
  code?: string | null
  context?: Record<string, unknown> | null
}

export type ExportPhase = 'packing' | 'downloading' | 'saving' | 'done' | 'error'

export interface StudioExportProgress {
  title: string
  phase: ExportPhase
  loaded: number
  total?: number
  percent?: number
  error?: string
}

export type StudioActivityTone = 'idle' | 'info' | 'working' | 'success' | 'warning' | 'error'

export interface StudioActivityIndicator {
  active: boolean
  title: string
  detail: string
  progress: number | null
  tone: StudioActivityTone
}

export interface AgentProjectOption {
  id: string
  name: string
  updated_at?: string
  elements_count?: number
  segments_count?: number
  creative_brief?: Record<string, unknown>
}

export interface AgentExportOptions {
  mode: 'new' | 'existing'
  projectName: string
  selectedProjectId: string
  includeSharedElements: boolean
  includeEpisodeElements: boolean
  preserveExistingMessages: boolean
}

export type PreviewPanelRect = {
  x: number
  y: number
  width: number
  height: number
}

export type PreviewPanelResizeDirection =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export type WorkbenchMode = 'longform' | 'short_video' | 'digital_human'

export type PromptFieldKey = 'prompt' | 'end_prompt' | 'video_prompt'

export type DigitalHumanProfileDraft = {
  id: string
  base_name: string
  display_name: string
  stage_label: string
  appearance: string
  voice_profile: string
  scene_template: string
  lip_sync_style: string
}

export interface HistoryShotDiffItem {
  index: number
  type: 'added' | 'removed' | 'changed'
  current?: import('../../store/studioStore').StudioShot
  previous?: import('../../store/studioStore').StudioShot
  changedFields?: string[]
}

export interface HistoryShotDiffSummary {
  added: number
  removed: number
  changed: number
  unchanged: number
  items: HistoryShotDiffItem[]
}

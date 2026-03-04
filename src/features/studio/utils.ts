import type { StudioShot, StudioGenerationStage, StudioGenerationProgress } from '../../store/studioStore'
import type {
  PromptFieldKey,
  WorkbenchMode,
  DigitalHumanProfileDraft,
  AgentExportOptions,
  PreviewPanelRect,
  PreviewPanelResizeDirection,
  StudioExportProgress,
  HistoryShotDiffItem,
  HistoryShotDiffSummary,
} from './types'

const DIGITAL_HUMAN_LIP_SYNC_OPTIONS = [
  '写实口型',
  '轻拟合口型',
  '夸张口型',
  '对白优先',
  '旁白优先',
] as const

export { DIGITAL_HUMAN_LIP_SYNC_OPTIONS }

export function isPromptFieldKey(value: string): value is PromptFieldKey {
  return value === 'prompt' || value === 'end_prompt' || value === 'video_prompt'
}

export function resolveRouteBase(pathname: string, fallback: string = '/studio'): string {
  const path = (pathname || '').toLowerCase()
  if (path.startsWith('/short-video')) return '/short-video'
  if (path.startsWith('/digital-human')) return '/digital-human'
  return fallback
}

export function inferModeByRoute(routeBase: string): WorkbenchMode {
  if (routeBase === '/short-video') return 'short_video'
  if (routeBase === '/digital-human') return 'digital_human'
  return 'longform'
}

export function getWorkbenchLabel(mode: WorkbenchMode): string {
  if (mode === 'short_video') return '短视频制作工作台'
  if (mode === 'digital_human') return '数字人短剧工作台'
  return '长篇制作工作台'
}

export function getWorkbenchWelcomeText(mode: WorkbenchMode): string {
  if (mode === 'short_video') {
    return '面向 15-60 秒快节奏内容，支持脚本快速拆分、批量生成和时间线预览导出。'
  }
  if (mode === 'digital_human') {
    return '聚焦数字人角色驱动创作，支持按阶段管理角色形象、音色与场景模板。'
  }
  return '在这里创建系列故事，进行分幕拆解、元素提取、逐集分镜规划和资产生成。适合多集、长篇精细化视频制作。'
}

export function createDigitalHumanProfile(): DigitalHumanProfileDraft {
  return {
    id: `dh_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    base_name: '',
    display_name: '',
    stage_label: '',
    appearance: '',
    voice_profile: '',
    scene_template: '',
    lip_sync_style: DIGITAL_HUMAN_LIP_SYNC_OPTIONS[0],
  }
}

export function normalizeDigitalHumanProfiles(value: unknown): DigitalHumanProfileDraft[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): DigitalHumanProfileDraft | null => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      const baseName = String(row.base_name || row.character_name || row.name || '').trim()
      const displayName = String(row.display_name || row.name || baseName).trim()
      if (!baseName && !displayName) return null
      return {
        id: String(row.id || row.profile_id || `${baseName}_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`),
        base_name: baseName || displayName,
        display_name: displayName || baseName,
        stage_label: String(row.stage_label || row.stage || '').trim(),
        appearance: String(row.appearance || row.description || '').trim(),
        voice_profile: String(row.voice_profile || '').trim(),
        scene_template: String(row.scene_template || row.scene || '').trim(),
        lip_sync_style: String(row.lip_sync_style || row.lip_sync || DIGITAL_HUMAN_LIP_SYNC_OPTIONS[0]).trim() || DIGITAL_HUMAN_LIP_SYNC_OPTIONS[0],
      }
    })
    .filter((item): item is DigitalHumanProfileDraft => Boolean(item))
}

export function getDigitalHumanProfileDisplayName(profile: DigitalHumanProfileDraft): string {
  const name = profile.display_name.trim() || profile.base_name.trim() || '未命名角色'
  const stage = profile.stage_label.trim()
  return stage ? `${name}（${stage}）` : name
}

export function buildDigitalHumanProfileElementDescription(profile: DigitalHumanProfileDraft): string {
  const chunks: string[] = []
  if (profile.appearance.trim()) chunks.push(profile.appearance.trim())
  if (profile.scene_template.trim()) chunks.push(`场景模板：${profile.scene_template.trim()}`)
  if (profile.lip_sync_style.trim()) chunks.push(`口型策略：${profile.lip_sync_style.trim()}`)
  return chunks.join('；')
}

export function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
  } catch {
    return fallback
  }
}

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return fallback
    return raw === '1'
  } catch {
    return fallback
  }
}

export function formatRelativeTime(input: string): string {
  const timestamp = new Date(input).getTime()
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s 前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export function defaultPreviewPanelRect(): PreviewPanelRect {
  if (typeof window === 'undefined') {
    return { x: 220, y: 120, width: 1020, height: 420 }
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const minW = Math.min(420, Math.max(320, vw - 16))
  const minH = Math.min(260, Math.max(200, vh - 56))
  const width = Math.max(minW, Math.min(1200, Math.round(vw * 0.72)))
  const height = Math.max(minH, Math.min(620, Math.round(vh * 0.58)))
  const x = Math.max(8, Math.round((vw - width) / 2))
  const y = Math.max(44, Math.round((vh - height) / 2))
  return { x, y, width, height }
}

export function createDefaultAgentExportOptions(): AgentExportOptions {
  return {
    mode: 'new',
    projectName: '',
    selectedProjectId: '',
    includeSharedElements: true,
    includeEpisodeElements: true,
    preserveExistingMessages: true,
  }
}

export function clampPreviewPanelRect(next: PreviewPanelRect): PreviewPanelRect {
  if (typeof window === 'undefined') return next

  const vw = window.innerWidth
  const vh = window.innerHeight
  const maxW = Math.max(320, vw - 16)
  const maxH = Math.max(200, vh - 56)
  const minW = Math.min(420, maxW)
  const minH = Math.min(260, maxH)

  const width = Math.min(maxW, Math.max(minW, next.width))
  const height = Math.min(maxH, Math.max(minH, next.height))
  const maxX = Math.max(8, vw - width - 8)
  const maxY = Math.max(40, vh - height - 8)
  const x = Math.min(maxX, Math.max(8, next.x))
  const y = Math.min(maxY, Math.max(40, next.y))

  return { x, y, width, height }
}

export function getEpisodeStatusText(status: string): string {
  if (status === 'draft') return '草稿'
  if (status === 'planned') return '已规划'
  if (status === 'in_progress') return '制作中'
  if (status === 'completed') return '已完成'
  return status
}

export function getEpisodeStatusBadgeClass(status: string): string {
  if (status === 'planned') return 'bg-blue-900/30 text-blue-300'
  if (status === 'completed') return 'bg-green-900/30 text-green-300'
  if (status === 'in_progress') return 'bg-yellow-900/30 text-yellow-300'
  if (status === 'draft') return 'bg-gray-800 text-gray-300'
  return 'bg-gray-800 text-gray-400'
}

export function getGenerationStageText(stage: StudioGenerationStage): string {
  if (stage === 'generating_elements') return '生成元素图中'
  if (stage === 'generating_frames') return '生成起始帧中'
  if (stage === 'generating_key_frames') return '生成关键帧中'
  if (stage === 'generating_end_frames') return '生成尾帧中'
  if (stage === 'generating_videos') return '生成视频中'
  if (stage === 'generating_audio') return '生成音频中'
  if (stage === 'complete') return '批量生成完成'
  if (stage === 'error') return '批量生成失败'
  return '批量生成进行中'
}

export function getGenerationDetail(progress: StudioGenerationProgress): string {
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0))
  const counter = progress.totalItems > 0
    ? `${Math.min(progress.currentIndex, progress.totalItems)}/${progress.totalItems}`
    : ''
  const item = progress.currentItem ? ` · ${progress.currentItem}` : ''
  const errors = progress.errors.length > 0 ? ` · 异常 ${progress.errors.length}` : ''
  if (!counter) return `${percent.toFixed(0)}%${item}${errors}`.trim()
  return `${counter} (${percent.toFixed(0)}%)${item}${errors}`
}

export function formatHistoryAction(action: string): string {
  if (action === 'plan') return '分镜规划'
  if (action === 'enhance_refine') return '镜头优化'
  if (action === 'enhance_expand') return '镜头扩展'
  if (action === 'batch_generate') return '批量生成'
  if (action === 'edit_episode') return '编辑集信息'
  if (action === 'edit_shot') return '编辑镜头'
  if (action.startsWith('restore_')) return '版本回退'
  return action
}

export function summarizeShotDiff(currentShots: StudioShot[], previousShots: StudioShot[]): HistoryShotDiffSummary {
  const current = [...currentShots].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const previous = [...previousShots].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const total = Math.max(current.length, previous.length)
  const items: HistoryShotDiffItem[] = []
  let added = 0
  let removed = 0
  let changed = 0
  let unchanged = 0

  for (let index = 0; index < total; index += 1) {
    const cur = current[index]
    const prev = previous[index]
    if (cur && !prev) {
      added += 1
      items.push({ index, type: 'added', current: cur })
      continue
    }
    if (!cur && prev) {
      removed += 1
      items.push({ index, type: 'removed', previous: prev })
      continue
    }
    if (!cur || !prev) continue

    const changedFields: string[] = []
    if ((cur.name || '') !== (prev.name || '')) changedFields.push('名称')
    if ((cur.type || '') !== (prev.type || '')) changedFields.push('类型')
    if (Number(cur.duration || 0) !== Number(prev.duration || 0)) changedFields.push('时长')
    if ((cur.description || '') !== (prev.description || '')) changedFields.push('描述')
    if ((cur.prompt || '') !== (prev.prompt || '')) changedFields.push('首帧提示词')
    if ((cur.end_prompt || '') !== (prev.end_prompt || '')) changedFields.push('尾帧提示词')
    if ((cur.video_prompt || '') !== (prev.video_prompt || '')) changedFields.push('视频提示词')
    if ((cur.narration || '') !== (prev.narration || '')) changedFields.push('旁白')
    if ((cur.dialogue_script || '') !== (prev.dialogue_script || '')) changedFields.push('对白')
    if ((cur.sound_effects || '') !== (prev.sound_effects || '')) changedFields.push('音效信息')

    if (changedFields.length > 0) {
      changed += 1
      items.push({ index, type: 'changed', current: cur, previous: prev, changedFields })
    } else {
      unchanged += 1
    }
  }

  return { added, removed, changed, unchanged, items }
}

export function resizeCursorByDirection(direction: PreviewPanelResizeDirection): string {
  if (direction === 'left' || direction === 'right') return 'ew-resize'
  if (direction === 'top' || direction === 'bottom') return 'ns-resize'
  if (direction === 'top-left' || direction === 'bottom-right') return 'nwse-resize'
  return 'nesw-resize'
}

export function calcExportPercent(progress: StudioExportProgress): number | null {
  if (typeof progress.percent === 'number' && Number.isFinite(progress.percent)) {
    return Math.min(100, Math.max(0, progress.percent))
  }
  if (progress.total && progress.total > 0) {
    return Math.min(100, Math.max(0, (progress.loaded / progress.total) * 100))
  }
  if (progress.phase === 'packing') return 8
  if (progress.phase === 'saving') return 94
  if (progress.phase === 'done') return 100
  if (progress.phase === 'error') return 100
  return null
}

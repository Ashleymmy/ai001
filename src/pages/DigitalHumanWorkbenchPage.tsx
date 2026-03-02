/**
 * 功能模块：数字人短剧工作台 -- 角色驱动编辑器布局
 *
 * 设计理念：角色是一等公民，工作流围绕数字人角色展开。
 * - 左侧面板：始终可见的角色面板，展示所有数字人档案
 * - 中央区域：按幕/集组织的镜头卡片编辑区
 * - 右侧面板：16:9 预览播放器 + 口型同步状态指示器
 * - 底部：角色阶段时间线，可视化角色年龄/阶段切换节点
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Plus, Play, Loader2, Users, Sparkles, Settings2,
  Volume2, Image, ChevronRight, ChevronLeft, Upload, Mic,
} from 'lucide-react'
import { useStudioStore } from '../store/studioStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { studioCheckConfig, studioSaveDigitalHumanProfiles, previewTTSVoice } from '../services/api'
import { BACKEND_ORIGIN } from '../services/api'
import { useSettingsStore } from '../store/settingsStore'
import type {
  StudioShot,
} from '../store/studioStore'
import Timeline from '../components/studio/Timeline'
import PreviewPlayer from '../components/studio/PreviewPlayer'
import ShotDetailPanel from '../components/studio/ShotDetailPanel'

// ============================================================
// 常量 & 类型
// ============================================================

const LIP_SYNC_OPTIONS = [
  '写实口型',
  '轻拟合口型',
  '夸张口型',
  '对白优先',
  '旁白优先',
] as const

interface DigitalHumanProfile {
  id: string
  base_name: string
  display_name: string
  stage_label: string
  appearance: string
  voice_profile: string
  scene_template: string
  lip_sync_style: string
  sort_order?: number
}

interface CreateFormState {
  name: string
  script: string
  description: string
  visualStyle: string
  targetEpisodeCount: number
  episodeDuration: number
}

// ============================================================
// 工具函数
// ============================================================

function createBlankProfile(): DigitalHumanProfile {
  return {
    id: `dh_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    base_name: '',
    display_name: '',
    stage_label: '',
    appearance: '',
    voice_profile: '',
    scene_template: '',
    lip_sync_style: LIP_SYNC_OPTIONS[0],
  }
}

function profileDisplayName(p: DigitalHumanProfile): string {
  const name = (p.display_name || p.base_name || '未命名角色').trim()
  const stage = (p.stage_label || '').trim()
  return stage ? `${name}（${stage}）` : name
}

function normalizeProfiles(raw: unknown): DigitalHumanProfile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((row) => ({
      id: String(row.id || `dh_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`),
      base_name: String(row.base_name || '').trim(),
      display_name: String(row.display_name || row.base_name || '').trim(),
      stage_label: String(row.stage_label || '').trim(),
      appearance: String(row.appearance || '').trim(),
      voice_profile: String(row.voice_profile || '').trim(),
      scene_template: String(row.scene_template || '').trim(),
      lip_sync_style: String(row.lip_sync_style || LIP_SYNC_OPTIONS[0]).trim(),
      sort_order: typeof row.sort_order === 'number' ? row.sort_order : undefined,
    }))
    .filter((p) => p.base_name || p.display_name)
}

function getShotImageUrl(shot: StudioShot): string | null {
  if (shot.start_image_url) return shot.start_image_url
  if (shot.key_frame_url) return shot.key_frame_url
  if (shot.end_image_url) return shot.end_image_url
  return null
}

function getEpisodeStatusLabel(status: string): string {
  if (status === 'draft') return '草稿'
  if (status === 'planned') return '已规划'
  if (status === 'in_progress') return '制作中'
  if (status === 'completed') return '已完成'
  return status
}

function getStatusBadgeCls(status: string): string {
  if (status === 'planned') return 'bg-blue-900/30 text-blue-300'
  if (status === 'completed') return 'bg-green-900/30 text-green-300'
  if (status === 'in_progress') return 'bg-yellow-900/30 text-yellow-300'
  return 'bg-gray-800 text-gray-400'
}

// ============================================================
// 创建系列对话框（数字人模式专用）
// ============================================================

function CreateDigitalHumanDialog({
  creating,
  onClose,
  onSubmit,
}: {
  creating: boolean
  onClose: () => void
  onSubmit: (params: {
    name: string
    script: string
    description?: string
    visual_style?: string
    target_episode_count?: number
    episode_duration_seconds?: number
  }) => void
}) {
  const [form, setForm] = useState<CreateFormState>({
    name: '',
    script: '',
    description: '',
    visualStyle: '',
    targetEpisodeCount: 1,
    episodeDuration: 45,
  })

  const canSubmit = form.name.trim().length > 0 && form.script.trim().length > 0 && !creating

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({
      name: form.name.trim(),
      script: form.script.trim(),
      description: form.description.trim() || undefined,
      visual_style: form.visualStyle.trim() || undefined,
      target_episode_count: form.targetEpisodeCount || undefined,
      episode_duration_seconds: form.episodeDuration || undefined,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold text-gray-100 mb-4">创建数字人短剧项目</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-400 block mb-1">项目名称 *</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
              placeholder="例如：时光人物志"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">剧本 / 角色脚本 *</label>
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500 resize-none"
              rows={8}
              placeholder="粘贴数字人短剧脚本（对白/口播可更详细）..."
              value={form.script}
              onChange={(e) => setForm((f) => ({ ...f, script: e.target.value }))}
            />
            <p className="text-xs text-gray-500 mt-1">{form.script.length} 字</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">简要描述</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                placeholder="可选"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">视觉风格</label>
              <input
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                placeholder="例如：电影级写实 / 轻卡通"
                value={form.visualStyle}
                onChange={(e) => setForm((f) => ({ ...f, visualStyle: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-1">期望集数（0=自动）</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                value={form.targetEpisodeCount}
                onChange={(e) => setForm((f) => ({ ...f, targetEpisodeCount: parseInt(e.target.value) || 0 }))}
                min={0}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-1">每集时长（秒）</label>
              <input
                type="number"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                value={form.episodeDuration}
                onChange={(e) => setForm((f) => ({ ...f, episodeDuration: parseInt(e.target.value) || 45 }))}
                min={10}
                max={180}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {creating && <Loader2 className="w-4 h-4 animate-spin" />}
            创建项目
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 角色卡片（左侧面板子组件）
// ============================================================

function CharacterCard({
  profile,
  selected,
  onSelect,
  onAuditionVoice,
}: {
  profile: DigitalHumanProfile
  selected: boolean
  onSelect: () => void
  onAuditionVoice: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border p-3 cursor-pointer transition-all ${
        selected
          ? 'border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500/30'
          : 'border-gray-800 bg-gray-900/60 hover:border-gray-600'
      }`}
    >
      {/* 角色名 + 阶段标签 */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-100 truncate">
            {profile.display_name || profile.base_name || '未命名角色'}
          </p>
          {profile.stage_label && (
            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] bg-indigo-900/40 text-indigo-300">
              {profile.stage_label}
            </span>
          )}
        </div>
        <div className="shrink-0 w-10 h-10 rounded-lg border border-gray-700 bg-gray-800 flex items-center justify-center overflow-hidden">
          <Image className="w-4 h-4 text-gray-600" />
        </div>
      </div>

      {/* 外观描述 */}
      {profile.appearance && (
        <p className="text-[11px] text-gray-400 line-clamp-2 mb-2">{profile.appearance}</p>
      )}

      {/* 口型策略 + 音色 */}
      <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-2">
        {profile.lip_sync_style && (
          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
            {profile.lip_sync_style}
          </span>
        )}
        {profile.voice_profile && (
          <span className="truncate">{profile.voice_profile}</span>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); onAuditionVoice() }}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          title="试听音色"
        >
          <Volume2 className="w-3 h-3" />
          试听音色
        </button>
        <button
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
          title="形象参考"
        >
          <Image className="w-3 h-3" />
          形象参考
        </button>
      </div>
    </div>
  )
}

// ============================================================
// 镜头紧凑卡片（中央编辑区子组件）
// ============================================================

function CompactShotCard({
  shot,
  selected,
  onSelect,
}: {
  shot: StudioShot
  selected: boolean
  onSelect: () => void
}) {
  const imageUrl = getShotImageUrl(shot)

  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border overflow-hidden cursor-pointer transition-all ${
        selected
          ? 'border-indigo-500 ring-1 ring-indigo-500/30 bg-gray-900/80'
          : 'border-gray-800 bg-gray-900/50 hover:border-gray-600'
      }`}
    >
      {/* 缩略图 */}
      <div className="aspect-video bg-gray-800 relative">
        {imageUrl ? (
          <img
            src={imageUrl.startsWith('http') ? imageUrl : `${BACKEND_ORIGIN}${imageUrl}`}
            alt={shot.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Image className="w-5 h-5 text-gray-600" />
          </div>
        )}
        {/* 时长标签 */}
        <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded text-[10px] bg-black/60 text-gray-300">
          {Number(shot.duration || 0).toFixed(0)}s
        </span>
        {/* 视频/音频指示 */}
        <div className="absolute top-1 left-1 flex gap-1">
          {shot.video_url && (
            <span className="w-4 h-4 rounded-full bg-emerald-600/80 flex items-center justify-center">
              <Play className="w-2.5 h-2.5 text-white" />
            </span>
          )}
          {shot.audio_url && (
            <span className="w-4 h-4 rounded-full bg-blue-600/80 flex items-center justify-center">
              <Mic className="w-2.5 h-2.5 text-white" />
            </span>
          )}
        </div>
      </div>
      {/* 信息区 */}
      <div className="px-2 py-1.5">
        <p className="text-xs font-medium text-gray-200 truncate">{shot.name || `镜头 ${shot.sort_order}`}</p>
        {shot.description && (
          <p className="text-[10px] text-gray-500 line-clamp-1 mt-0.5">{shot.description}</p>
        )}
      </div>
    </div>
  )
}

// ============================================================
// 角色阶段时间线（底部）
// ============================================================

function CharacterStageTimeline({
  profiles,
  shots,
}: {
  profiles: DigitalHumanProfile[]
  shots: StudioShot[]
}) {
  // 根据角色名称与镜头描述/对白匹配来推断角色在哪些镜头出现
  const characterShotMap = useMemo(() => {
    const map = new Map<string, number[]>()
    profiles.forEach((p) => {
      const name = p.base_name || p.display_name
      if (!name) return
      const indices: number[] = []
      shots.forEach((shot, idx) => {
        const text = `${shot.description || ''} ${shot.dialogue_script || ''} ${shot.narration || ''}`
        if (text.includes(name)) {
          indices.push(idx)
        }
      })
      map.set(p.id, indices)
    })
    return map
  }, [profiles, shots])

  if (profiles.length === 0 || shots.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-600">
        暂无角色阶段数据
      </div>
    )
  }

  const totalShots = shots.length

  return (
    <div className="h-full overflow-x-auto overflow-y-auto px-3 py-2">
      <div className="min-w-[600px]">
        {/* 镜头刻度 */}
        <div className="flex items-center mb-1 pl-28">
          {shots.map((shot, idx) => (
            <div
              key={shot.id}
              className="text-[9px] text-gray-600 text-center shrink-0"
              style={{ width: `${100 / totalShots}%` }}
            >
              {idx + 1}
            </div>
          ))}
        </div>
        {/* 每个角色一行 */}
        {profiles.map((profile) => {
          const indices = characterShotMap.get(profile.id) || []
          return (
            <div key={profile.id} className="flex items-center mb-1">
              <div className="w-28 shrink-0 pr-2 text-right">
                <span className="text-[11px] text-gray-300 truncate block">
                  {profileDisplayName(profile)}
                </span>
              </div>
              <div className="flex-1 flex">
                {shots.map((shot, idx) => {
                  const isPresent = indices.includes(idx)
                  return (
                    <div
                      key={shot.id}
                      className="shrink-0 h-4 flex items-center justify-center"
                      style={{ width: `${100 / totalShots}%` }}
                    >
                      <div
                        className={`h-2.5 rounded-sm transition-colors ${
                          isPresent
                            ? 'bg-indigo-500/80 w-full mx-px'
                            : 'bg-gray-800/60 w-full mx-px'
                        }`}
                        title={isPresent ? `${profileDisplayName(profile)} 出场` : ''}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ============================================================
// 主页面组件
// ============================================================

export default function DigitalHumanWorkbenchPage() {
  const navigate = useNavigate()
  const { seriesId, episodeId } = useParams()
  const store = useStudioStore()
  const workspaceInitialized = useWorkspaceStore((s) => s.initialized)
  const initWorkspace = useWorkspaceStore((s) => s.init)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentWorkspaceId)

  // ------ 本地 UI 状态 ------
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [showShotDetail, setShowShotDetail] = useState(false)
  const [lipSyncActive, setLipSyncActive] = useState(false)
  const [auditioning, setAuditioning] = useState<string | null>(null)
  const [auditionError, setAuditionError] = useState<string | null>(null)
  const [configChecked, setConfigChecked] = useState(false)
  const auditionAudioRef = useRef<HTMLAudioElement | null>(null)
  const auditionBlobUrlRef = useRef<string | null>(null)
  const ttsSettings = useSettingsStore((s) => s.settings.tts)

  // ------ 过滤出数字人模式的系列 ------
  const visibleSeriesList = useMemo(
    () => store.seriesList.filter((series) => {
      const mode = String(series.settings?.workbench_mode || 'longform')
      return mode === 'digital_human'
    }),
    [store.seriesList],
  )

  // ------ 数字人角色档案 ------
  const profiles = useMemo<DigitalHumanProfile[]>(
    () => normalizeProfiles(store.currentSeries?.digital_human_profiles),
    [store.currentSeries?.digital_human_profiles],
  )

  // ------ 集列表 ------
  const episodes = store.episodes || []

  // ------ 当前镜头列表 ------
  const shots = store.shots || []

  // ------ 当前选中的镜头 ------
  const selectedShot = useMemo(
    () => shots.find((s) => s.id === selectedShotId) || null,
    [shots, selectedShotId],
  )

  // ------ 当前系列的公共元素 ------
  const sharedElements = store.sharedElements || []

  // ------ 初始化 ------
  useEffect(() => {
    if (!workspaceInitialized) {
      initWorkspace()
    }
  }, [workspaceInitialized, initWorkspace])

  useEffect(() => {
    store.loadSeriesList()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!configChecked) {
      studioCheckConfig().then(() => setConfigChecked(true)).catch(() => {})
    }
  }, [configChecked])

  // ------ 路由同步 ------
  useEffect(() => {
    if (seriesId && seriesId !== store.currentSeriesId) {
      store.selectSeries(seriesId)
    } else if (!seriesId && store.currentSeriesId) {
      store.selectSeries(null)
    }
  }, [seriesId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (episodeId && episodeId !== store.currentEpisodeId) {
      store.selectEpisode(episodeId)
    } else if (!episodeId && store.currentEpisodeId) {
      store.selectEpisode(null)
    }
  }, [episodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 选择第一个镜头
  useEffect(() => {
    if (shots.length > 0 && !selectedShotId) {
      setSelectedShotId(shots[0].id)
    }
  }, [shots, selectedShotId])

  // ------ 操作回调 ------
  const handleCreateSeries = useCallback(async (params: {
    name: string
    script: string
    description?: string
    visual_style?: string
    target_episode_count?: number
    episode_duration_seconds?: number
  }) => {
    const created = await store.createSeries({
      ...params,
      workspace_id: currentWorkspaceId || undefined,
      workbench_mode: 'digital_human',
    })
    if (created) {
      setShowCreateDialog(false)
      navigate(`/digital-human/${created.id}`)
    }
  }, [store, currentWorkspaceId, navigate])

  const handleSelectSeries = useCallback((sid: string) => {
    navigate(`/digital-human/${sid}`)
  }, [navigate])

  const handleSelectEpisode = useCallback((eid: string) => {
    if (!store.currentSeriesId) return
    navigate(`/digital-human/${store.currentSeriesId}/${eid}`)
  }, [navigate, store.currentSeriesId])

  const handleBackToList = useCallback(() => {
    navigate('/digital-human')
  }, [navigate])

  const handleBackToSeries = useCallback(() => {
    if (store.currentSeriesId) {
      navigate(`/digital-human/${store.currentSeriesId}`)
    }
  }, [navigate, store.currentSeriesId])

  const handleSelectShot = useCallback((shotId: string) => {
    setSelectedShotId(shotId)
    setShowShotDetail(true)
  }, [])

  const handleGenerateAsset = useCallback(async (stage: 'frame' | 'key_frame' | 'end_frame' | 'video' | 'audio') => {
    if (!selectedShotId) return
    await store.generateShotAsset(selectedShotId, stage)
  }, [store, selectedShotId])

  const handleInpaint = useCallback(async (payload: { editPrompt: string; maskData?: string }) => {
    if (!selectedShotId) return
    await store.inpaintShotFrame(selectedShotId, {
      edit_prompt: payload.editPrompt,
      mask_data: payload.maskData,
    })
  }, [store, selectedShotId])

  const handleUpdateShot = useCallback((updates: Record<string, unknown>) => {
    if (!selectedShotId) return
    store.updateShot(selectedShotId, updates)
  }, [store, selectedShotId])

  const handleBatchGenerate = useCallback(async () => {
    if (!store.currentEpisodeId) return
    await store.batchGenerate(store.currentEpisodeId)
  }, [store])

  const handlePlanEpisode = useCallback(async () => {
    if (!store.currentEpisodeId) return
    await store.planEpisode(store.currentEpisodeId)
  }, [store])

  const handleAuditionVoice = useCallback(async (profileId: string) => {
    // 停止之前正在播放的试听
    if (auditionAudioRef.current) {
      auditionAudioRef.current.pause()
      auditionAudioRef.current = null
    }
    if (auditionBlobUrlRef.current) {
      URL.revokeObjectURL(auditionBlobUrlRef.current)
      auditionBlobUrlRef.current = null
    }

    setAuditioning(profileId)
    setAuditionError(null)

    try {
      const profile = profiles.find((p) => p.id === profileId)
      const voiceType = profile?.voice_profile || undefined
      const sampleText = profile?.appearance
        ? `你好，我是${profile.display_name || profile.base_name || '角色'}。${profile.appearance.slice(0, 30)}`
        : `你好，这是${profile?.display_name || profile?.base_name || '角色'}的语音试听。`

      const ttsConfig = {
        ...ttsSettings,
        provider: ttsSettings.provider,
        volc: { ...ttsSettings.volc },
        fish: { ...ttsSettings.fish },
        bailian: { ...ttsSettings.bailian },
        custom: { ...ttsSettings.custom },
      }

      const audioBlob = await previewTTSVoice(ttsConfig, voiceType, sampleText)
      const blobUrl = URL.createObjectURL(audioBlob)
      auditionBlobUrlRef.current = blobUrl

      const audio = new Audio(blobUrl)
      auditionAudioRef.current = audio
      audio.onended = () => {
        setAuditioning(null)
        auditionAudioRef.current = null
        if (auditionBlobUrlRef.current) {
          URL.revokeObjectURL(auditionBlobUrlRef.current)
          auditionBlobUrlRef.current = null
        }
      }
      audio.onerror = () => {
        setAuditioning(null)
        setAuditionError('音频播放失败')
        auditionAudioRef.current = null
        if (auditionBlobUrlRef.current) {
          URL.revokeObjectURL(auditionBlobUrlRef.current)
          auditionBlobUrlRef.current = null
        }
      }
      await audio.play()
    } catch (e: unknown) {
      setAuditioning(null)
      const errResponse = (e as { response?: { data?: Blob | { detail?: string } } })?.response
      if (errResponse?.data instanceof Blob) {
        try {
          const text = await errResponse.data.text()
          const parsed = JSON.parse(text)
          setAuditionError(parsed.detail || 'TTS 试听失败')
        } catch {
          setAuditionError('TTS 试听失败')
        }
      } else {
        const detail = (errResponse?.data as { detail?: string })?.detail
          || (e as Error)?.message
          || 'TTS 试听失败，请先在设置中配置 TTS 服务'
        setAuditionError(detail)
      }
    }
  }, [profiles, ttsSettings])

  const handleReorderShots = useCallback(async (orderedIds: string[]) => {
    if (!store.currentEpisodeId) return
    await store.reorderShots(store.currentEpisodeId, orderedIds)
  }, [store])

  const handleAddProfile = useCallback(async () => {
    if (!store.currentSeriesId) return
    const newProfile = createBlankProfile()
    const updatedProfiles = [...profiles, newProfile]
    try {
      await studioSaveDigitalHumanProfiles(store.currentSeriesId, updatedProfiles as any)
      // 刷新数据
      await store.selectSeries(store.currentSeriesId)
    } catch {
      // silent
    }
  }, [store, profiles])

  const handleImportCharacterDoc = useCallback(async () => {
    if (!store.currentSeriesId) return
    // 用简单的 prompt 方式让用户粘贴文档文本
    const text = window.prompt('粘贴角色文档文本（每个角色用换行分隔）：')
    if (!text?.trim()) return
    await store.importCharacterDocument(store.currentSeriesId, text.trim(), {
      saveToElements: true,
      dedupeByName: true,
    })
    await store.selectSeries(store.currentSeriesId)
  }, [store])

  // ------ 口型同步状态模拟 ------
  useEffect(() => {
    if (selectedShot?.video_url && selectedShot?.audio_url) {
      setLipSyncActive(true)
    } else {
      setLipSyncActive(false)
    }
  }, [selectedShot])

  // ============================================================
  // 渲染
  // ============================================================

  // ---------- 系列列表视图（无 seriesId 时） ----------
  if (!seriesId) {
    return (
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        {/* 顶栏 */}
        <header className="shrink-0 h-12 px-4 flex items-center justify-between border-b border-gray-800 bg-gray-950/95 backdrop-blur">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <Users className="w-5 h-5 text-indigo-400" />
            <h1 className="text-sm font-semibold">数字人短剧工作台</h1>
          </div>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            <Plus className="w-4 h-4" />
            新建项目
          </button>
        </header>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-6">
          {store.loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
            </div>
          ) : visibleSeriesList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-500">
              <Users className="w-12 h-12 mb-4 text-gray-700" />
              <p className="text-sm mb-2">还没有数字人短剧项目</p>
              <p className="text-xs text-gray-600 mb-4">
                聚焦数字人角色驱动创作，支持按阶段管理角色形象、音色与场景模板。
              </p>
              <button
                onClick={() => setShowCreateDialog(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                创建第一个项目
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleSeriesList.map((series) => (
                <div
                  key={series.id}
                  onClick={() => handleSelectSeries(series.id)}
                  className="rounded-xl border border-gray-800 bg-gray-900/50 p-4 cursor-pointer hover:border-indigo-600/50 hover:bg-gray-900/70 transition-all"
                >
                  <h3 className="text-sm font-semibold text-gray-100 mb-1">{series.name}</h3>
                  {series.description && (
                    <p className="text-xs text-gray-400 line-clamp-2 mb-2">{series.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-gray-500">
                    <span>{series.episode_count || 0} 集</span>
                    <span>{normalizeProfiles(series.digital_human_profiles).length} 角色</span>
                    <span>{new Date(series.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {showCreateDialog && (
          <CreateDigitalHumanDialog
            creating={store.creating}
            onClose={() => setShowCreateDialog(false)}
            onSubmit={handleCreateSeries}
          />
        )}
      </div>
    )
  }

  // ---------- 系列已选中但无集 → 显示集列表 ----------
  if (seriesId && !episodeId) {
    return (
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        <header className="shrink-0 h-12 px-4 flex items-center justify-between border-b border-gray-800 bg-gray-950/95 backdrop-blur">
          <div className="flex items-center gap-3">
            <button onClick={handleBackToList} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <Users className="w-5 h-5 text-indigo-400" />
            <h1 className="text-sm font-semibold truncate max-w-xs">
              {store.currentSeries?.name || '加载中...'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              项目设置
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* 左侧角色面板 */}
          <aside className="w-64 shrink-0 border-r border-gray-800 flex flex-col bg-gray-950/80">
            <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-300">角色面板</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleImportCharacterDoc}
                  className="p-1 rounded text-gray-500 hover:text-indigo-300 hover:bg-gray-800 transition-colors"
                  title="导入角色文档"
                >
                  <Upload className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleAddProfile}
                  className="p-1 rounded text-gray-500 hover:text-indigo-300 hover:bg-gray-800 transition-colors"
                  title="新角色"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {profiles.length === 0 ? (
                <div className="text-xs text-gray-600 text-center py-8">
                  <Users className="w-8 h-8 mx-auto mb-2 text-gray-700" />
                  <p>暂无角色</p>
                  <p className="mt-1">创建系列并规划后自动提取</p>
                </div>
              ) : (
                profiles.map((p) => (
                  <CharacterCard
                    key={p.id}
                    profile={p}
                    selected={selectedProfileId === p.id}
                    onSelect={() => setSelectedProfileId(p.id)}
                    onAuditionVoice={() => handleAuditionVoice(p.id)}
                  />
                ))
              )}
            </div>
            <div className="px-2 py-2 border-t border-gray-800 flex gap-1">
              <button
                onClick={handleAddProfile}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors"
              >
                <Plus className="w-3 h-3" />
                新角色
              </button>
              <button
                onClick={handleImportCharacterDoc}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
              >
                <Upload className="w-3 h-3" />
                导入角色文档
              </button>
            </div>
          </aside>

          {/* 中央集列表区域 */}
          <main className="flex-1 overflow-y-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-200">
                剧集列表（{episodes.length} 集）
              </h2>
            </div>
            {store.loading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
              </div>
            ) : episodes.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <p className="text-sm">该系列暂无剧集</p>
                <p className="text-xs mt-1">系统将在创建时自动拆分</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {episodes.map((ep) => (
                  <div
                    key={ep.id}
                    onClick={() => handleSelectEpisode(ep.id)}
                    className="rounded-lg border border-gray-800 bg-gray-900/50 p-3 cursor-pointer hover:border-indigo-600/40 transition-all"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-sm font-medium text-gray-200">
                        第{ep.act_number}幕
                        {ep.title ? ` · ${ep.title}` : ''}
                      </h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${getStatusBadgeCls(ep.status)}`}>
                        {getEpisodeStatusLabel(ep.status)}
                      </span>
                    </div>
                    {ep.summary && (
                      <p className="text-[11px] text-gray-500 line-clamp-2">{ep.summary}</p>
                    )}
                    <div className="mt-2 text-[10px] text-gray-600">
                      目标时长 {ep.target_duration_seconds}s
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    )
  }

  // ---------- 主编辑视图：seriesId + episodeId ----------
  const leftWidth = leftPanelCollapsed ? 48 : 260
  const rightWidth = rightPanelCollapsed ? 48 : 340

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* ===== 顶栏 ===== */}
      <header className="shrink-0 h-12 px-4 flex items-center justify-between border-b border-gray-800 bg-gray-950/95 backdrop-blur z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={handleBackToSeries} className="p-1.5 rounded hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Users className="w-4 h-4 text-indigo-400 shrink-0" />
          <h1 className="text-sm font-semibold truncate">数字人短剧工作台</h1>

          {/* 系列/集选择器 */}
          <div className="flex items-center gap-1.5 ml-2 text-xs text-gray-400">
            <button onClick={handleBackToList} className="hover:text-white transition-colors truncate max-w-[120px]">
              {store.currentSeries?.name || '...'}
            </button>
            <ChevronRight className="w-3 h-3 shrink-0" />
            {/* 集下拉选择 */}
            <select
              className="bg-transparent text-xs text-gray-300 hover:text-white outline-none cursor-pointer max-w-[140px]"
              value={store.currentEpisodeId || ''}
              onChange={(e) => {
                if (e.target.value) handleSelectEpisode(e.target.value)
              }}
            >
              {episodes.map((ep) => (
                <option key={ep.id} value={ep.id} className="bg-gray-900 text-gray-200">
                  第{ep.act_number}幕{ep.title ? ` · ${ep.title}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 右侧操作按钮 */}
        <div className="flex items-center gap-2">
          {store.currentEpisode?.status === 'draft' && (
            <button
              onClick={handlePlanEpisode}
              disabled={store.planning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors"
            >
              {store.planning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              规划分镜
            </button>
          )}
          <button
            onClick={handleBatchGenerate}
            disabled={store.generating || shots.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 transition-colors"
          >
            {store.generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            批量生成
          </button>
          <button
            disabled={store.generating || shots.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition-colors"
            title="批量语音合成"
          >
            <Mic className="w-3.5 h-3.5" />
            语音合成
          </button>
        </div>
      </header>

      {/* ===== 主体区域 ===== */}
      <div className="flex-1 flex overflow-hidden">
        {/* ===== 左侧角色面板 ===== */}
        <aside
          className="shrink-0 border-r border-gray-800 flex flex-col bg-gray-950/80 transition-all duration-200"
          style={{ width: leftWidth }}
        >
          {leftPanelCollapsed ? (
            <div className="flex flex-col items-center py-2 gap-2">
              <button
                onClick={() => setLeftPanelCollapsed(false)}
                className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition-colors"
                title="展开角色面板"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <Users className="w-4 h-4 text-indigo-400" />
              <span className="text-[9px] text-gray-500 writing-vertical" style={{ writingMode: 'vertical-rl' }}>角色面板</span>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-indigo-400" />
                  角色面板
                  <span className="text-gray-600">({profiles.length})</span>
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleImportCharacterDoc}
                    className="p-1 rounded text-gray-500 hover:text-indigo-300 hover:bg-gray-800 transition-colors"
                    title="导入角色文档"
                  >
                    <Upload className="w-3 h-3" />
                  </button>
                  <button
                    onClick={handleAddProfile}
                    className="p-1 rounded text-gray-500 hover:text-indigo-300 hover:bg-gray-800 transition-colors"
                    title="新角色"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setLeftPanelCollapsed(true)}
                    className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
                    title="收起"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {profiles.length === 0 ? (
                  <div className="text-xs text-gray-600 text-center py-8">
                    <Users className="w-8 h-8 mx-auto mb-2 text-gray-700" />
                    <p>暂无角色档案</p>
                    <p className="mt-1 text-gray-700">规划分镜后自动提取</p>
                  </div>
                ) : (
                  profiles.map((p) => (
                    <CharacterCard
                      key={p.id}
                      profile={p}
                      selected={selectedProfileId === p.id}
                      onSelect={() => setSelectedProfileId(p.id === selectedProfileId ? null : p.id)}
                      onAuditionVoice={() => handleAuditionVoice(p.id)}
                    />
                  ))
                )}
              </div>

              <div className="px-2 py-2 border-t border-gray-800 space-y-1">
                <button
                  onClick={handleAddProfile}
                  className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] bg-indigo-600/80 hover:bg-indigo-500 text-white transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  新角色
                </button>
                <button
                  onClick={handleImportCharacterDoc}
                  className="w-full flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  导入角色文档
                </button>
              </div>
            </>
          )}
        </aside>

        {/* ===== 中央编辑区 ===== */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* 集信息条 */}
          {store.currentEpisode && (
            <div className="shrink-0 px-4 py-2 border-b border-gray-800 bg-gray-950/60 flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <h3 className="text-xs font-semibold text-gray-200">
                  第{store.currentEpisode.act_number}幕
                  {store.currentEpisode.title ? ` · ${store.currentEpisode.title}` : ''}
                </h3>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${getStatusBadgeCls(store.currentEpisode.status)}`}>
                  {getEpisodeStatusLabel(store.currentEpisode.status)}
                </span>
                <span className="text-[10px] text-gray-600">
                  {shots.length} 个镜头 · 目标 {store.currentEpisode.target_duration_seconds}s
                </span>
              </div>
              {store.currentEpisode.summary && (
                <p className="text-[10px] text-gray-500 truncate max-w-xs">{store.currentEpisode.summary}</p>
              )}
            </div>
          )}

          {/* 镜头卡片网格 */}
          <div className="flex-1 overflow-y-auto p-3">
            {store.loading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
              </div>
            ) : shots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600">
                <Sparkles className="w-10 h-10 mb-3 text-gray-700" />
                <p className="text-sm mb-1">该集暂无镜头</p>
                <p className="text-xs text-gray-700">点击上方"规划分镜"自动生成镜头脚本</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                {shots.map((shot) => (
                  <CompactShotCard
                    key={shot.id}
                    shot={shot}
                    selected={shot.id === selectedShotId}
                    onSelect={() => handleSelectShot(shot.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 时间线 */}
          <div className="shrink-0 border-t border-gray-800">
            <Timeline
              shots={shots}
              currentShotId={selectedShotId}
              onSelectShot={handleSelectShot}
              onReorder={handleReorderShots}
            />
          </div>
        </main>

        {/* ===== 右侧预览面板 ===== */}
        <aside
          className="shrink-0 border-l border-gray-800 flex flex-col bg-gray-950/80 transition-all duration-200"
          style={{ width: rightWidth }}
        >
          {rightPanelCollapsed ? (
            <div className="flex flex-col items-center py-2 gap-2">
              <button
                onClick={() => setRightPanelCollapsed(false)}
                className="p-1.5 rounded hover:bg-gray-800 text-gray-500 hover:text-white transition-colors"
                title="展开预览面板"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <Play className="w-4 h-4 text-indigo-400" />
              <span className="text-[9px] text-gray-500" style={{ writingMode: 'vertical-rl' }}>预览</span>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 text-indigo-400" />
                  预览播放
                </h2>
                <button
                  onClick={() => setRightPanelCollapsed(true)}
                  className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
                  title="收起"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* 16:9 预览播放器 */}
              <div className="px-2 pt-2">
                <div className="rounded-lg overflow-hidden border border-gray-800 bg-black">
                  <PreviewPlayer
                    shots={shots}
                    currentShotId={selectedShotId}
                    onCurrentShotChange={(id) => setSelectedShotId(id)}
                  />
                </div>
              </div>

              {/* 口型同步指示器 */}
              <div className="px-3 py-2 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${lipSyncActive ? 'bg-green-400 animate-pulse' : 'bg-gray-700'}`} />
                <span className="text-[11px] text-gray-400">
                  {lipSyncActive ? '口型同步已就绪' : '口型同步未激活'}
                </span>
                {selectedShot && (
                  <span className="text-[10px] text-gray-600 ml-auto">
                    {(() => {
                      const profile = profiles.find((p) => {
                        const text = `${selectedShot.dialogue_script || ''} ${selectedShot.description || ''}`
                        return text.includes(p.base_name || p.display_name)
                      })
                      return profile ? profile.lip_sync_style : '--'
                    })()}
                  </span>
                )}
              </div>

              {/* 试听状态 */}
              {auditioning && (
                <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-indigo-950/40 border border-indigo-800/40 flex items-center gap-2">
                  {auditionAudioRef.current && !auditionAudioRef.current.paused ? (
                    <Volume2 className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                  ) : (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                  )}
                  <span className="text-[11px] text-indigo-300">
                    {auditionAudioRef.current && !auditionAudioRef.current.paused ? '正在播放试听...' : '正在合成语音...'}
                  </span>
                </div>
              )}
              {!auditioning && auditionError && (
                <div className="mx-3 mb-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-800/40 flex items-center gap-2">
                  <span className="text-[11px] text-red-300 flex-1">{auditionError}</span>
                  <button
                    onClick={() => setAuditionError(null)}
                    className="text-[10px] text-red-400 hover:text-red-200 transition-colors shrink-0"
                  >
                    关闭
                  </button>
                </div>
              )}

              {/* 镜头详情（选中镜头时） */}
              <div className="flex-1 overflow-y-auto border-t border-gray-800 mt-1">
                {selectedShot && showShotDetail ? (
                  <ShotDetailPanel
                    shot={selectedShot}
                    elements={sharedElements}
                    onGenerateAsset={handleGenerateAsset}
                    onInpaint={handleInpaint}
                    onUpdate={handleUpdateShot}
                    onCollapse={() => setShowShotDetail(false)}
                    onClose={() => {
                      setShowShotDetail(false)
                      setSelectedShotId(null)
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-32 text-xs text-gray-600">
                    {shots.length > 0 ? '点击镜头查看详情' : '暂无镜头'}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ===== 底部角色阶段时间线 ===== */}
      <div className="shrink-0 h-28 border-t border-gray-800 bg-gray-950/90">
        <div className="h-full flex flex-col">
          <div className="px-3 py-1 border-b border-gray-800/60 flex items-center gap-2">
            <Users className="w-3 h-3 text-indigo-400" />
            <span className="text-[10px] font-semibold text-gray-400">角色阶段时间线</span>
            <span className="text-[9px] text-gray-600">
              {profiles.length} 角色 · {shots.length} 镜头
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <CharacterStageTimeline profiles={profiles} shots={shots} />
          </div>
        </div>
      </div>

      {/* ===== 生成进度指示 ===== */}
      {(store.generating || store.planning) && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50">
          <div className="rounded-2xl border border-indigo-700/60 bg-gradient-to-b from-indigo-950/80 to-gray-950 px-5 py-3 shadow-2xl backdrop-blur flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
            <div>
              <p className="text-xs font-semibold text-indigo-100">
                {store.planning ? '分镜规划中' : '批量生成中'}
              </p>
              <p className="text-[11px] text-gray-400">
                {store.generationMessage || '正在处理...'}
              </p>
            </div>
            {store.generationProgress.percent > 0 && (
              <div className="w-20 h-1.5 rounded-full bg-gray-800 overflow-hidden ml-2">
                <div
                  className="h-full bg-indigo-400 transition-all duration-300"
                  style={{ width: `${Math.min(100, store.generationProgress.percent)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 创建对话框 ===== */}
      {showCreateDialog && (
        <CreateDigitalHumanDialog
          creating={store.creating}
          onClose={() => setShowCreateDialog(false)}
          onSubmit={handleCreateSeries}
        />
      )}
    </div>
  )
}

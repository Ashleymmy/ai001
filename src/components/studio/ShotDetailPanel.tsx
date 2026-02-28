/**
 * 镜头详情面板 & 辅助组件
 * 从 StudioPage.tsx 拆分而来
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'
import {
  ImageIcon, Video, Mic, Sparkles, Loader2, ChevronRight, X,
} from 'lucide-react'
import type { StudioShot, StudioElement } from '../../store/studioStore'
import type { StudioPromptAnalysis } from '../../services/api'
import { studioPromptCheck, studioPromptOptimize } from '../../services/api'
import InpaintCanvas from './InpaintCanvas'

// ============================================================
// PromptFieldKey 类型 & 元数据
// ============================================================

export type PromptFieldKey = 'prompt' | 'key_frame_prompt' | 'end_prompt' | 'video_prompt'

export const PROMPT_FIELD_META: Array<{ field: PromptFieldKey; label: string }> = [
  { field: 'prompt', label: '起始帧提示词' },
  { field: 'key_frame_prompt', label: '关键帧提示词' },
  { field: 'end_prompt', label: '尾帧提示词' },
  { field: 'video_prompt', label: '视频提示词' },
]

export function isPromptFieldKey(value: string): value is PromptFieldKey {
  return value === 'prompt' || value === 'key_frame_prompt' || value === 'end_prompt' || value === 'video_prompt'
}

// ============================================================
// VisualActionDesigner 内部依赖
// ============================================================

const GRID_POSITIONS = [
  'TL', 'TC', 'TR',
  'ML', 'MC', 'MR',
  'BL', 'BC', 'BR',
] as const

type GridPosition = typeof GRID_POSITIONS[number]

type DirectorActionState = {
  subject: string
  from: GridPosition
  to: GridPosition
  path: string
  shotSize: string
  angle: string
  movement: string
  lensMm: string
  speed: string
  beatsText: string
}

const CAMERA_SHOT_SIZE_OPTIONS = ['大全景', '全景', '中景', '中近景', '近景', '特写']
const CAMERA_ANGLE_OPTIONS = ['平视', '低机位', '高机位', '俯拍', '仰拍']
const CAMERA_MOVEMENT_OPTIONS = ['固定机位', '推镜', '拉镜', '摇镜', '移镜', '跟拍', '环绕']
const BLOCKING_PATH_OPTIONS = ['直线', '弧线', '折线', '环绕', '不规则']
const CAMERA_SPEED_OPTIONS = ['慢', '中', '快', '急促']

function parseDirectorAction(value: Record<string, unknown>): DirectorActionState {
  const blocking = value.blocking && typeof value.blocking === 'object'
    ? value.blocking as Record<string, unknown>
    : {}
  const camera = value.camera && typeof value.camera === 'object'
    ? value.camera as Record<string, unknown>
    : {}
  const beatsRaw = Array.isArray(value.beats) ? value.beats : []
  const beatsText = beatsRaw
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .join('\n')

  const asGrid = (raw: unknown, fallback: GridPosition): GridPosition => {
    const text = String(raw || '').trim().toUpperCase()
    if ((GRID_POSITIONS as readonly string[]).includes(text)) return text as GridPosition
    return fallback
  }

  return {
    subject: String(value.subject || '主体').trim() || '主体',
    from: asGrid(blocking.from ?? value.from, 'MC'),
    to: asGrid(blocking.to ?? value.to, 'TR'),
    path: String(blocking.path || '直线').trim() || '直线',
    shotSize: String(camera.shot_size || '中景').trim() || '中景',
    angle: String(camera.angle || '平视').trim() || '平视',
    movement: String(camera.movement || value.motion || '推镜').trim() || '推镜',
    lensMm: String(camera.lens_mm || '35').trim() || '35',
    speed: String(camera.speed || '中').trim() || '中',
    beatsText,
  }
}

function buildDirectorGeneratedText(state: DirectorActionState): string {
  const beats = state.beatsText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
  const beatsPart = beats.length > 0 ? `关键节拍：${beats.join('；')}` : '关键节拍：无'
  return `${state.subject} 从画面 ${state.from} 经 ${state.path} 走位至 ${state.to}；运镜采用${state.movement}，景别${state.shotSize}，机位${state.angle}，镜头约 ${state.lensMm}mm，节奏${state.speed}。${beatsPart}。`
}

function buildDirectorActionPayload(state: DirectorActionState): Record<string, unknown> {
  const beats = state.beatsText
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
  return {
    subject: state.subject,
    blocking: {
      from: state.from,
      to: state.to,
      path: state.path,
    },
    camera: {
      shot_size: state.shotSize,
      angle: state.angle,
      movement: state.movement,
      lens_mm: Number(state.lensMm) || 35,
      speed: state.speed,
    },
    beats,
    generated_text: buildDirectorGeneratedText(state),
  }
}

// ============================================================
// VisualActionDesigner
// ============================================================

function VisualActionDesigner({
  value,
  onChange,
  onApplyToPrompt,
}: {
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  onApplyToPrompt: (text: string) => void
}) {
  const [designer, setDesigner] = useState<DirectorActionState>(() => parseDirectorAction(value))
  const [pickTarget, setPickTarget] = useState<'from' | 'to'>('from')

  useEffect(() => {
    setDesigner(parseDirectorAction(value))
  }, [value])

  const persist = (patch?: Partial<DirectorActionState>) => {
    const next = patch ? { ...designer, ...patch } : designer
    if (patch) setDesigner(next)
    onChange(buildDirectorActionPayload(next))
  }

  return (
    <div className="p-3 rounded-lg border border-gray-800 bg-gray-900/70 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-300">导演级视觉动作设计（3×3）</p>
        <button
          onClick={() => {
            persist()
            onApplyToPrompt(`导演运镜要求: ${buildDirectorGeneratedText(designer)}`)
          }}
          className="text-xs px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white"
        >
          应用到视频提示词
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1 w-36">
        {GRID_POSITIONS.map((pos) => {
          const isFrom = pos === designer.from
          const isTo = pos === designer.to
          return (
            <button
              key={pos}
              onClick={() => {
                if (pickTarget === 'from') {
                  persist({ from: pos })
                } else {
                  persist({ to: pos })
                }
              }}
              className={`h-8 text-[10px] rounded border ${
                isFrom ? 'border-blue-400 bg-blue-900/30 text-blue-200' :
                isTo ? 'border-green-400 bg-green-900/30 text-green-200' :
                'border-gray-700 bg-gray-800 text-gray-500'
              }`}
              title={pos}
            >
              {pos}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setPickTarget('from')}
          className={`text-xs px-2 py-1 rounded ${pickTarget === 'from' ? 'bg-blue-700/50 text-blue-100' : 'bg-gray-800 text-gray-400'}`}
        >
          点击网格设置起点
        </button>
        <button
          onClick={() => setPickTarget('to')}
          className={`text-xs px-2 py-1 rounded ${pickTarget === 'to' ? 'bg-green-700/50 text-green-100' : 'bg-gray-800 text-gray-400'}`}
        >
          点击网格设置终点
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={designer.subject}
          onChange={(e) => setDesigner((prev) => ({ ...prev, subject: e.target.value }))}
          onBlur={() => persist()}
          placeholder="主体"
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        />
        <select
          value={designer.path}
          onChange={(e) => persist({ path: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {BLOCKING_PATH_OPTIONS.map((option) => <option key={option} value={option}>走位路径 {option}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={designer.shotSize}
          onChange={(e) => persist({ shotSize: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {CAMERA_SHOT_SIZE_OPTIONS.map((option) => <option key={option} value={option}>景别 {option}</option>)}
        </select>
        <select
          value={designer.angle}
          onChange={(e) => persist({ angle: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {CAMERA_ANGLE_OPTIONS.map((option) => <option key={option} value={option}>机位 {option}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={designer.movement}
          onChange={(e) => persist({ movement: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {CAMERA_MOVEMENT_OPTIONS.map((option) => <option key={option} value={option}>运镜 {option}</option>)}
        </select>
        <input
          value={designer.lensMm}
          onChange={(e) => setDesigner((prev) => ({ ...prev, lensMm: e.target.value }))}
          onBlur={() => persist()}
          placeholder="镜头焦距 (mm)"
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={designer.from}
          onChange={(e) => {
            const next = (e.target.value.toUpperCase() as GridPosition)
            persist({ from: next })
          }}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {GRID_POSITIONS.map((p) => <option key={p} value={p}>起点 {p}</option>)}
        </select>
        <select
          value={designer.to}
          onChange={(e) => {
            const next = (e.target.value.toUpperCase() as GridPosition)
            persist({ to: next })
          }}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {GRID_POSITIONS.map((p) => <option key={p} value={p}>终点 {p}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={designer.speed}
          onChange={(e) => persist({ speed: e.target.value })}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
        >
          {CAMERA_SPEED_OPTIONS.map((option) => <option key={option} value={option}>节奏 {option}</option>)}
        </select>
        <textarea
          value={designer.beatsText}
          onChange={(e) => setDesigner((prev) => ({ ...prev, beatsText: e.target.value }))}
          onBlur={() => persist()}
          placeholder="关键节拍（每行一条）"
          rows={2}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
        />
      </div>
      <p className="text-xs text-gray-400">{buildDirectorGeneratedText(designer)}</p>
    </div>
  )
}

// ============================================================
// DetailField
// ============================================================

function DetailField({
  label,
  value,
  onChange,
  onBlur,
  multiline = false,
  footer,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur: () => void
  multiline?: boolean
  footer?: ReactNode
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {multiline ? (
        <textarea
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-none"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      ) : (
        <input
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      )}
      {footer}
    </div>
  )
}

// ============================================================
// 镜头详情面板
// ============================================================

function ShotDetailPanel({
  shot,
  elements,
  onGenerateAsset,
  imageGeneration,
  onInpaint,
  onUpdate,
  onCollapse,
  onClose,
}: {
  shot: StudioShot
  elements: StudioElement[]
  onGenerateAsset: (
    stage: 'frame' | 'key_frame' | 'end_frame' | 'video' | 'audio',
    options?: { width?: number; height?: number }
  ) => void | Promise<void>
  imageGeneration?: { ratioLabel: string; width: number; height: number }
  onInpaint: (payload: { editPrompt: string; maskData?: string }) => void | Promise<void>
  onUpdate: (updates: Record<string, unknown>) => void
  onCollapse: () => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [inpaintPrompt, setInpaintPrompt] = useState((shot.prompt || shot.description || '').trim())
  const [maskData, setMaskData] = useState('')
  const [inpainting, setInpainting] = useState(false)
  const [promptAnalysis, setPromptAnalysis] = useState<Partial<Record<PromptFieldKey, StudioPromptAnalysis>>>({})
  const [checkingPromptField, setCheckingPromptField] = useState<Partial<Record<PromptFieldKey, boolean>>>({})
  const [optimizingPromptField, setOptimizingPromptField] = useState<PromptFieldKey | null>(null)
  const promptCheckTimerRef = useRef<Partial<Record<PromptFieldKey, number>>>({})

  useEffect(() => {
    setInpaintPrompt((shot.prompt || shot.description || '').trim())
    setMaskData('')
    setInpainting(false)
  }, [shot.id, shot.prompt, shot.description])

  const handleSave = (field: string) => {
    if (editing[field] !== undefined) {
      onUpdate({ [field]: editing[field] })
      setEditing((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  const fieldValue = (field: string) =>
    editing[field] !== undefined ? editing[field] : (shot as unknown as Record<string, unknown>)[field] as string || ''

  const handleInpaint = async () => {
    const prompt = inpaintPrompt.trim()
    if (!shot.start_image_url || !prompt) return
    setInpainting(true)
    try {
      await onInpaint({
        editPrompt: prompt,
        maskData: maskData.trim() || undefined,
      })
    } finally {
      setInpainting(false)
    }
  }

  const runPromptCheck = useCallback(async (field: PromptFieldKey, value: string) => {
    const prompt = value.trim()
    if (!prompt) {
      setPromptAnalysis((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
      setCheckingPromptField((prev) => ({ ...prev, [field]: false }))
      return
    }
    setCheckingPromptField((prev) => ({ ...prev, [field]: true }))
    try {
      const analysis = await studioPromptCheck(prompt)
      setPromptAnalysis((prev) => ({ ...prev, [field]: analysis }))
    } catch {
      // ignore prompt-check transient errors in local field validation
    } finally {
      setCheckingPromptField((prev) => ({ ...prev, [field]: false }))
    }
  }, [])

  const schedulePromptCheck = useCallback((field: PromptFieldKey, value: string) => {
    const timer = promptCheckTimerRef.current[field]
    if (timer) {
      window.clearTimeout(timer)
    }
    promptCheckTimerRef.current[field] = window.setTimeout(() => {
      void runPromptCheck(field, value)
    }, 720)
  }, [runPromptCheck])

  const optimizePromptField = useCallback(async (field: PromptFieldKey) => {
    const current = fieldValue(field).trim()
    if (!current) return

    setOptimizingPromptField(field)
    try {
      const optimized = await studioPromptOptimize(current, { use_llm: true })
      const nextPrompt = (optimized.optimized_prompt || current).trim()
      setEditing((prev) => ({ ...prev, [field]: nextPrompt }))
      onUpdate({ [field]: nextPrompt })
      await runPromptCheck(field, nextPrompt)
    } finally {
      setOptimizingPromptField(null)
    }
  }, [onUpdate, runPromptCheck, fieldValue])

  useEffect(() => {
    const timers = promptCheckTimerRef.current
    return () => {
      Object.values(timers).forEach((timer) => {
        if (timer) window.clearTimeout(timer)
      })
    }
  }, [])

  useEffect(() => {
    Object.values(promptCheckTimerRef.current).forEach((timer) => {
      if (timer) window.clearTimeout(timer)
    })
    promptCheckTimerRef.current = {}
    setPromptAnalysis({})
    setCheckingPromptField({})
    setOptimizingPromptField(null)
    PROMPT_FIELD_META.forEach((meta) => {
      const value = String((shot as unknown as Record<string, unknown>)[meta.field] || '')
      if (value.trim()) {
        void runPromptCheck(meta.field, value)
      }
    })
  }, [runPromptCheck, shot.id, shot.prompt, shot.key_frame_prompt, shot.end_prompt, shot.video_prompt])

  const renderPromptFieldFooter = (field: PromptFieldKey) => {
    const checking = Boolean(checkingPromptField[field])
    const analysis = promptAnalysis[field]
    const hasRisk = Boolean(analysis && !analysis.safe && analysis.matches.length > 0)
    return (
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
            {checking ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin text-gray-500" />
                检测中...
              </>
            ) : analysis ? (
              analysis.safe ? (
                <span className="text-emerald-300">安全</span>
              ) : (
                <span className="text-amber-300">命中 {analysis.matches.length} 项风险</span>
              )
            ) : (
              <span className="text-gray-500">输入后自动检测</span>
            )}
          </div>
          {hasRisk && (
            <button
              onClick={() => void optimizePromptField(field)}
              disabled={optimizingPromptField === field}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] bg-amber-700/65 hover:bg-amber-600/75 text-white disabled:opacity-50 transition-colors"
            >
              {optimizingPromptField === field ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              一键优化
            </button>
          )}
        </div>
        {hasRisk && analysis && analysis.suggestions.length > 0 && (
          <p className="text-[10px] text-gray-400 leading-relaxed">
            建议：{analysis.suggestions.slice(0, 3).map((item) => `${item.source}→${item.replacement}`).join('；')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-200">{shot.name || '镜头详情'}</h4>
        <div className="flex items-center gap-1">
          <button onClick={onCollapse} className="text-gray-500 hover:text-white" title="收起详情面板">
            <ChevronRight className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="text-gray-500 hover:text-white" title="关闭详情">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onGenerateAsset('frame', imageGeneration)}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-center gap-1"
        >
          <ImageIcon className="w-3 h-3" />
          {shot.start_image_url ? '重做首帧' : '生成首帧'}
        </button>
        <button
          onClick={() => onGenerateAsset('key_frame', imageGeneration)}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-yellow-300 flex items-center justify-center gap-1"
        >
          <ImageIcon className="w-3 h-3" />
          {shot.key_frame_url ? '重做关键帧' : '生成关键帧'}
        </button>
        <button
          onClick={() => onGenerateAsset('end_frame', imageGeneration)}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-center gap-1"
        >
          <ImageIcon className="w-3 h-3" />
          {shot.end_image_url ? '重做尾帧' : '生成尾帧'}
        </button>
        <button
          onClick={() => onGenerateAsset('video')}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-center gap-1"
        >
          <Video className="w-3 h-3" />
          {shot.video_url ? '重做视频' : '生成视频'}
        </button>
        <button
          onClick={() => onGenerateAsset('audio')}
          className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center justify-center gap-1 col-span-2"
        >
          <Mic className="w-3 h-3" />
          {shot.audio_url ? '重做音频' : '生成音频'}
        </button>
      </div>
      {imageGeneration && (
        <p className="text-[11px] text-gray-500 -mt-2">
          出图比例: {imageGeneration.ratioLabel} ({imageGeneration.width}x{imageGeneration.height})
        </p>
      )}

      <div className="p-3 rounded-lg border border-gray-800 bg-gray-900/70 space-y-2">
        <p className="text-xs font-medium text-gray-300">局部重绘（Inpaint）</p>
        <textarea
          rows={3}
          value={inpaintPrompt}
          onChange={(e) => setInpaintPrompt(e.target.value)}
          placeholder="描述需要修改的局部效果，例如：将人物手中的道具改为折扇，保持服饰和背景不变"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-purple-500 resize-y"
        />
        {shot.start_image_url ? (
          <InpaintCanvas
            imageUrl={shot.start_image_url}
            maskData={maskData}
            onMaskChange={setMaskData}
          />
        ) : (
          <p className="text-[11px] text-gray-500">请先生成首帧图后使用画布选区绘制蒙版</p>
        )}
        <button
          onClick={handleInpaint}
          disabled={!shot.start_image_url || !inpaintPrompt.trim() || inpainting}
          className="w-full text-xs px-2 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 flex items-center justify-center gap-1 transition-colors"
        >
          {inpainting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {!shot.start_image_url ? '请先生成首帧' : '执行局部重绘'}
        </button>
      </div>

      {/* 基本信息 */}
      <div className="space-y-3">
        <DetailField
          label="时长（秒）"
          value={String(fieldValue('duration') || '')}
          onChange={(v) => setEditing((p) => ({ ...p, duration: v }))}
          onBlur={() => {
            const raw = editing.duration
            if (raw !== undefined) {
              const duration = Number(raw)
              if (!Number.isNaN(duration) && duration > 0) {
                onUpdate({ duration })
              }
              setEditing((prev) => {
                const next = { ...prev }
                delete next.duration
                return next
              })
            }
          }}
        />
        <DetailField
          label="描述"
          value={fieldValue('description')}
          onChange={(v) => setEditing((p) => ({ ...p, description: v }))}
          onBlur={() => handleSave('description')}
          multiline
        />

        {/* 影视参数选择器 */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-gray-500 mb-0.5 block">景别</label>
            <select
              value={fieldValue('shot_size')}
              onChange={(e) => onUpdate({ shot_size: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">—</option>
              <option value="extreme_long">大远景 (ELS)</option>
              <option value="long">远景/全景 (LS)</option>
              <option value="medium">中景 (MS)</option>
              <option value="medium_close">中近景 (MCU)</option>
              <option value="close_up">近景/特写 (CU)</option>
              <option value="extreme_close">大特写 (ECU)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 mb-0.5 block">运镜</label>
            <select
              value={fieldValue('camera_movement')}
              onChange={(e) => onUpdate({ camera_movement: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">—</option>
              <option value="fixed">固定镜头</option>
              <option value="push">推镜</option>
              <option value="pull">拉镜</option>
              <option value="pan">摇镜</option>
              <option value="follow">跟镜</option>
              <option value="tracking">移镜</option>
              <option value="orbit">环绕</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 mb-0.5 block">机位角度</label>
            <select
              value={fieldValue('camera_angle')}
              onChange={(e) => onUpdate({ camera_angle: e.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
            >
              <option value="">—</option>
              <option value="eye_level">平视</option>
              <option value="low_angle">仰拍</option>
              <option value="high_angle">俯拍</option>
              <option value="dutch">荷兰角</option>
              <option value="overhead">顶拍</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 mb-0.5 block">情绪强度</label>
            <select
              value={String(fieldValue('emotion_intensity') || '0')}
              onChange={(e) => onUpdate({ emotion_intensity: Number(e.target.value) })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
            >
              <option value="3">极强 ↑↑↑</option>
              <option value="2">强 ↑↑</option>
              <option value="1">中 ↑</option>
              <option value="0">平稳 →</option>
              <option value="-1">弱 ↓</option>
            </select>
          </div>
        </div>
        <DetailField
          label="情绪关键词"
          value={fieldValue('emotion')}
          onChange={(v) => setEditing((p) => ({ ...p, emotion: v }))}
          onBlur={() => handleSave('emotion')}
        />

        <DetailField
          label="起始帧提示词"
          value={fieldValue('prompt')}
          onChange={(v) => {
            setEditing((p) => ({ ...p, prompt: v }))
            schedulePromptCheck('prompt', v)
          }}
          onBlur={() => handleSave('prompt')}
          multiline
          footer={renderPromptFieldFooter('prompt')}
        />
        <DetailField
          label="关键帧提示词"
          value={fieldValue('key_frame_prompt')}
          onChange={(v) => {
            setEditing((p) => ({ ...p, key_frame_prompt: v }))
            schedulePromptCheck('key_frame_prompt', v)
          }}
          onBlur={() => handleSave('key_frame_prompt')}
          multiline
          footer={renderPromptFieldFooter('key_frame_prompt')}
        />
        <DetailField
          label="尾帧提示词"
          value={fieldValue('end_prompt')}
          onChange={(v) => {
            setEditing((p) => ({ ...p, end_prompt: v }))
            schedulePromptCheck('end_prompt', v)
          }}
          onBlur={() => handleSave('end_prompt')}
          multiline
          footer={renderPromptFieldFooter('end_prompt')}
        />
        <DetailField
          label="视频提示词"
          value={fieldValue('video_prompt')}
          onChange={(v) => {
            setEditing((p) => ({ ...p, video_prompt: v }))
            schedulePromptCheck('video_prompt', v)
          }}
          onBlur={() => handleSave('video_prompt')}
          multiline
          footer={renderPromptFieldFooter('video_prompt')}
        />
        <DetailField
          label="旁白"
          value={fieldValue('narration')}
          onChange={(v) => setEditing((p) => ({ ...p, narration: v }))}
          onBlur={() => handleSave('narration')}
          multiline
        />
        <DetailField
          label="对白"
          value={fieldValue('dialogue_script')}
          onChange={(v) => setEditing((p) => ({ ...p, dialogue_script: v }))}
          onBlur={() => handleSave('dialogue_script')}
          multiline
        />
        <DetailField
          label="音效信息"
          value={fieldValue('sound_effects')}
          onChange={(v) => setEditing((p) => ({ ...p, sound_effects: v }))}
          onBlur={() => handleSave('sound_effects')}
          multiline
        />
      </div>

      <VisualActionDesigner
        value={(shot.visual_action || {}) as Record<string, unknown>}
        onChange={(visualAction) => onUpdate({ visual_action: visualAction })}
        onApplyToPrompt={(text) => {
          const current = fieldValue('video_prompt')
          const next = current ? `${current}\n${text}` : text
          onUpdate({ video_prompt: next })
        }}
      />

      {(shot.frame_history && shot.frame_history.length > 0) && (
        <div>
          <p className="text-xs text-gray-500 mb-1">首帧历史（{shot.frame_history.length}）</p>
          <div className="grid grid-cols-3 gap-2">
            {shot.frame_history.slice().reverse().map((url, idx) => (
              <button
                key={`${url}_${idx}`}
                onClick={() => onUpdate({ start_image_url: url })}
                className="relative aspect-video rounded border border-gray-700 overflow-hidden hover:border-purple-500"
                title="点击设为当前首帧"
              >
                <img src={url} alt="frame-history" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      {(shot.video_history && shot.video_history.length > 0) && (
        <div>
          <p className="text-xs text-gray-500 mb-1">视频历史（{shot.video_history.length}）</p>
          <div className="space-y-1">
            {shot.video_history.slice().reverse().map((url, idx) => (
              <div key={`${url}_${idx}`} className="flex items-center gap-2">
                <a href={url} target="_blank" rel="noreferrer" className="text-xs text-purple-300 truncate flex-1">
                  {url}
                </a>
                <button
                  onClick={() => onUpdate({ video_url: url })}
                  className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-200"
                >
                  设为当前
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 引用的共享元素 */}
      {elements.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-1">可引用元素（[SE_XXX]）</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {elements.map((el) => (
              <div key={el.id} className="flex items-center gap-2 text-xs text-gray-400">
                <span className="font-mono text-purple-300">[{el.id}]</span>
                <span>{el.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default ShotDetailPanel

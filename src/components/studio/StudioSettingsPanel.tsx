/**
 * Studio 工作台设置面板：服务配置 + 提示词管理
 * 从 StudioPage.tsx 中拆分而来
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Settings2, X, Loader2, Save } from 'lucide-react'
import {
  studioGetSettings,
  studioSaveSettings,
  studioGetPromptTemplateDefaults,
} from '../../services/api'
import { useGenerationQueueStore } from '../../store/generationQueueStore'
import type { GenerationQueueParallelConfig } from '../../store/generationQueueStore'

// ============================================================
// 类型定义
// ============================================================

interface ServiceConfig {
  protocol: string
  apiKey: string
  baseUrl: string
  model: string
}

type StudioTtsProvider =
  | 'volc_tts_v1_http'
  | 'fish_tts_v1'
  | 'aliyun_bailian_tts_v2'
  | 'custom_openai_tts'

interface StudioVolcTtsConfig {
  appid: string
  accessToken: string
  endpoint: string
  cluster: string
  model: string
  encoding: string
  rate: number
  speedRatio: number
  narratorVoiceType: string
  dialogueVoiceType: string
  dialogueMaleVoiceType: string
  dialogueFemaleVoiceType: string
}

interface StudioFishTtsConfig {
  apiKey: string
  baseUrl: string
  model: string
  encoding: string
  rate: number
  speedRatio: number
  narratorVoiceType: string
  dialogueVoiceType: string
  dialogueMaleVoiceType: string
  dialogueFemaleVoiceType: string
}

interface StudioBailianTtsConfig {
  apiKey: string
  baseUrl: string
  workspace: string
  model: string
  encoding: string
  rate: number
  speedRatio: number
  narratorVoiceType: string
  dialogueVoiceType: string
  dialogueMaleVoiceType: string
  dialogueFemaleVoiceType: string
}

interface StudioCustomTtsConfig {
  apiKey: string
  baseUrl: string
  model: string
  encoding: string
  rate: number
  speedRatio: number
  narratorVoiceType: string
  dialogueVoiceType: string
  dialogueMaleVoiceType: string
  dialogueFemaleVoiceType: string
}

interface TTSConfig {
  provider: StudioTtsProvider | string
  volc: StudioVolcTtsConfig
  fish: StudioFishTtsConfig
  bailian: StudioBailianTtsConfig
  custom: StudioCustomTtsConfig
}

interface GenerationDefaults {
  frame_width: number
  frame_height: number
  video_duration_seconds: number
  split_max_tokens: number
  plan_max_tokens: number
  enhance_max_tokens: number
}

type PromptModuleKey =
  | 'script_split'
  | 'element_extraction'
  | 'episode_planning'
  | 'episode_enhance'

interface PromptTemplateConfig {
  system: string
  user: string
}

type CustomPromptsConfig = Record<PromptModuleKey, PromptTemplateConfig>

// ============================================================
// 常量
// ============================================================

// 协议 → 后端 provider 映射
const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI 协议' },
  { value: 'volcano', label: '火山引擎' },
  { value: 'wanxiang', label: '通义万相' },
  { value: 'relay', label: '中转站（OpenAI 兼容）' },
] as const

const BASE_URL_HINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  volcano: 'https://ark.cn-beijing.volces.com/api/v3',
  wanxiang: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  relay: 'https://your-relay.example.com/v1',
}

const MODEL_HINTS: Record<string, Record<string, string>> = {
  llm: {
    openai: 'gpt-4o / gpt-4o-mini',
    volcano: 'doubao-pro-4k / doubao-pro-128k',
    wanxiang: 'qwen-plus / qwen-max',
    relay: '按中转站支持的模型名填写',
  },
  image: {
    openai: 'dall-e-3',
    volcano: '按火山引擎图像模型填写',
    wanxiang: 'wanx-v1 / wanx2.1-t2i-turbo',
    relay: '按中转站支持的模型名填写',
  },
  video: {
    openai: '按 OpenAI 兼容视频模型填写',
    volcano: 'doubao-seedance-1-0-pro-250528 / doubao-seedance-1-5-pro-250926',
    wanxiang: 'wanx2.1-i2v-plus / wanx2.1-i2v-turbo',
    relay: '按中转站支持的视频模型名填写',
  },
}

// 协议值 → 后端实际 provider 值
const PROTOCOL_TO_PROVIDER: Record<string, Record<string, string>> = {
  llm: { openai: 'openai', volcano: 'doubao', wanxiang: 'qwen', relay: 'openai' },
  image: { openai: 'openai', volcano: 'doubao', wanxiang: 'dashscope', relay: 'openai' },
  // Studio 视频统一走 custom 分支，实际路由由 baseUrl 域名自动识别（ark/dashscope/relay）
  video: { openai: 'custom', volcano: 'custom', wanxiang: 'custom', relay: 'custom' },
}

// 后端 provider 值 → 协议值（反向映射，用于加载）
const PROVIDER_TO_PROTOCOL: Record<string, string> = {
  openai: 'openai',
  doubao: 'volcano',
  qwen: 'wanxiang',
  dashscope: 'wanxiang',
  kling: 'volcano',
  'qwen-video': 'wanxiang',
  custom: 'relay',
  // 其他一律归为中转站
}

const DEFAULT_STUDIO_TTS: TTSConfig = {
  provider: 'volc_tts_v1_http',
  volc: {
    appid: '',
    accessToken: '',
    endpoint: 'https://openspeech.bytedance.com/api/v1/tts',
    cluster: 'volcano_tts',
    model: 'seed-tts-1.1',
    encoding: 'mp3',
    rate: 24000,
    speedRatio: 1,
    narratorVoiceType: '',
    dialogueVoiceType: '',
    dialogueMaleVoiceType: '',
    dialogueFemaleVoiceType: '',
  },
  fish: {
    apiKey: '',
    baseUrl: 'https://api.fish.audio',
    model: 'speech-1.5',
    encoding: 'mp3',
    rate: 24000,
    speedRatio: 1,
    narratorVoiceType: '',
    dialogueVoiceType: '',
    dialogueMaleVoiceType: '',
    dialogueFemaleVoiceType: '',
  },
  bailian: {
    apiKey: '',
    baseUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
    workspace: '',
    model: 'cosyvoice-v1',
    encoding: 'mp3',
    rate: 24000,
    speedRatio: 1,
    narratorVoiceType: '',
    dialogueVoiceType: '',
    dialogueMaleVoiceType: '',
    dialogueFemaleVoiceType: '',
  },
  custom: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-tts',
    encoding: 'mp3',
    rate: 24000,
    speedRatio: 1,
    narratorVoiceType: '',
    dialogueVoiceType: '',
    dialogueMaleVoiceType: '',
    dialogueFemaleVoiceType: '',
  },
}

const PROMPT_MODULE_META: Array<{ key: PromptModuleKey; label: string; description: string }> = [
  {
    key: 'script_split',
    label: '脚本拆分',
    description: '将完整脚本拆分为若干幕',
  },
  {
    key: 'element_extraction',
    label: '元素提取',
    description: '提取角色/场景/道具等共享元素',
  },
  {
    key: 'episode_planning',
    label: '分集规划',
    description: '为单集生成分镜与提示词',
  },
  {
    key: 'episode_enhance',
    label: '分镜增强',
    description: '对既有分镜做 Script Doctor 式增强',
  },
]

const DEFAULT_PROMPT_VARIABLE_HINTS: Record<PromptModuleKey, string[]> = {
  script_split: ['full_script', 'target_episode_count', 'episode_duration_seconds', 'visual_style'],
  element_extraction: ['full_script', 'acts_summary', 'visual_style'],
  episode_planning: [
    'series_name',
    'act_number',
    'episode_title',
    'series_bible',
    'visual_style',
    'shared_elements_list',
    'prev_summary',
    'script_excerpt',
    'next_summary',
    'target_duration_seconds',
    'suggested_shot_count',
  ],
  episode_enhance: ['series_bible', 'shared_elements_list', 'episode_json', 'mode'],
}

// ============================================================
// 工具函数
// ============================================================

function normalizeStudioTtsConfig(raw: unknown): TTSConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_STUDIO_TTS
  const obj = raw as Record<string, unknown>

  const asObj = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' ? value as Record<string, unknown> : {}
  )
  const asText = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    return fallback
  }
  const asNum = (value: unknown, fallback: number): number => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }

  const rawProvider = asText(obj.provider).trim()
  const legacyBase = asText(obj.baseUrl).trim()
  let provider = rawProvider
  if (!provider) {
    if (legacyBase.includes('fish.audio')) provider = 'fish_tts_v1'
    else if (legacyBase.includes('dashscope.aliyuncs.com')) provider = 'aliyun_bailian_tts_v2'
    else provider = 'volc_tts_v1_http'
  }

  const legacyVoice = asText(obj.voiceType).trim()
  const volcRaw = asObj(obj.volc)
  const fishRaw = asObj(obj.fish)
  const bailianRaw = asObj(obj.bailian)
  const customRaw = asObj(obj.custom)

  return {
    provider,
    volc: {
      appid: asText(volcRaw.appid ?? obj.appid, ''),
      accessToken: asText(volcRaw.accessToken ?? obj.accessToken, ''),
      endpoint: asText(volcRaw.endpoint, 'https://openspeech.bytedance.com/api/v1/tts'),
      cluster: asText(volcRaw.cluster ?? obj.cluster, 'volcano_tts'),
      model: asText(volcRaw.model ?? obj.model, 'seed-tts-1.1'),
      encoding: asText(volcRaw.encoding ?? obj.encoding, 'mp3'),
      rate: asNum(volcRaw.rate ?? obj.rate, 24000),
      speedRatio: asNum(volcRaw.speedRatio ?? obj.speedRatio, 1),
      narratorVoiceType: asText(volcRaw.narratorVoiceType ?? obj.narratorVoiceType ?? legacyVoice, ''),
      dialogueVoiceType: asText(volcRaw.dialogueVoiceType ?? obj.dialogueVoiceType, ''),
      dialogueMaleVoiceType: asText(volcRaw.dialogueMaleVoiceType ?? obj.dialogueMaleVoiceType, ''),
      dialogueFemaleVoiceType: asText(volcRaw.dialogueFemaleVoiceType ?? obj.dialogueFemaleVoiceType, ''),
    },
    fish: {
      apiKey: asText(fishRaw.apiKey ?? obj.apiKey ?? (provider === 'fish_tts_v1' ? obj.accessToken : ''), ''),
      baseUrl: asText(fishRaw.baseUrl ?? (legacyBase.includes('fish.audio') ? legacyBase : ''), 'https://api.fish.audio'),
      model: asText(fishRaw.model ?? obj.model, 'speech-1.5'),
      encoding: asText(fishRaw.encoding ?? obj.encoding, 'mp3'),
      rate: asNum(fishRaw.rate ?? obj.rate, 24000),
      speedRatio: asNum(fishRaw.speedRatio ?? obj.speedRatio, 1),
      narratorVoiceType: asText(fishRaw.narratorVoiceType ?? obj.narratorVoiceType ?? (provider === 'fish_tts_v1' ? legacyVoice : ''), ''),
      dialogueVoiceType: asText(fishRaw.dialogueVoiceType ?? obj.dialogueVoiceType, ''),
      dialogueMaleVoiceType: asText(fishRaw.dialogueMaleVoiceType ?? obj.dialogueMaleVoiceType, ''),
      dialogueFemaleVoiceType: asText(fishRaw.dialogueFemaleVoiceType ?? obj.dialogueFemaleVoiceType, ''),
    },
    bailian: {
      apiKey: asText(bailianRaw.apiKey ?? obj.apiKey ?? (provider === 'aliyun_bailian_tts_v2' ? obj.accessToken : ''), ''),
      baseUrl: asText(bailianRaw.baseUrl ?? (legacyBase.includes('dashscope.aliyuncs.com') ? legacyBase : ''), 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'),
      workspace: asText(bailianRaw.workspace, ''),
      model: asText(bailianRaw.model ?? obj.model, 'cosyvoice-v1'),
      encoding: asText(bailianRaw.encoding ?? obj.encoding, 'mp3'),
      rate: asNum(bailianRaw.rate ?? obj.rate, 24000),
      speedRatio: asNum(bailianRaw.speedRatio ?? obj.speedRatio, 1),
      narratorVoiceType: asText(bailianRaw.narratorVoiceType ?? obj.narratorVoiceType ?? (provider === 'aliyun_bailian_tts_v2' ? legacyVoice : ''), ''),
      dialogueVoiceType: asText(bailianRaw.dialogueVoiceType ?? obj.dialogueVoiceType, ''),
      dialogueMaleVoiceType: asText(bailianRaw.dialogueMaleVoiceType ?? obj.dialogueMaleVoiceType, ''),
      dialogueFemaleVoiceType: asText(bailianRaw.dialogueFemaleVoiceType ?? obj.dialogueFemaleVoiceType, ''),
    },
    custom: {
      apiKey: asText(customRaw.apiKey ?? obj.apiKey, ''),
      baseUrl: asText(customRaw.baseUrl ?? obj.baseUrl, 'https://api.openai.com/v1'),
      model: asText(customRaw.model ?? obj.model, 'gpt-4o-mini-tts'),
      encoding: asText(customRaw.encoding ?? obj.encoding, 'mp3'),
      rate: asNum(customRaw.rate ?? obj.rate, 24000),
      speedRatio: asNum(customRaw.speedRatio ?? obj.speedRatio, 1),
      narratorVoiceType: asText(customRaw.narratorVoiceType ?? obj.narratorVoiceType ?? (provider === 'custom_openai_tts' ? legacyVoice : ''), ''),
      dialogueVoiceType: asText(customRaw.dialogueVoiceType ?? obj.dialogueVoiceType, ''),
      dialogueMaleVoiceType: asText(customRaw.dialogueMaleVoiceType ?? obj.dialogueMaleVoiceType, ''),
      dialogueFemaleVoiceType: asText(customRaw.dialogueFemaleVoiceType ?? obj.dialogueFemaleVoiceType, ''),
    },
  }
}

function createEmptyCustomPrompts(): CustomPromptsConfig {
  return {
    script_split: { system: '', user: '' },
    element_extraction: { system: '', user: '' },
    episode_planning: { system: '', user: '' },
    episode_enhance: { system: '', user: '' },
  }
}

function normalizePromptTemplateConfig(raw: unknown): PromptTemplateConfig {
  if (!raw || typeof raw !== 'object') return { system: '', user: '' }
  const obj = raw as Record<string, unknown>
  return {
    system: typeof obj.system === 'string' ? obj.system : '',
    user: typeof obj.user === 'string' ? obj.user : '',
  }
}

function normalizeCustomPrompts(raw: unknown): CustomPromptsConfig {
  const empty = createEmptyCustomPrompts()
  if (!raw || typeof raw !== 'object') return empty
  const obj = raw as Record<string, unknown>
  const normalized: CustomPromptsConfig = { ...empty }
  for (const module of PROMPT_MODULE_META) {
    normalized[module.key] = normalizePromptTemplateConfig(obj[module.key])
  }
  return normalized
}

function normalizePromptVariableHints(raw: unknown): Record<PromptModuleKey, string[]> {
  const normalized: Record<PromptModuleKey, string[]> = { ...DEFAULT_PROMPT_VARIABLE_HINTS }
  if (!raw || typeof raw !== 'object') return normalized
  const obj = raw as Record<string, unknown>
  for (const module of PROMPT_MODULE_META) {
    const list = obj[module.key]
    if (Array.isArray(list)) {
      normalized[module.key] = list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
  }
  return normalized
}

function compactCustomPrompts(raw: CustomPromptsConfig): Record<string, PromptTemplateConfig> {
  const compacted: Record<string, PromptTemplateConfig> = {}
  for (const module of PROMPT_MODULE_META) {
    const value = raw[module.key]
    const system = value.system || ''
    const user = value.user || ''
    if (!system.trim() && !user.trim()) continue
    compacted[module.key] = { system, user }
  }
  return compacted
}

// ============================================================
// ServiceConfigForm 辅助组件
// ============================================================

function ServiceConfigForm({
  title,
  description,
  serviceKey,
  config,
  onChange,
}: {
  title: string
  description: string
  serviceKey: string
  config: ServiceConfig
  onChange: (c: ServiceConfig) => void
}) {
  const urlHint = BASE_URL_HINTS[config.protocol] || ''
  const modelHint = MODEL_HINTS[serviceKey]?.[config.protocol] || ''

  return (
    <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
      <h3 className="text-sm font-semibold text-gray-200 mb-1">{title}</h3>
      <p className="text-xs text-gray-500 mb-3">{description}</p>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">协议</label>
          <select
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            value={config.protocol}
            onChange={(e) => onChange({ ...config, protocol: e.target.value })}
          >
            {PROTOCOL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">API Key</label>
          <input
            type="password"
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            placeholder="sk-..."
            value={config.apiKey}
            onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">Base URL</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            placeholder={urlHint}
            value={config.baseUrl}
            onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs text-gray-400 block mb-1">模型</label>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
            placeholder={modelHint}
            value={config.model}
            onChange={(e) => onChange({ ...config, model: e.target.value })}
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// StudioSettingsPanel 主组件
// ============================================================

function StudioSettingsPanel({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'services' | 'prompts'>('services')
  const [promptModule, setPromptModule] = useState<PromptModuleKey>('script_split')
  const [llm, setLlm] = useState<ServiceConfig>({ protocol: 'openai', apiKey: '', baseUrl: '', model: '' })
  const [image, setImage] = useState<ServiceConfig>({ protocol: 'wanxiang', apiKey: '', baseUrl: '', model: '' })
  const [video, setVideo] = useState<ServiceConfig>({ protocol: 'volcano', apiKey: '', baseUrl: '', model: '' })
  const [tts, setTts] = useState<TTSConfig>(DEFAULT_STUDIO_TTS)
  const [defaults, setDefaults] = useState<GenerationDefaults>({
    frame_width: 1280,
    frame_height: 720,
    video_duration_seconds: 6,
    split_max_tokens: 8000,
    plan_max_tokens: 16000,
    enhance_max_tokens: 16000,
  })
  const [customPrompts, setCustomPrompts] = useState<CustomPromptsConfig>(createEmptyCustomPrompts())
  const [promptDefaults, setPromptDefaults] = useState<CustomPromptsConfig>(createEmptyCustomPrompts())
  const [promptVariableHints, setPromptVariableHints] = useState<Record<PromptModuleKey, string[]>>(DEFAULT_PROMPT_VARIABLE_HINTS)

  // 并发控制
  const PARALLEL_CONFIG_KEY = 'studio.generation.parallelConfig'
  const queueLimits = useGenerationQueueStore((s) => s.limits)
  const setQueueLimits = useGenerationQueueStore((s) => s.setLimits)

  // 挂载时从 localStorage 恢复并发配置
  useEffect(() => {
    try {
      const stored = localStorage.getItem(PARALLEL_CONFIG_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<GenerationQueueParallelConfig>
        setQueueLimits(parsed)
      }
    } catch {
      // ignore parse error
    }
  }, [setQueueLimits])

  const handleConcurrencyChange = useCallback(
    (key: keyof GenerationQueueParallelConfig, value: number) => {
      const updated: Partial<GenerationQueueParallelConfig> = { [key]: value }
      setQueueLimits(updated)
      // 持久化到 localStorage
      try {
        const current = useGenerationQueueStore.getState().limits
        localStorage.setItem(PARALLEL_CONFIG_KEY, JSON.stringify(current))
      } catch {
        // ignore storage error
      }
    },
    [setQueueLimits],
  )

  const currentPromptMeta = useMemo(
    () => PROMPT_MODULE_META.find((item) => item.key === promptModule) || PROMPT_MODULE_META[0],
    [promptModule],
  )
  const currentPromptCustom = customPrompts[promptModule]
  const currentPromptDefaults = promptDefaults[promptModule]
  const currentPromptVariableHints = promptVariableHints[promptModule] || []
  const currentPromptUsesDefault =
    !currentPromptCustom.system.trim() && !currentPromptCustom.user.trim()
  const ttsProvider = (tts.provider || 'volc_tts_v1_http').trim()
  const isVolcTTS = ttsProvider === 'volc_tts_v1_http'
  const isFishTTS = ttsProvider.startsWith('fish')
  const isBailianTTS = ttsProvider === 'aliyun_bailian_tts_v2' || ttsProvider === 'dashscope_tts_v2'
  const isCustomTTS = ttsProvider.startsWith('custom_') || ttsProvider === 'custom_openai_tts'
  const activeTts = isFishTTS ? tts.fish : isBailianTTS ? tts.bailian : isCustomTTS ? tts.custom : tts.volc

  useEffect(() => {
    let mounted = true
    const loadSettings = async () => {
      const [settings, promptDefaultsResp] = await Promise.all([
        studioGetSettings().catch(() => null),
        studioGetPromptTemplateDefaults().catch(() => null),
      ])

      if (!mounted) return

      if (promptDefaultsResp?.custom_prompts) {
        setPromptDefaults(normalizeCustomPrompts(promptDefaultsResp.custom_prompts))
      }
      if (promptDefaultsResp?.variable_hints) {
        setPromptVariableHints(normalizePromptVariableHints(promptDefaultsResp.variable_hints))
      }

      if (!settings) {
        setLoading(false)
        return
      }

      const mapLoad = (raw: Record<string, unknown>, service: 'llm' | 'image' | 'video'): ServiceConfig => {
        const provider = (raw.provider as string) || ''
        const baseUrl = (raw.baseUrl as string) || ''
        let protocol = PROVIDER_TO_PROTOCOL[provider] || (provider ? 'relay' : 'openai')
        if (service === 'video') {
          const lowerBase = baseUrl.toLowerCase()
          const lowerProvider = provider.toLowerCase()
          if (lowerProvider === 'custom' || lowerProvider.startsWith('custom_')) {
            if (lowerBase.includes('ark.cn') || lowerBase.includes('volces.com')) {
              protocol = 'volcano'
            } else if (lowerBase.includes('dashscope')) {
              protocol = 'wanxiang'
            } else {
              protocol = 'relay'
            }
          } else if (lowerProvider === 'kling' && (lowerBase.includes('ark.cn') || lowerBase.includes('volces.com'))) {
            // 兼容历史误映射：provider 被写成 kling，但 baseUrl 实际是火山 Ark
            protocol = 'volcano'
          } else if (lowerProvider === 'qwen-video' || lowerProvider === 'dashscope') {
            protocol = 'wanxiang'
          }
        }
        return {
          protocol,
          apiKey: (raw.apiKey as string) || '',
          baseUrl,
          model: (raw.model as string) || '',
        }
      }
      if (settings.llm) setLlm(mapLoad(settings.llm as Record<string, unknown>, 'llm'))
      if (settings.image) setImage(mapLoad(settings.image as Record<string, unknown>, 'image'))
      if (settings.video) setVideo(mapLoad(settings.video as Record<string, unknown>, 'video'))
      if (settings.tts) setTts(normalizeStudioTtsConfig(settings.tts))
      if (settings.generation_defaults && typeof settings.generation_defaults === 'object') {
        const raw = settings.generation_defaults as Record<string, unknown>
        setDefaults((prev) => ({
          frame_width: Number(raw.frame_width) || prev.frame_width,
          frame_height: Number(raw.frame_height) || prev.frame_height,
          video_duration_seconds: Number(raw.video_duration_seconds) || prev.video_duration_seconds,
          split_max_tokens: Number(raw.split_max_tokens) || prev.split_max_tokens,
          plan_max_tokens: Number(raw.plan_max_tokens) || prev.plan_max_tokens,
          enhance_max_tokens: Number(raw.enhance_max_tokens) || prev.enhance_max_tokens,
        }))
      }

      if (settings.custom_prompts) {
        setCustomPrompts(normalizeCustomPrompts(settings.custom_prompts))
      }
      setLoading(false)
    }

    loadSettings().catch(() => {
      if (mounted) setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  const updateCustomPrompt = useCallback(
    (module: PromptModuleKey, field: keyof PromptTemplateConfig, value: string) => {
      setCustomPrompts((prev) => ({
        ...prev,
        [module]: {
          ...prev[module],
          [field]: value,
        },
      }))
    },
    [],
  )

  const handleSave = async () => {
    setSaving(true)
    try {
      // 协议转换为后端 provider
      const mapSave = (cfg: ServiceConfig, service: string) => ({
        provider: PROTOCOL_TO_PROVIDER[service]?.[cfg.protocol] || cfg.protocol,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
      })
      await studioSaveSettings({
        llm: mapSave(llm, 'llm'),
        image: mapSave(image, 'image'),
        video: mapSave(video, 'video'),
        tts,
        generation_defaults: defaults,
        custom_prompts: compactCustomPrompts(customPrompts),
      })
      onClose()
    } catch (e) {
      console.error('保存设置失败:', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-6xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-100 flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-purple-400" />
            Studio 工作台设置
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          </div>
        ) : (
          <div className="space-y-6">
            <p className="text-xs text-gray-500">
              Studio 工作台拥有独立配置，不与 Agent / Module 共享。未配置时自动复用 Module 设置。
            </p>

            <div className="inline-flex bg-gray-800/70 border border-gray-700 rounded-lg p-1">
              <button
                onClick={() => setActiveTab('services')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  activeTab === 'services'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                服务配置
              </button>
              <button
                onClick={() => setActiveTab('prompts')}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  activeTab === 'prompts'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-gray-700'
                }`}
              >
                提示词管理
              </button>
            </div>

            {activeTab === 'services' ? (
              <div className="space-y-6">
                <ServiceConfigForm
                  title="LLM 大语言模型"
                  description="用于脚本分幕、元素提取、分镜规划"
                  serviceKey="llm"
                  config={llm}
                  onChange={setLlm}
                />

                <ServiceConfigForm
                  title="图像生成"
                  description="用于共享元素参考图、镜头起始帧"
                  serviceKey="image"
                  config={image}
                  onChange={setImage}
                />

                <ServiceConfigForm
                  title="视频生成"
                  description="用于镜头视频生成"
                  serviceKey="video"
                  config={video}
                  onChange={setVideo}
                />

                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">语音合成（TTS）</h3>
                  <p className="text-xs text-gray-500 mb-3">用于镜头旁白/对白音频生成</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Provider</label>
                      <select
                        value={ttsProvider}
                        onChange={(e) => setTts((prev) => ({ ...prev, provider: e.target.value }))}
                        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                      >
                        {isCustomTTS && ttsProvider !== 'custom_openai_tts' && (
                          <option value={ttsProvider}>{`自定义（${ttsProvider}）`}</option>
                        )}
                        <option value="volc_tts_v1_http">Volc OpenSpeech</option>
                        <option value="fish_tts_v1">Fish Audio</option>
                        <option value="aliyun_bailian_tts_v2">阿里百炼（DashScope）</option>
                        <option value="custom_openai_tts">自定义（OpenAI 兼容）</option>
                      </select>
                    </div>

                    {isVolcTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">App ID</label>
                          <input
                            value={tts.volc.appid}
                            onChange={(e) => setTts((prev) => ({ ...prev, volc: { ...prev.volc, appid: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="火山引擎 App ID"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Access Token</label>
                          <input
                            type="password"
                            value={tts.volc.accessToken}
                            onChange={(e) => setTts((prev) => ({ ...prev, volc: { ...prev.volc, accessToken: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="火山引擎 Access Token"
                          />
                        </div>
                      </div>
                    )}

                    {isFishTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">API Key</label>
                          <input
                            type="password"
                            value={tts.fish.apiKey}
                            onChange={(e) => setTts((prev) => ({ ...prev, fish: { ...prev.fish, apiKey: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="Fish API Key"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Base URL</label>
                          <input
                            value={tts.fish.baseUrl}
                            onChange={(e) => setTts((prev) => ({ ...prev, fish: { ...prev.fish, baseUrl: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="https://api.fish.audio"
                          />
                        </div>
                      </div>
                    )}

                    {isBailianTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">API Key</label>
                          <input
                            type="password"
                            value={tts.bailian.apiKey}
                            onChange={(e) => setTts((prev) => ({ ...prev, bailian: { ...prev.bailian, apiKey: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="阿里百炼 API Key"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">WebSocket URL</label>
                          <input
                            value={tts.bailian.baseUrl}
                            onChange={(e) => setTts((prev) => ({ ...prev, bailian: { ...prev.bailian, baseUrl: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="wss://dashscope.aliyuncs.com/api-ws/v1/inference"
                          />
                        </div>
                      </div>
                    )}

                    {isCustomTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">API Key</label>
                          <input
                            type="password"
                            value={tts.custom.apiKey}
                            onChange={(e) => setTts((prev) => ({ ...prev, custom: { ...prev.custom, apiKey: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="OpenAI 兼容 API Key"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Base URL</label>
                          <input
                            value={tts.custom.baseUrl}
                            onChange={(e) => setTts((prev) => ({ ...prev, custom: { ...prev.custom, baseUrl: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="https://your-host/v1"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">模型</label>
                        <input
                          value={activeTts.model}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, model: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, model: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, model: v } }
                              return { ...prev, volc: { ...prev.volc, model: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isVolcTTS ? 'seed-tts-1.1' : isFishTTS ? 'speech-1.5' : isBailianTTS ? 'cosyvoice-v1' : 'gpt-4o-mini-tts'}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">编码</label>
                        <input
                          value={activeTts.encoding}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, encoding: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, encoding: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, encoding: v } }
                              return { ...prev, volc: { ...prev.volc, encoding: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder="mp3 / wav / pcm / opus"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">采样率</label>
                        <input
                          type="number"
                          value={activeTts.rate}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10) || 24000
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, rate: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, rate: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, rate: v } }
                              return { ...prev, volc: { ...prev.volc, rate: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder="24000"
                        />
                      </div>
                    </div>

                    {isVolcTTS && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Endpoint</label>
                          <input
                            value={tts.volc.endpoint}
                            onChange={(e) => setTts((prev) => ({ ...prev, volc: { ...prev.volc, endpoint: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="https://openspeech.bytedance.com/api/v1/tts"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Cluster</label>
                          <input
                            value={tts.volc.cluster}
                            onChange={(e) => setTts((prev) => ({ ...prev, volc: { ...prev.volc, cluster: e.target.value } }))}
                            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                            placeholder="volcano_tts"
                          />
                        </div>
                      </div>
                    )}

                    {isBailianTTS && (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Workspace（可选）</label>
                        <input
                          value={tts.bailian.workspace}
                          onChange={(e) => setTts((prev) => ({ ...prev, bailian: { ...prev.bailian, workspace: e.target.value } }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder="workspace id"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">旁白音色</label>
                        <input
                          value={activeTts.narratorVoiceType}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, narratorVoiceType: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, narratorVoiceType: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, narratorVoiceType: v } }
                              return { ...prev, volc: { ...prev.volc, narratorVoiceType: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">对白（男）</label>
                        <input
                          value={activeTts.dialogueMaleVoiceType}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, dialogueMaleVoiceType: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, dialogueMaleVoiceType: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, dialogueMaleVoiceType: v } }
                              return { ...prev, volc: { ...prev.volc, dialogueMaleVoiceType: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">对白（女）</label>
                        <input
                          value={activeTts.dialogueFemaleVoiceType}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, dialogueFemaleVoiceType: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, dialogueFemaleVoiceType: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, dialogueFemaleVoiceType: v } }
                              return { ...prev, volc: { ...prev.volc, dialogueFemaleVoiceType: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">对白（通用）</label>
                        <input
                          value={activeTts.dialogueVoiceType}
                          onChange={(e) => {
                            const v = e.target.value
                            setTts((prev) => {
                              if (isFishTTS) return { ...prev, fish: { ...prev.fish, dialogueVoiceType: v } }
                              if (isBailianTTS) return { ...prev, bailian: { ...prev.bailian, dialogueVoiceType: v } }
                              if (isCustomTTS) return { ...prev, custom: { ...prev.custom, dialogueVoiceType: v } }
                              return { ...prev, volc: { ...prev.volc, dialogueVoiceType: v } }
                            })
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                          placeholder={isFishTTS ? 'reference_id' : isVolcTTS ? 'voice_type' : 'voice'}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">默认生成参数</h3>
                  <p className="text-xs text-gray-500 mb-3">用于控制默认画面、视频和 LLM token 配置</p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">帧宽度</label>
                        <input
                          type="number"
                          value={defaults.frame_width}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, frame_width: parseInt(e.target.value) || 1280 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">帧高度</label>
                        <input
                          type="number"
                          value={defaults.frame_height}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, frame_height: parseInt(e.target.value) || 720 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">默认视频时长(s)</label>
                        <input
                          type="number"
                          value={defaults.video_duration_seconds}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, video_duration_seconds: parseInt(e.target.value) || 6 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">split max_tokens</label>
                        <input
                          type="number"
                          value={defaults.split_max_tokens}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, split_max_tokens: parseInt(e.target.value) || 8000 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">plan max_tokens</label>
                        <input
                          type="number"
                          value={defaults.plan_max_tokens}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, plan_max_tokens: parseInt(e.target.value) || 16000 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">enhance max_tokens</label>
                        <input
                          type="number"
                          value={defaults.enhance_max_tokens}
                          onChange={(e) => setDefaults((prev) => ({ ...prev, enhance_max_tokens: parseInt(e.target.value) || 16000 }))}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-200 mb-1">并发控制</h3>
                  <p className="text-xs text-gray-500 mb-3">控制图片/视频生成任务的并行执行数量</p>
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">图片并发数</label>
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={queueLimits.image_max_concurrency}
                          onChange={(e) => {
                            const v = Math.max(1, Math.min(10, parseInt(e.target.value) || 3))
                            handleConcurrencyChange('image_max_concurrency', v)
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">视频并发数</label>
                        <input
                          type="number"
                          min={1}
                          max={8}
                          value={queueLimits.video_max_concurrency}
                          onChange={(e) => {
                            const v = Math.max(1, Math.min(8, parseInt(e.target.value) || 2))
                            handleConcurrencyChange('video_max_concurrency', v)
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">全局并发上限</label>
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={queueLimits.global_max_concurrency}
                          onChange={(e) => {
                            const v = Math.max(1, Math.min(15, parseInt(e.target.value) || 4))
                            handleConcurrencyChange('global_max_concurrency', v)
                          }}
                          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-purple-500"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-yellow-500/80">
                      注意：提高并发数可能导致 API 请求频率超限（Rate Limit），请根据服务商的限额合理配置。
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {PROMPT_MODULE_META.map((module) => (
                    <button
                      key={module.key}
                      onClick={() => setPromptModule(module.key)}
                      className={`px-3 py-2 text-xs rounded-lg border transition-colors ${
                        promptModule === module.key
                          ? 'bg-purple-600/20 text-purple-100 border-purple-500/60'
                          : 'bg-gray-800/60 text-gray-300 border-gray-700 hover:border-gray-500 hover:text-gray-100'
                      }`}
                    >
                      {module.label}
                    </button>
                  ))}
                </div>

                <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-100">{currentPromptMeta.label}</p>
                      <p className="text-xs text-gray-500 mt-1">{currentPromptMeta.description}</p>
                      <div className="mt-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] border ${
                            currentPromptUsesDefault
                              ? 'border-gray-600 text-gray-300 bg-gray-800/70'
                              : 'border-purple-500/50 text-purple-100 bg-purple-500/15'
                          }`}
                        >
                          {currentPromptUsesDefault ? '使用系统默认模板' : '已自定义模板'}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        setCustomPrompts((prev) => ({
                          ...prev,
                          [promptModule]: { system: '', user: '' },
                        }))
                      }
                      className="px-3 py-1.5 text-xs rounded border border-gray-600 text-gray-300 hover:text-gray-100 hover:border-gray-500"
                    >
                      恢复当前模块默认
                    </button>
                  </div>

                  <div>
                    <p className="text-xs text-gray-500 mb-2">可用变量</p>
                    <div className="flex flex-wrap gap-2">
                      {currentPromptVariableHints.map((token) => (
                        <code
                          key={token}
                          className="px-2 py-0.5 rounded text-[11px] bg-gray-800 border border-gray-700 text-gray-300"
                        >
                          {`{${token}}`}
                        </code>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-300">系统提示词（System Prompt）</p>
                        <button
                          onClick={() => updateCustomPrompt(promptModule, 'system', currentPromptDefaults.system)}
                          className="text-[11px] px-2 py-1 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500"
                        >
                          填入默认模板
                        </button>
                      </div>
                      <textarea
                        value={currentPromptCustom.system}
                        onChange={(e) => updateCustomPrompt(promptModule, 'system', e.target.value)}
                        rows={12}
                        className="w-full resize-y bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                        placeholder="留空时自动使用系统默认模板"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-300">用户提示词模板（User Prompt）</p>
                        <button
                          onClick={() => updateCustomPrompt(promptModule, 'user', currentPromptDefaults.user)}
                          className="text-[11px] px-2 py-1 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500"
                        >
                          填入默认模板
                        </button>
                      </div>
                      <textarea
                        value={currentPromptCustom.user}
                        onChange={(e) => updateCustomPrompt(promptModule, 'user', e.target.value)}
                        rows={12}
                        className="w-full resize-y bg-gray-800 border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-purple-500"
                        placeholder="留空时自动使用系统默认模板"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-800">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                保存设置
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default StudioSettingsPanel

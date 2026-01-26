import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { saveAs } from 'file-saver'
import { 
  Sparkles, Layers, Film, Clock, ChevronRight,
  Plus, Image as ImageIcon,
  Maximize2, ChevronLeft, Save,
  Loader2, CheckCircle, AlertCircle,
  FileText, Music, Mic, Settings2, Eye, Download, Package, Trash2, X
} from 'lucide-react'
import {
  agentChat, agentPlanProject, agentGenerateElementPrompt,
  createAgentProject, getAgentProject, updateAgentProject, listAgentProjects,
  applyAgentOperator,
  scriptDoctorAgentProject, completeAssetsAgentProject, audioCheckAgentProject,
  generateImage, generateVideo, checkVideoTaskStatus,
  generateProjectElementsStream,
  generateProjectFramesStream, generateProjectVideosStream,
   executeProjectPipeline,
   generateAgentAudio,
   clearAgentAudio,
   pollProjectVideoTasks,
   exportProjectAssets, exportMergedVideo,
   favoriteElementImage, favoriteShotImage, regenerateShotFrame,
  saveChatMessage, getChatHistory,
  type AgentProject, type AgentElement, type AgentSegment, type AgentShot,
  type FrameStreamEvent, type VideoStreamEvent
} from '../services/api'
import ChatInput, { UploadedFile } from '../components/ChatInput'

import {
  AudioAssetItem,
  ChatMessageItem,
  ElementsPanel,
  ImagePreviewModal,
  StoryboardPanel,
  TaskCard,
  TimelinePanel,
} from '../features/agent/components'
import type {
  AudioAsset,
  ChatMessage,
  ChatOption,
  CreativeBrief,
  ExportDialogState,
  GenerationStage,
  ModuleType,
  ProgressItem,
  TaskCardType,
  VisualAsset,
} from '../features/agent/types'
import { formatBytes, sanitizeFilename } from '../features/agent/utils'

function isProbablyExpiredSignedUrl(url?: string | null) {
  const raw = (url || '').trim()
  if (!raw || !/^https?:/i.test(raw)) return false
  try {
    const parsed = new URL(raw)
    const qs = parsed.searchParams

    const tosDate = qs.get('X-Tos-Date')
    const tosExpires = qs.get('X-Tos-Expires')
    if (tosDate && tosExpires) {
      const expiresSeconds = Number.parseInt(tosExpires, 10)
      if (!Number.isFinite(expiresSeconds)) return false
      const year = Number.parseInt(tosDate.slice(0, 4), 10)
      const month = Number.parseInt(tosDate.slice(4, 6), 10)
      const day = Number.parseInt(tosDate.slice(6, 8), 10)
      const hour = Number.parseInt(tosDate.slice(9, 11), 10)
      const minute = Number.parseInt(tosDate.slice(11, 13), 10)
      const second = Number.parseInt(tosDate.slice(13, 15), 10)
      const startMs = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second)
      const bufferSeconds = 30
      return Date.now() > startMs + Math.max(0, expiresSeconds - bufferSeconds) * 1000
    }

    const amzDate = qs.get('X-Amz-Date')
    const amzExpires = qs.get('X-Amz-Expires')
    if (amzDate && amzExpires) {
      const expiresSeconds = Number.parseInt(amzExpires, 10)
      if (!Number.isFinite(expiresSeconds)) return false
      const year = Number.parseInt(amzDate.slice(0, 4), 10)
      const month = Number.parseInt(amzDate.slice(4, 6), 10)
      const day = Number.parseInt(amzDate.slice(6, 8), 10)
      const hour = Number.parseInt(amzDate.slice(9, 11), 10)
      const minute = Number.parseInt(amzDate.slice(11, 13), 10)
      const second = Number.parseInt(amzDate.slice(13, 15), 10)
      const startMs = Date.UTC(year, Math.max(0, month - 1), day, hour, minute, second)
      const bufferSeconds = 30
      return Date.now() > startMs + Math.max(0, expiresSeconds - bufferSeconds) * 1000
    }
  } catch {
    // ignore
  }
  return false
}

function resolveMediaUrl(url?: string | null) {
  const u = (url || '').trim()
  if (!u) return ''
  if (/^(data:|blob:)/i.test(u)) return u
  if (/^https?:/i.test(u)) return isProbablyExpiredSignedUrl(u) ? '' : u
  if (u.startsWith('/api/')) return `http://localhost:8000${u}`
  return u
}

function canonicalizeMediaUrl(url: string) {
  const u = (url || '').trim()
  if (!u) return ''
  return u.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1):8000(?=\/api\/)/i, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function unwrapStructuredPayload(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  let obj: Record<string, unknown> = value
  for (const key of ['data', 'result', 'plan', 'patch', 'updates']) {
    const inner = obj[key]
    if (isRecord(inner)) obj = inner
  }
  return obj
}

function looksLikeAgentPatch(value: unknown): boolean {
  const obj = unwrapStructuredPayload(value)
  if (!obj) return false
  const keys = [
    'elements',
    'segments',
    'creative_brief',
    'creativeBrief',
    'Creative_Brief',
    'Key_Elements',
    'key_elements',
    'Storyboard_With_Prompts',
    'storyboard_with_prompts',
    'Storyboard',
    'storyboard',
    'Character_Designs',
    'character_designs',
    'characterDesigns',
  ]
  return keys.some((k) => k in obj)
}

function createAgentChatSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function buildInitialAgentMessages(): ChatMessage[] {
  return [
    {
      id: '1',
      role: 'assistant',
      content: `你好！我是 YuanYuan AI 视频制作助手 ✨

我可以帮你将创意转化为完整的视频作品。只需要告诉我你想制作什么，我会：

**第一步** 📋 分析需求，制定创意简报
**第二步** 🎬 设计分镜，规划镜头序列  
**第三步** 🎨 生成角色和场景素材
**第四步** 🎥 将静态画面转化为动态视频
**第五步** 🎵 添加旁白和背景音乐

请描述你想制作的视频，例如：
「制作格林童话《白蛇》的短片，时长1分钟，画风吉卜力2D」`,
      options: [
        { id: 'example1', label: '童话故事短片', value: '制作一个1分钟的童话短片，讲述白蛇的故事，画风吉卜力2D' },
        { id: 'example2', label: '产品宣传视频', value: '制作一个30秒的产品宣传视频，现代简约风格' },
        { id: 'example3', label: '教育动画', value: '制作一个2分钟的科普教育动画，解释光合作用' },
      ],
    },
  ]
}

export default function AgentPage() {
  const navigate = useNavigate()
  const location = useLocation()
  
  const urlProjectId = location.pathname.match(/\/agent\/([^/]+)/)?.[1] || null
  const initialAgentProjectId = urlProjectId && urlProjectId.startsWith('agent_') ? urlProjectId : null
  
  const [activeModule, setActiveModule] = useState<ModuleType>('elements')
  const [projectName, setProjectName] = useState('未命名项目')
  const [projectId, setProjectId] = useState<string | null>(initialAgentProjectId)
  const [sessionId, setSessionId] = useState<string>(() => {
    // 无项目时使用的 session ID，从 localStorage 获取或创建新的
    const saved = localStorage.getItem('agent-chat-session-id')
    if (saved) return saved
    const newId = createAgentChatSessionId()
    localStorage.setItem('agent-chat-session-id', newId)
    return newId
  })
  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])
  const generationCancelRef = useRef<null | (() => void)>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showExitDialog, setShowExitDialog] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  // Agent 项目历史
  const [agentProjects, setAgentProjects] = useState<AgentProject[]>([])
  const [showProjectList, setShowProjectList] = useState(!urlProjectId) // 没有项目ID时显示列表
  
  // 项目数据
  const [elements, setElements] = useState<Record<string, AgentElement>>({})
  const [segments, setSegments] = useState<AgentSegment[]>([])
  const [visualAssets, setVisualAssets] = useState<VisualAsset[]>([])
  const [audioAssets, setAudioAssets] = useState<AudioAsset[]>([])
  const [creativeBrief, setCreativeBrief] = useState<CreativeBrief>({})
  const shouldPollVideos = !!projectId && segments.some(seg => seg.shots?.some(shot => shot.status === 'video_processing' && !shot.video_url))

  // 生成状态
  const [generationStage, setGenerationStage] = useState<GenerationStage>('idle')
  const [audioGenIncludeNarration, setAudioGenIncludeNarration] = useState<boolean>(() => {
    const raw = localStorage.getItem('agent_audio_gen_include_narration')
    return raw !== '0'
  })
  const [audioGenIncludeDialogue, setAudioGenIncludeDialogue] = useState<boolean>(() => {
    const raw = localStorage.getItem('agent_audio_gen_include_dialogue')
    return raw !== '0'
  })
  const [isScriptDoctoring, setIsScriptDoctoring] = useState(false)
  const [isCompletingAssets, setIsCompletingAssets] = useState(false)
  const [isAudioChecking, setIsAudioChecking] = useState(false)

  // 生成进度状态
  const [generationProgress, setGenerationProgress] = useState<{
    current: number
    total: number
    percent: number
    currentItem?: string
    stage?: string
    phase?: string
  } | null>(null)

  useEffect(() => {
    localStorage.setItem('agent_audio_gen_include_narration', audioGenIncludeNarration ? '1' : '0')
  }, [audioGenIncludeNarration])

  useEffect(() => {
    localStorage.setItem('agent_audio_gen_include_dialogue', audioGenIncludeDialogue ? '1' : '0')
  }, [audioGenIncludeDialogue])

  // 任务卡片展开状态
  const [expandedCards, setExpandedCards] = useState<Set<TaskCardType>>(new Set(['brief']))

  // 图片预览状态
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null)

  // 连续创作：从历史项目导入元素
  const [importElementsOpen, setImportElementsOpen] = useState(false)
  const [importSourceProjectId, setImportSourceProjectId] = useState<string | null>(null)
  const [importSourceProject, setImportSourceProject] = useState<AgentProject | null>(null)
  const [importSelectedElementIds, setImportSelectedElementIds] = useState<Set<string>>(new Set())
  const [importingElements, setImportingElements] = useState(false)
  const [importElementQuery, setImportElementQuery] = useState('')
  const [importElementTypeFilter, setImportElementTypeFilter] = useState<'all' | 'character' | 'scene' | 'object'>('all')
  const [importElementShowOnlyMissing, setImportElementShowOnlyMissing] = useState(false)
  const [importElementShowOnlyConflicts, setImportElementShowOnlyConflicts] = useState(false)

  // 连续创作：跨项目导入“镜头参考图”到当前镜头
  const [importShotRefsOpen, setImportShotRefsOpen] = useState(false)
  const [importShotRefsTargetShotId, setImportShotRefsTargetShotId] = useState<string | null>(null)
  const [importShotRefsSourceProjectId, setImportShotRefsSourceProjectId] = useState<string | null>(null)
  const [importShotRefsSourceProject, setImportShotRefsSourceProject] = useState<AgentProject | null>(null)
  const [importShotRefsSelectedUrls, setImportShotRefsSelectedUrls] = useState<Set<string>>(new Set())
  const [importingShotRefs, setImportingShotRefs] = useState(false)

  const [messages, setMessages] = useState<ChatMessage[]>(() => buildInitialAgentMessages())
  
  // 用于中断请求的 AbortController
  const abortControllerRef = useRef<AbortController | null>(null)
  
  const [inputMessage, setInputMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [waitingForConfirm, setWaitingForConfirm] = useState<string | null>(null)
  
  const [expandedElements, setExpandedElements] = useState<Set<string>>(new Set())
  const [expandedSegments, setExpandedSegments] = useState<Set<string>>(new Set())
  const [focusShotRequest, setFocusShotRequest] = useState<{ shotId: string; section?: 'video' | 'audio'; nonce: number } | null>(null)
  
  const [editingElement, setEditingElement] = useState<string | null>(null)
  const [generatingElement, setGeneratingElement] = useState<string | null>(null)
  const [retryingShot, setRetryingShot] = useState<string | null>(null)
  const [regeneratingAudioShotId, setRegeneratingAudioShotId] = useState<string | null>(null)
  const [clearingAudioShotId, setClearingAudioShotId] = useState<string | null>(null)
  const [clearingAllVoiceAudio, setClearingAllVoiceAudio] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportAbortControllerRef = useRef<AbortController | null>(null)
  const exportToastAutoPinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const exportToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [exportToastEntered, setExportToastEntered] = useState(false)
  const [viewportWidth, setViewportWidth] = useState<number>(() => window.innerWidth)
  const [exportDialog, setExportDialog] = useState<ExportDialogState>({
    open: false,
    mode: 'floating',
    phase: 'packing',
    loaded: 0
  })
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  
  const chatEndRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)
  const videoPollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoPollingInFlightRef = useRef(false)
  const mainPanelRef = useRef<HTMLElement | null>(null)

  // 可调整面板宽度
  const [rightPanelWidth, setRightPanelWidth] = useState(420) // 像素
  const [isResizingRight, setIsResizingRight] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 处理分隔条拖拽
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const containerRect = containerRef.current.getBoundingClientRect()
      
      if (isResizingRight) {
        const newWidth = containerRect.right - e.clientX
        // 限制右侧面板宽度在 280-600 像素之间
        setRightPanelWidth(Math.max(280, Math.min(600, newWidth)))
      }
    }
    
    const handleMouseUp = () => {
      setIsResizingRight(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    
    if (isResizingRight) {
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizingRight])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 点击外部关闭导出菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false)
      }
    }
    
    if (showExportMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showExportMenu])

  // 加载 Agent 项目历史
  useEffect(() => {
    loadAgentProjects()
  }, [])

  const loadAgentProjects = async () => {
    try {
      const projects = await listAgentProjects(20)
      setAgentProjects(projects)
    } catch (error) {
      console.error('加载 Agent 项目列表失败:', error)
    }
  }

  // 无项目时加载 session 聊天记录
  useEffect(() => {
    if (!urlProjectId && sessionId) {
      const sid = sessionId
      // 尝试从 session 加载之前的聊天记录
      getChatHistory(sid, 'agent', 100).then(history => {
        if (sessionIdRef.current !== sid) return
        if (history && history.length > 0) {
          // 转换格式并恢复
          const restoredMessages = history.map(msg => ({
            id: msg.id || Date.now().toString(),
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          }))
          // 保留欢迎消息，追加历史记录
          setMessages(prev => {
            if (prev.length === 1 && prev[0].id === '1') {
              // 只有欢迎消息，添加历史
              return [...prev, ...restoredMessages]
            }
            return prev
          })
        }
      }).catch(err => {
        console.log('无 session 聊天记录:', err)
      })
    }
  }, [sessionId, urlProjectId])

  const resetAgentWorkspace = useCallback((options?: { showProjectList?: boolean }) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (generationCancelRef.current) {
      generationCancelRef.current()
      generationCancelRef.current = null
    }

    setSending(false)
    setGenerationProgress(null)
    setGenerationStage('idle')

    setProjectId(null)
    setProjectName('未命名项目')
    setElements({})
    setSegments([])
    setCreativeBrief({})
    setVisualAssets([])
    setAudioAssets([])
    setHasUnsavedChanges(false)

    setShowExitDialog(false)
    setWaitingForConfirm(null)
    setInputMessage('')
    setUploadedFiles([])

    setActiveModule('elements')
    setExpandedCards(new Set(['brief']))
    setExpandedElements(new Set())
    setExpandedSegments(new Set())
    setPreviewImage(null)

    setImportElementsOpen(false)
    setImportSourceProjectId(null)
    setImportSourceProject(null)
    setImportSelectedElementIds(new Set())
    setImportingElements(false)
    setImportElementQuery('')
    setImportElementTypeFilter('all')
    setImportElementShowOnlyMissing(false)
    setImportElementShowOnlyConflicts(false)

    setImportShotRefsOpen(false)
    setImportShotRefsTargetShotId(null)
    setImportShotRefsSourceProjectId(null)
    setImportShotRefsSourceProject(null)
    setImportShotRefsSelectedUrls(new Set())
    setImportingShotRefs(false)

    setIsScriptDoctoring(false)
    setIsCompletingAssets(false)
    setIsAudioChecking(false)

    setMessages(buildInitialAgentMessages())
    const nextSessionId = createAgentChatSessionId()
    sessionIdRef.current = nextSessionId
    setSessionId(nextSessionId)
    localStorage.setItem('agent-chat-session-id', nextSessionId)

    if (options?.showProjectList ?? true) {
      setShowProjectList(true)
    }
  }, [])

  // 记录来源项目 ID（如果是从普通项目进入的）

  useEffect(() => {
    if (urlProjectId) {
      if (urlProjectId.startsWith('agent_')) {
        loadProject(urlProjectId)
        setShowProjectList(false)
        return
      }

      // Entered with a non-agent projectId (e.g. from ProjectPage): don't try to
      // load it as an Agent project; start a fresh workspace.
      resetAgentWorkspace({ showProjectList: false })
      setShowProjectList(false)
      return
    }

    // Switching back to `/agent` (no projectId): avoid keeping stale state from the
    // previously opened project, otherwise a "new" project can inherit old content.
    resetAgentWorkspace({ showProjectList: true })
  }, [urlProjectId, resetAgentWorkspace])

  // Auto-poll backend to update video_url for shots that are still processing.
  useEffect(() => {
    if (!projectId || !shouldPollVideos) {
      if (videoPollingTimerRef.current) {
        clearInterval(videoPollingTimerRef.current)
        videoPollingTimerRef.current = null
      }
      return
    }

    const pollOnce = async () => {
      if (!projectId || videoPollingInFlightRef.current) return
      videoPollingInFlightRef.current = true
      try {
        const pollResult = await pollProjectVideoTasks(projectId)
        if (pollResult.completed > 0 || pollResult.failed > 0 || pollResult.processing === 0) {
          await loadProject(projectId)
        }
      } catch (error) {
        console.error('[AgentPage] poll video tasks failed:', error)
      } finally {
        videoPollingInFlightRef.current = false
      }
    }

    pollOnce()
    if (!videoPollingTimerRef.current) {
      videoPollingTimerRef.current = setInterval(pollOnce, 5000)
    }

    return () => {
      if (videoPollingTimerRef.current) {
        clearInterval(videoPollingTimerRef.current)
        videoPollingTimerRef.current = null
      }
    }
  }, [projectId, shouldPollVideos])

  const loadProject = async (id: string): Promise<AgentProject | null> => {
    try {
      setIsLoading(true)
      const project = await getAgentProject(id)
      setProjectId(project.id)
      setProjectName(project.name)
      setElements(project.elements || {})
      setSegments(project.segments || [])
      setCreativeBrief((project.creative_brief || {}) as CreativeBrief)
      setAudioAssets(
        ((project.audio_assets || []) as Array<{ id: string; url?: string; type?: string; duration?: string | number; duration_ms?: number }>).map((a) => ({
          id: a.id,
          name: a.id.replace(/^voice_/, ''),
          url: a.url,
          type: (a.type as AudioAsset['type']) || 'narration',
          duration: typeof a.duration === 'string' ? a.duration : (a.duration_ms ? `${a.duration_ms}ms` : undefined),
          status: 'completed' as const
        }))
      )

      // 恢复聊天记录
      if (project.messages && project.messages.length > 0) {
        setMessages(project.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          data: msg.data,
          options: msg.options,
          confirmButton: msg.confirmButton,
          progress: msg.progress
        })))
      }

      // 转换 visual_assets
      const assets: VisualAsset[] = (project.visual_assets || []).map((a: { id: string; url: string; duration?: string; type?: string; element_id?: string; shot_id?: string }) => ({
        id: a.id,
        name: a.id.replace(/^(asset_|frame_|video_)/, ''),
        url: a.url,
        duration: a.duration,
        type: (a.type as 'element' | 'start_frame' | 'video') || 'element',
        elementId: a.element_id,
        shotId: a.shot_id,
        status: 'completed' as const
      }))
      setVisualAssets(assets)
      setHasUnsavedChanges(false)
      return project
    } catch (error: unknown) {
      console.error('加载项目失败:', error)
      
      // 检查是否是 404 错误（项目不存在）
      // 这通常意味着 URL 中的 ID 是普通项目 ID，不是 Agent 项目 ID
      const isNotFound = error instanceof Error && 
        (error.message.includes('404') || 
         (error as { response?: { status?: number } }).response?.status === 404)
      
      if (isNotFound && urlProjectId) {
        if (urlProjectId.startsWith('agent_')) {
          console.log('[Agent] Agent project not found:', urlProjectId)
          resetAgentWorkspace({ showProjectList: true })
          navigate('/agent', { replace: true })
          addMessage('assistant', '⚠️ 该 Agent 项目不存在或已被删除，已返回项目列表。')
          return null
        }

        console.log('[Agent] 项目不存在，可能是从普通项目进入，开始新的 Agent 项目')
        // 记录来源项目 ID，以便后续关联
        // 清除 projectId，让用户开始新项目
        setProjectId(null)
        // 更新 URL，移除无效的项目 ID
        navigate('/agent', { replace: true })
        // 显示提示
        addMessage('assistant', `👋 欢迎使用 YuanYuan Agent！

检测到你是从项目页面进入的，我已为你准备好新的 Agent 工作区。

请告诉我你想制作什么视频，我会帮你完成从创意到成片的全流程。`)
      }
      return null
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // 只有在有实际项目数据时才标记为未保存
    // 排除初始欢迎消息（messages.length > 1）
    if (Object.keys(elements).length > 0 || segments.length > 0) {
      setHasUnsavedChanges(true)
    }
  }, [elements, segments])

  // 添加消息的辅助函数
  const addMessage = useCallback((
    role: 'user' | 'assistant',
    content: string,
    data?: unknown,
    options?: ChatOption[],
    confirmButton?: { label: string; action: string; payload?: unknown },
    progress?: ProgressItem[]
  ) => {
    const newMessage = {
      id: Date.now().toString(),
      role,
      content,
      data,
      options,
      confirmButton,
      progress
    }

    setMessages(prev => [...prev, newMessage])

    // 无项目时，保存消息到 session 存储
    if (!projectId && sessionId) {
      saveChatMessage(sessionId, 'agent', role, content).catch(err => {
        console.log('[AgentPage] 保存 session 消息失败:', err)
      })
    }
  }, [projectId, sessionId])

  // 保存项目
  const handleSaveProject = useCallback(async (showAlert = true) => {
    try {
      // 准备聊天记录数据（只保存必要字段）
      const messagesData = messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        data: msg.data,
        options: msg.options,
        confirmButton: msg.confirmButton,
        progress: msg.progress,
        created_at: new Date().toISOString()
      }))

      const projectData: Partial<AgentProject> = {
        name: projectName,
        creative_brief: creativeBrief,
        elements,
        segments,
        messages: messagesData,
        visual_assets: visualAssets.map(a => ({
          id: a.id,
          url: a.url,
          duration: a.duration,
          type: a.type,
          element_id: a.elementId,
          shot_id: a.shotId
        }))
        ,
        audio_assets: audioAssets.map(a => ({
          id: a.id,
          url: a.url || '',
          type: a.type
        }))
      }

      console.log('[AgentPage] 保存项目:', { projectId, projectData })
      
      if (projectId) {
        const updated = await updateAgentProject(projectId, projectData)
        console.log('[AgentPage] 项目已更新:', updated)
        setHasUnsavedChanges(false)
        if (showAlert) {
          addMessage('assistant', '✅ 项目已保存')
        }
      } else {
        const newProject = await createAgentProject(projectName, creativeBrief)
        console.log('[AgentPage] 新项目已创建:', newProject)
        setProjectId(newProject.id)
        navigate(`/agent/${newProject.id}`, { replace: true })
        // 创建后立即更新完整数据
        if (Object.keys(elements).length > 0 || segments.length > 0) {
          await updateAgentProject(newProject.id, projectData)
          console.log('[AgentPage] 新项目数据已更新')
        }
        setHasUnsavedChanges(false)
        if (showAlert) {
          addMessage('assistant', '✅ 项目已保存')
        }
      }
    } catch (error) {
      console.error('[AgentPage] 保存失败:', error)
      if (showAlert) {
        addMessage('assistant', `❌ 保存失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    }
  }, [projectId, projectName, creativeBrief, elements, segments, visualAssets, messages, navigate, addMessage])

  const getBackTarget = () => {
    // 如果 URL 中的项目 ID 是 Agent 项目（以 agent_ 开头），返回首页
    // 否则返回对应的普通项目页面
    if (urlProjectId && !urlProjectId.startsWith('agent_')) {
      return `/home/project/${urlProjectId}`
    }
    return '/'
  }

  const handleBack = () => {
    if (hasUnsavedChanges) {
      setShowExitDialog(true)
    } else {
      navigate(getBackTarget())
    }
  }

  const handleSaveAndExit = async () => {
    await handleSaveProject(false)
    navigate(getBackTarget())
  }

  const handleExitWithoutSave = () => {
    navigate(getBackTarget())
  }

  // 切换任务卡片展开状态
  const toggleCard = (card: TaskCardType) => {
    setExpandedCards(prev => {
      const next = new Set(prev)
      if (next.has(card)) next.delete(card)
      else next.add(card)
      return next
    })
  }

  // 处理选项点击 - 直接执行对应操作
  const handleOptionClick = async (option: ChatOption) => {
    // 检查是否是操作类型的选项
    if (option.value === 'view_storyboard') {
      await handleConfirmClick('view_storyboard')
    } else if (option.value === 'execute_pipeline') {
      await handleConfirmClick('execute_pipeline')
    } else if (option.value === 'generate_elements') {
      await handleConfirmClick('generate_elements')
    } else if (option.value === 'generate_frames') {
      await handleConfirmClick('generate_frames')
    } else if (option.value === 'generate_videos') {
      await handleConfirmClick('generate_videos')
    } else if (option.value === 'view_timeline') {
      setActiveModule('timeline')
      addMessage('assistant', '已切换到时间轴面板 📽️')
    } else if (option.value === 'generate_audio') {
      await handleConfirmClick('generate_audio')
    } else {
      // 普通文本选项，填充到输入框并自动发送
      setInputMessage(option.value)
      // 延迟一下让状态更新，然后自动发送
      setTimeout(() => {
        const input = document.querySelector('textarea') as HTMLTextAreaElement
        if (input) {
          input.form?.requestSubmit()
        }
      }, 100)
    }
  }

  // 处理确认按钮点击
  const handleConfirmClick = async (action: string, payload?: unknown) => {
    setWaitingForConfirm(null)
    
    if (action === 'generate_elements') {
      await handleGenerateAllElements()
    } else if (action === 'generate_frames') {
      await handleGenerateAllFrames()
    } else if (action === 'generate_frames_batch') {
      if (!projectId) {
        addMessage('assistant', '⚠️ 请先保存项目')
        return
      }

      const obj = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : {}
      const mode = obj.mode === 'regenerate' ? 'regenerate' : 'missing'
      const excludeShotIds = Array.isArray(obj.excludeShotIds)
        ? (obj.excludeShotIds.filter(v => typeof v === 'string' && v.trim()).map(v => (v as string).trim()))
        : []

      const ok = window.confirm(
        mode === 'regenerate'
          ? `将强制重生成起始帧（即使已有起始帧也会重新出图）${excludeShotIds.length > 0 ? `，并跳过：${excludeShotIds.join(', ')}` : ''}。\n\n确认开始？`
          : `将补齐缺失的起始帧${excludeShotIds.length > 0 ? `，并跳过：${excludeShotIds.join(', ')}` : ''}。\n\n确认开始？`
      )
      if (!ok) return

      await handleGenerateAllFrames({ excludeShotIds, mode })
    } else if (action === 'generate_videos') {
      await handleGenerateAllVideos()
    } else if (action === 'execute_pipeline') {
      await handleExecutePipeline()
    } else if (action === 'generate_audio') {
      if (!projectId) {
        addMessage('assistant', '⚠️ 请先保存 Agent 项目')
        return
      }

      const includeNarration = audioGenIncludeNarration
      const includeDialogue = audioGenIncludeDialogue
      if (!includeNarration && !includeDialogue) {
        addMessage('assistant', '⚠️ 请至少选择一个：旁白 或 对白')
        return
      }

      const parts = [includeNarration ? '旁白' : null, includeDialogue ? '对白' : null].filter(Boolean).join(' + ')
      const ok = window.confirm(`将为所有镜头生成：${parts}（独立 TTS），并在导出视频时叠加到原视频环境音上。\n\n确认开始？`)
      if (!ok) return

      setGenerationStage('audio')
      setGenerationProgress({ current: 0, total: 0, percent: 0, phase: 'submit', stage: '生成音频' })

      addMessage('assistant', `🎵 **开始生成音频（${parts}）**\n\n我会逐镜头生成人声轨，并在导出时与视频环境音混合。`)

      try {
        const result = await generateAgentAudio(projectId, { overwrite: true, includeNarration, includeDialogue })
        await loadProject(projectId)
        setGenerationProgress(null)
        setGenerationStage('complete')

        addMessage('assistant', `✅ **音频生成完成**\n\n${formatAudioGenResult(result)}\n\n下一步可以导出视频（将自动叠加人声轨）。`)
      } catch (error) {
        console.error('生成音频失败:', error)
        setGenerationProgress(null)
        setGenerationStage('idle')
        addMessage('assistant', `❌ 生成音频失败：${error instanceof Error ? error.message : '未知错误'}`)
      }
    } else if (action === 'apply_agent_actions') {
      if (!projectId) {
        addMessage('assistant', '⚠️ 请先保存 Agent 项目后再应用修改')
        return
      }

      const actions = Array.isArray(payload) ? payload : null
      if (!actions) {
        addMessage('assistant', '❌ 无法解析要执行的修改动作（payload 不是 actions 数组）')
        return
      }

      // 优先走后端“职工”执行（统一校验+落盘），前端只做适配与 UI 更新
      try {
        const res = await applyAgentOperator(projectId, { kind: 'actions', payload: actions, executeRegenerate: true })
        if (!res.success) {
          addMessage('assistant', `❌ 应用修改失败：${(res as { error?: string }).error || '未知错误'}`)
          return
        }

        if (res.project) {
          setProjectName(res.project.name)
          setElements(res.project.elements || {})
          setSegments(res.project.segments || [])
          setCreativeBrief((res.project.creative_brief || {}) as CreativeBrief)
          setHasUnsavedChanges(false)
        } else {
          await loadProject(projectId)
        }

        const ui = (res.ui_hints as { activeModule?: string } | undefined) || undefined
        if (ui?.activeModule) setActiveModule(ui.activeModule as ModuleType)

        addMessage('assistant', '✅ 已应用修改')
        return
      } catch (err) {
        console.error('[AgentPage] apply_agent_actions operator apply failed:', err)
        addMessage('assistant', `❌ 应用修改失败：${err instanceof Error ? err.message : '未知错误'}`)
        return
      }

      /* Legacy: moved to backend operator
      type AgentAction =
        | {
            type: 'update_shot'
            shot_id: string
            patch: {
              prompt?: string
              video_prompt?: string
              description?: string
              narration?: string
              dialogue_script?: string
              duration?: number
            }
            reason?: string
          }
        | { type: 'regenerate_shot_frame'; shot_id: string; visualStyle?: string }
        | { type: 'update_element'; element_id: string; patch: { description?: string }; reason?: string }

      const parsedActions = actions as AgentAction[]

      const targetKeys = new Set<string>()
      for (const a of parsedActions) {
        if (!a) continue
        if (a.type === 'update_shot' || a.type === 'regenerate_shot_frame') targetKeys.add(`shot:${(a as { shot_id: string }).shot_id}`)
        if (a.type === 'update_element') targetKeys.add(`element:${(a as { element_id: string }).element_id}`)
      }

      const isPromptOnlyBatchUpdate =
        parsedActions.length > 0 &&
        parsedActions.every(a =>
          a?.type === 'update_shot' &&
          a.patch &&
          typeof a.patch.prompt === 'string' &&
          !('description' in a.patch) &&
          !('narration' in a.patch) &&
          !('video_prompt' in a.patch) &&
          !('dialogue_script' in a.patch) &&
          !('duration' in a.patch)
        )

      // 安全阈值：默认只允许一次修改聚焦一个目标；但允许“批量只改 shot.prompt”
      if (targetKeys.size > 1 && !isPromptOnlyBatchUpdate) {
        addMessage('assistant', '为避免推翻整个项目，我建议一次只改一个目标（一个镜头或一个元素）。如果要批量修改，也只支持批量修改 shot.prompt（不重生成）。')
        return
      }

      if (targetKeys.size > 1 && isPromptOnlyBatchUpdate) {
        const shotIds = Array.from(targetKeys)
          .filter(k => k.startsWith('shot:'))
          .map(k => k.replace(/^shot:/, ''))
        const preview = shotIds.slice(0, 10).join(', ') + (shotIds.length > 10 ? ' ...' : '')
        const ok = window.confirm(`将批量更新 ${shotIds.length} 个镜头的 prompt（不重生成）。\n\n示例：${preview}\n\n确认继续？`)
        if (!ok) return
      }

      const allowedTypes = new Set(['update_shot', 'regenerate_shot_frame', 'update_element'])
      if (parsedActions.some(a => !a || !allowedTypes.has((a as { type?: string }).type || ''))) {
        addMessage('assistant', '❌ 本次包含不支持的动作类型，已拒绝执行（为安全起见）')
        return
      }

      let nextSegments = segments
      let nextElements = elements
      let segmentsChanged = false
      let elementsChanged = false

      const updateShotInSegments = (
        segs: AgentSegment[],
        shotId: string,
        patch: { prompt?: string; video_prompt?: string; description?: string; narration?: string; dialogue_script?: string; duration?: number }
      ): AgentSegment[] => {
        return segs.map(seg => ({
          ...seg,
          shots: seg.shots.map(shot => {
            if (shot.id !== shotId) return shot
            return {
              ...shot,
              ...(typeof patch.prompt === 'string' ? { prompt: patch.prompt } : {}),
              ...(typeof patch.video_prompt === 'string' ? { video_prompt: patch.video_prompt } : {}),
              ...(typeof patch.description === 'string' ? { description: patch.description } : {}),
              ...(typeof patch.narration === 'string' ? { narration: patch.narration } : {}),
              ...(typeof patch.dialogue_script === 'string' ? { dialogue_script: patch.dialogue_script } : {}),
              ...(typeof patch.duration === 'number' && Number.isFinite(patch.duration) && patch.duration > 0
                ? { duration: patch.duration }
                : {})
            }
          })
        }))
      }

      const updateElementInMap = (
        map: Record<string, AgentElement>,
        elementId: string,
        patch: { description?: string }
      ): Record<string, AgentElement> => {
        const current = map[elementId]
        if (!current) return map
        return {
          ...map,
          [elementId]: {
            ...current,
            ...(typeof patch.description === 'string' ? { description: patch.description } : {})
          }
        }
      }

      // 先应用“可编辑字段”的 patch（不触发重生成）
      for (const a of parsedActions) {
        if (a.type === 'update_shot') {
          nextSegments = updateShotInSegments(nextSegments, a.shot_id, a.patch || {})
          segmentsChanged = true
        } else if (a.type === 'update_element') {
          nextElements = updateElementInMap(nextElements, a.element_id, a.patch || {})
          elementsChanged = true
        }
      }

      if (segmentsChanged) setSegments(nextSegments)
      if (elementsChanged) setElements(nextElements)

      if (segmentsChanged || elementsChanged) {
        try {
          const updates: Partial<AgentProject> = {}
          if (segmentsChanged) updates.segments = nextSegments
          if (elementsChanged) updates.elements = nextElements
          await updateAgentProject(projectId, updates)

          if (targetKeys.size > 1 && isPromptOnlyBatchUpdate) {
            addMessage('assistant', `✅ 已批量更新 ${targetKeys.size} 个镜头的 prompt（未重生成）`)
          } else {
            addMessage('assistant', '✅ 已按你的要求仅修改目标字段（未重做其它环节）')
          }
        } catch (e) {
          console.error('[AgentPage] apply_agent_actions save failed:', e)
          addMessage('assistant', `❌ 保存修改失败：${e instanceof Error ? e.message : '未知错误'}`)
          return
        }
      }

      // 再执行“重生成”动作（仅针对目标镜头）
      for (const a of parsedActions) {
        if (a.type === 'regenerate_shot_frame') {
          try {
            addMessage('assistant', `🖼️ 正在仅重生成镜头 ${a.shot_id} 的起始帧...`)
            const regen = await regenerateShotFrame(projectId, a.shot_id, a.visualStyle || creativeBrief.visualStyle || '吉卜力动画风格')
            if (!regen.success) {
              addMessage('assistant', `❌ 重生成失败：${regen.error || '未知错误'}`)
              continue
            }
            setSegments(prev => prev.map(seg => ({
              ...seg,
              shots: seg.shots.map(shot =>
                shot.id === a.shot_id
                  ? {
                      ...shot,
                      start_image_url: regen.start_image_url || regen.source_url || shot.start_image_url,
                      cached_start_image_url: regen.cached_start_image_url || (regen.image_url?.startsWith('/api/') ? regen.image_url : shot.cached_start_image_url),
                      start_image_history: regen.start_image_history || shot.start_image_history,
                      status: 'frame_ready'
                    }
                  : shot
              )
            })))
            addMessage('assistant', '✅ 已完成该镜头起始帧重生成')
          } catch (e) {
            console.error('[AgentPage] regenerateShotFrame failed:', e)
            addMessage('assistant', `❌ 重生成请求失败：${e instanceof Error ? e.message : '未知错误'}`)
          } finally {
            await loadProject(projectId)
          }
        }
      }
      */
    } else if (action === 'apply_agent_patch') {
      if (!projectId) {
        addMessage('assistant', '⚠️ 请先保存 Agent 项目后再应用修改')
        return
      }

      // 优先走后端“职工”执行（统一校验+落盘），前端只做适配与 UI 更新
      try {
        const res = await applyAgentOperator(projectId, { kind: 'patch', payload })
        if (!res.success) {
          addMessage('assistant', `❌ 应用修改失败：${(res as { error?: string }).error || '未知错误'}`)
          return
        }

        if (res.project) {
          setProjectName(res.project.name)
          setElements(res.project.elements || {})
          setSegments(res.project.segments || [])
          setCreativeBrief((res.project.creative_brief || {}) as CreativeBrief)
          setHasUnsavedChanges(false)
        } else {
          await loadProject(projectId)
        }

        const ui = (res.ui_hints as { activeModule?: string } | undefined) || undefined
        if (ui?.activeModule) setActiveModule(ui.activeModule as ModuleType)

        addMessage('assistant', '✅ 已应用修改')
        return
      } catch (err) {
        console.error('[AgentPage] apply_agent_patch operator apply failed:', err)
        addMessage('assistant', `❌ 应用修改失败：${err instanceof Error ? err.message : '未知错误'}`)
        return
      }

      /* Legacy: moved to backend operator
      const root = unwrapStructuredPayload(payload)
      if (!root) {
        addMessage('assistant', '❌ 无法解析要应用的内容（payload 不是对象）')
        return
      }

      const pick = (obj: Record<string, unknown>, ...keys: string[]) => {
        for (const k of keys) {
          if (k in obj) return obj[k]
        }
        return undefined
      }

      const now = new Date().toISOString()

      // --- creative brief ---
      const briefRaw = pick(root, 'creative_brief', 'creativeBrief', 'Creative_Brief', 'brief')
      const briefObj = isRecord(briefRaw) ? briefRaw : null
      const briefPatch: Partial<CreativeBrief> = {}
      const setBriefStr = (key: keyof CreativeBrief, val: unknown) => {
        if (typeof val === 'string' && val.trim()) briefPatch[key] = val.trim()
      }

      if (briefObj) {
        setBriefStr('title', pick(briefObj, 'title', 'Project_Name', 'project_name', 'name'))
        setBriefStr('videoType', pick(briefObj, 'videoType', 'video_type', 'Video_Type'))
        setBriefStr('narrativeDriver', pick(briefObj, 'narrativeDriver', 'narrative_driver', 'Narrative_Driver'))
        setBriefStr('emotionalTone', pick(briefObj, 'emotionalTone', 'emotional_tone', 'Emotional_Tone', 'Core_Theme'))
        setBriefStr('visualStyle', pick(briefObj, 'visualStyle', 'visual_style', 'Visual_Style'))
        setBriefStr('duration', pick(briefObj, 'duration', 'total_duration', 'Total_Duration'))
        setBriefStr('aspectRatio', pick(briefObj, 'aspectRatio', 'aspect_ratio', 'Aspect_Ratio'))
        setBriefStr('language', pick(briefObj, 'language', 'Language'))
        setBriefStr(
          'narratorVoiceProfile',
          pick(briefObj, 'narratorVoiceProfile', 'narrator_voice_profile', 'Narrator_Voice_Profile')
        )
      }

      const briefChanged = Object.keys(briefPatch).length > 0
      const nextCreativeBrief = briefChanged ? { ...creativeBrief, ...briefPatch } : creativeBrief

      // --- elements ---
      const elementsRaw = pick(
        root,
        'elements',
        'Key_Elements',
        'key_elements',
        'keyElements',
        'character_designs',
        'characterDesigns',
        'Character_Designs'
      )
      let nextElements = elements
      let elementsChanged = false

      const applyElementPatch = (id: string, raw: Record<string, unknown>) => {
        const current = nextElements[id]
        const name = (typeof raw.name === 'string' && raw.name.trim())
          ? raw.name.trim()
          : (typeof raw.Element_Name === 'string' && raw.Element_Name.trim())
            ? raw.Element_Name.trim()
            : current?.name || id
        const rawType = (typeof raw.type === 'string' && raw.type.trim())
          ? raw.type.trim()
          : (typeof raw.Element_Type === 'string' && raw.Element_Type.trim())
            ? raw.Element_Type.trim()
            : ''

        const inferredType = (() => {
          const upper = id.toUpperCase()
          if (upper.includes('SCENE') || upper.includes('BG') || upper.includes('LOCATION')) return 'scene'
          if (
            upper.includes('PROP') ||
            upper.includes('OBJECT') ||
            upper.includes('ITEM') ||
            upper.includes('PILLOW') ||
            upper.includes('WEAPON') ||
            upper.includes('TOOL') ||
            upper.includes('VEHICLE') ||
            upper.includes('CAR')
          ) return 'object'
          return 'character'
        })()

        const type = ['character', 'scene', 'object'].includes(rawType)
          ? rawType
          : current?.type || inferredType

        const description = (typeof raw.description === 'string')
          ? raw.description
          : (typeof raw.Description === 'string')
            ? raw.Description
            : (typeof raw.visual_description === 'string')
              ? raw.visual_description
              : (typeof raw.visualDescription === 'string')
                ? raw.visualDescription
                : current?.description || ''

        const voice_profile = (typeof raw.voice_profile === 'string' && raw.voice_profile.trim())
          ? raw.voice_profile.trim()
          : (typeof raw.voiceProfile === 'string' && raw.voiceProfile.trim())
            ? raw.voiceProfile.trim()
            : current?.voice_profile

        const reference_images = Array.isArray(raw.reference_images)
          ? raw.reference_images.filter((v) => typeof v === 'string' && v.trim()).map((v) => (v as string).trim())
          : Array.isArray(raw.referenceImages)
            ? raw.referenceImages.filter((v) => typeof v === 'string' && v.trim()).map((v) => (v as string).trim())
            : current?.reference_images

        const image_url = typeof raw.image_url === 'string' ? raw.image_url : current?.image_url
        const cached_image_url = typeof raw.cached_image_url === 'string' ? raw.cached_image_url : current?.cached_image_url

        nextElements = {
          ...nextElements,
          [id]: {
            id,
            name,
            type,
            description,
            voice_profile,
            reference_images,
            image_url,
            cached_image_url,
            image_history: current?.image_history,
            created_at: current?.created_at || now
          }
        }
        elementsChanged = true
      }

      if (Array.isArray(elementsRaw)) {
        for (const item of elementsRaw) {
          if (!isRecord(item)) continue
          const id = (typeof item.id === 'string' && item.id.trim()) ? item.id.trim() : ''
          if (!id) continue
          applyElementPatch(id, item)
        }
      } else if (isRecord(elementsRaw)) {
        for (const [k, v] of Object.entries(elementsRaw)) {
          if (!isRecord(v)) continue
          const id = (typeof v.id === 'string' && v.id.trim()) ? v.id.trim() : k
          if (!id) continue
          applyElementPatch(id, v)
        }
      }

      const coreElementsRaw = briefObj ? pick(briefObj, 'core_elements', 'coreElements', 'Core_Elements') : undefined
      if (Array.isArray(coreElementsRaw)) {
        for (const v of coreElementsRaw) {
          if (typeof v !== 'string' || !v.trim()) continue
          const rawId = v.trim()
          const id = rawId.startsWith('Element_')
            ? rawId
            : `Element_${rawId.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')}`
          if (!id || nextElements[id]) continue
          applyElementPatch(id, { name: id })
        }
      }

      // --- segments/shots ---
      const segmentsRaw = pick(
        root,
        'segments',
        'Storyboard_With_Prompts',
        'storyboard_with_prompts',
        'storyboard',
        'Storyboard'
      )

      let nextSegments = segments
      let segmentsChanged = false

      const parseDuration = (val: unknown): number | null => {
        if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val
        if (typeof val === 'string') {
          const n = Number.parseFloat(val)
          if (Number.isFinite(n) && n > 0) return n
        }
        return null
      }

      const segmentsArray: unknown[] | null = Array.isArray(segmentsRaw)
        ? segmentsRaw
        : isRecord(segmentsRaw) && Array.isArray(segmentsRaw.segments)
          ? (segmentsRaw.segments as unknown[])
          : null

      const looksLikeShotList =
        segmentsArray &&
        segmentsArray.length > 0 &&
        isRecord(segmentsArray[0]) &&
        !Array.isArray((segmentsArray[0] as { shots?: unknown }).shots) &&
        (
          'shot_id' in segmentsArray[0] ||
          'shotId' in segmentsArray[0] ||
          'scene' in segmentsArray[0] ||
          'image_prompt' in segmentsArray[0] ||
          'video_prompt' in segmentsArray[0]
        )

      if (looksLikeShotList && segmentsArray) {
        const normalizeShotId = (rawId: unknown, idx: number) => {
          if (typeof rawId === 'string' && rawId.trim()) {
            const rid = rawId.trim()
            if (rid.startsWith('Shot_')) return rid
            if (/^\d+$/.test(rid)) return `Shot_${rid}`
            const slug = rid.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || `${idx + 1}`
            return `Shot_${slug}`
          }
          if (typeof rawId === 'number' && Number.isFinite(rawId)) return `Shot_${rawId}`
          return `Shot_${idx + 1}`
        }

        const segsCopy: AgentSegment[] = segments.map(seg => ({
          ...seg,
          shots: seg.shots.map(shot => ({ ...shot }))
        }))

        const findShot = (shotId: string): { segIdx: number; shotIdx: number } | null => {
          for (let segIdx = 0; segIdx < segsCopy.length; segIdx += 1) {
            const shots = segsCopy[segIdx].shots || []
            for (let shotIdx = 0; shotIdx < shots.length; shotIdx += 1) {
              if (shots[shotIdx].id === shotId) return { segIdx, shotIdx }
            }
          }
          return null
        }

        let targetSegIdx = segsCopy.findIndex((s) => s.id === 'Segment_1')
        if (targetSegIdx < 0) {
          segsCopy.push({ id: 'Segment_1', name: 'Storyboard', description: '', shots: [], created_at: now })
          targetSegIdx = segsCopy.length - 1
        }
        const targetSeg = segsCopy[targetSegIdx]

        let touched = false
        for (let i = 0; i < segmentsArray.length; i += 1) {
          const shotItem = segmentsArray[i]
          if (!isRecord(shotItem)) continue

          const shotId = normalizeShotId(pick(shotItem, 'id', 'shot_id', 'shotId'), i)
          if (!shotId) continue

          const loc = findShot(shotId)
          const shotObj: AgentShot = loc
            ? segsCopy[loc.segIdx].shots[loc.shotIdx]
            : {
                id: shotId,
                name: shotId,
                type: 'standard',
                description: '',
                prompt: '',
                narration: '',
                duration: 5,
                status: 'pending',
                created_at: now
              }

          const sName = pick(shotItem, 'name', 'shot_name', 'scene', 'title')
          const sType = pick(shotItem, 'type', 'shot_type')
          const sDesc = pick(shotItem, 'description', 'shot_description', 'visual_description', 'visualDescription')
          const sPrompt = pick(shotItem, 'prompt', 'image_prompt', 'imagePrompt')
          const sVideoPrompt = pick(shotItem, 'video_prompt', 'videoPrompt')
          const sNarr = pick(shotItem, 'narration', 'audio', 'voiceover')
          const sDialogue = pick(shotItem, 'dialogue_script', 'dialogueScript')
          const sDur = parseDuration(pick(shotItem, 'duration', 'duration_seconds', 'durationSeconds'))

          if (typeof sName === 'string' && sName.trim()) shotObj.name = sName.trim()
          if (typeof sType === 'string' && sType.trim()) shotObj.type = sType.trim()
          if (typeof sDesc === 'string') shotObj.description = sDesc
          if (typeof sPrompt === 'string') shotObj.prompt = sPrompt
          if (typeof sVideoPrompt === 'string') shotObj.video_prompt = sVideoPrompt
          if (typeof sNarr === 'string') shotObj.narration = sNarr
          if (typeof sDialogue === 'string') shotObj.dialogue_script = sDialogue
          if (sDur != null) shotObj.duration = sDur

          if (!loc) {
            targetSeg.shots = [...targetSeg.shots, shotObj]
          }
          touched = true
        }

        if (touched) {
          nextSegments = segsCopy
          segmentsChanged = true
        }
      } else if (segmentsArray && segmentsArray.length > 0) {
        const segsCopy: AgentSegment[] = segments.map(seg => ({
          ...seg,
          shots: seg.shots.map(shot => ({ ...shot }))
        }))
        const segIndex = new Map(segsCopy.map((s, idx) => [s.id, idx]))

        for (const segItem of segmentsArray) {
          if (!isRecord(segItem)) continue
          const segIdVal = pick(segItem, 'id', 'segment_id', 'segmentId')
          const segId = typeof segIdVal === 'string' && segIdVal.trim() ? segIdVal.trim() : ''
          if (!segId) continue

          const existingIdx = segIndex.get(segId)
          const segObj: AgentSegment = existingIdx != null
            ? segsCopy[existingIdx]
            : {
                id: segId,
                name: segId,
                description: '',
                shots: [],
                created_at: now
              }

          const segName = pick(segItem, 'name', 'segment_name')
          const segDesc = pick(segItem, 'description', 'segment_description')
          if (typeof segName === 'string' && segName.trim()) segObj.name = segName.trim()
          if (typeof segDesc === 'string') segObj.description = segDesc

          const shotsRaw = pick(segItem, 'shots', 'Shots')
          if (Array.isArray(shotsRaw)) {
            const shotIndex = new Map(segObj.shots.map((s, idx) => [s.id, idx]))
            for (const shotItem of shotsRaw) {
              if (!isRecord(shotItem)) continue
              const shotIdVal = pick(shotItem, 'id', 'shot_id', 'shotId')
              const shotId = typeof shotIdVal === 'string' && shotIdVal.trim() ? shotIdVal.trim() : ''
              if (!shotId) continue

              const sidx = shotIndex.get(shotId)
              const shotObj: AgentShot = sidx != null
                ? segObj.shots[sidx]
                : {
                    id: shotId,
                    name: shotId,
                    type: 'standard',
                    description: '',
                    prompt: '',
                    narration: '',
                    duration: 5,
                    status: 'pending',
                    created_at: now
                  }

              const sName = pick(shotItem, 'name', 'shot_name')
              const sType = pick(shotItem, 'type', 'shot_type')
              const sDesc = pick(shotItem, 'description', 'shot_description')
              const sPrompt = pick(shotItem, 'prompt')
              const sVideoPrompt = pick(shotItem, 'video_prompt', 'videoPrompt')
              const sNarr = pick(shotItem, 'narration')
              const sDialogue = pick(shotItem, 'dialogue_script', 'dialogueScript')
              const sDur = parseDuration(pick(shotItem, 'duration'))

              if (typeof sName === 'string' && sName.trim()) shotObj.name = sName.trim()
              if (typeof sType === 'string' && sType.trim()) shotObj.type = sType.trim()
              if (typeof sDesc === 'string') shotObj.description = sDesc
              if (typeof sPrompt === 'string') shotObj.prompt = sPrompt
              if (typeof sVideoPrompt === 'string') shotObj.video_prompt = sVideoPrompt
              if (typeof sNarr === 'string') shotObj.narration = sNarr
              if (typeof sDialogue === 'string') shotObj.dialogue_script = sDialogue
              if (sDur != null) shotObj.duration = sDur

              if (sidx == null) {
                segObj.shots = [...segObj.shots, shotObj]
                shotIndex.set(shotId, segObj.shots.length - 1)
              }
            }
          }

          if (existingIdx == null) {
            segsCopy.push(segObj)
            segIndex.set(segId, segsCopy.length - 1)
          } else {
            segsCopy[existingIdx] = { ...segObj, shots: [...segObj.shots] }
          }
        }

        nextSegments = segsCopy
        segmentsChanged = true
      }

      if (!briefChanged && !elementsChanged && !segmentsChanged) {
        addMessage('assistant', '⚠️ 未发现可应用的变更')
        return
      }

      if (briefChanged) setCreativeBrief(nextCreativeBrief)
      if (elementsChanged) {
        setElements(nextElements)
        setExpandedElements(prev => new Set([...Array.from(prev), ...Object.keys(nextElements)]))
      }
      if (segmentsChanged) {
        setSegments(nextSegments)
        setExpandedSegments(prev => new Set([...Array.from(prev), ...nextSegments.map(s => s.id)]))
      }

      setActiveModule('storyboard')
      setHasUnsavedChanges(true)

      if (projectId) {
        try {
          const updates: Partial<AgentProject> = {}
          if (briefChanged) updates.creative_brief = nextCreativeBrief
          if (elementsChanged) updates.elements = nextElements
          if (segmentsChanged) updates.segments = nextSegments
          await updateAgentProject(projectId, updates)
          addMessage('assistant', '✅ 已应用到故事板并保存')
        } catch (e) {
          console.error('[AgentPage] apply_agent_patch save failed:', e)
          addMessage('assistant', `❌ 保存失败：${e instanceof Error ? e.message : '未知错误'}`)
        }
      } else {
        addMessage('assistant', '✅ 已应用到故事板（未保存项目），可点击左下角保存')
      }
      */
    } else if (action === 'view_storyboard') {
      // 切换到分镜面板并展开所有相关卡片
      setActiveModule('storyboard')
      // 展开所有任务卡片
      setExpandedCards(new Set(['brief', 'storyboard', 'visual', 'genPath']))
      // 展开所有元素和段落
      setExpandedElements(new Set(Object.keys(elements)))
      setExpandedSegments(new Set(segments.map(s => s.id)))
      
      // 设置下一步等待确认
      setWaitingForConfirm('generate_elements')
      
      addMessage('assistant', `好的，让我们来看看分镜设计 📽️

我已经为你展开了所有面板：
- **左侧** 查看角色元素和分镜序列
- **右侧** 查看 Creative Brief、故事板概览、Visual Assets

每个镜头都包含：
- 📝 镜头描述和提示词
- 🎭 涉及的角色元素
- 🗣️ 对应的旁白文本
- ⏱️ 预计时长

确认分镜没问题后，我们可以开始生成素材。`, undefined, [
        { id: 'gen_elements', label: '🎨 生成角色图片', value: 'generate_elements' },
        { id: 'gen_all', label: '🚀 一键生成全部', value: 'execute_pipeline' }
      ], { label: '开始生成角色图片', action: 'generate_elements' })
    }
  }

  // 中断当前操作
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    if (generationCancelRef.current) {
      generationCancelRef.current()
      generationCancelRef.current = null
    }
    setSending(false)
    setGenerationProgress(null)
    setGenerationStage('idle')
    addMessage('assistant', '⏹️ 已中断操作')
  }

  // 发送消息
  const handleSendMessage = async () => {
    if ((!inputMessage.trim() && uploadedFiles.length === 0) || sending) return
    
    const userMsg = inputMessage
    const files = uploadedFiles
    
    // 构建包含文件信息的消息（用于显示）
    let displayContent = userMsg
    if (files.length > 0) {
      const fileInfo = files.map(f => `[附件: ${f.name}]`).join(' ')
      displayContent = userMsg ? `${userMsg}\n${fileInfo}` : fileInfo
    }
    
    // 构建发送给 AI 的消息（包含文件内容）
    let aiMessageContent = userMsg
    if (files.length > 0) {
      const fileContents: string[] = []
      for (const f of files) {
        if (f.content) {
          // 文本文件，直接使用内容
          fileContents.push(`\n\n--- 文件: ${f.name} ---\n${f.content}\n--- 文件结束 ---`)
        } else if (f.type === 'image' && f.dataUrl) {
          // 图片文件，提供 URL 引用
          fileContents.push(`\n[图片: ${f.name}, URL: ${f.url || f.dataUrl}]`)
        } else {
          // 其他文件，提供基本信息
          fileContents.push(`\n[文件: ${f.name}, 类型: ${f.mimeType}, 大小: ${(f.size / 1024).toFixed(1)}KB]`)
        }
      }
      aiMessageContent = userMsg + fileContents.join('')
    }
    
    addMessage('user', displayContent)
    setInputMessage('')
    setUploadedFiles([]) // 清空上传的文件
    setSending(true)
    
    // 创建新的 AbortController
    abortControllerRef.current = new AbortController()

    try {
      // 检测是否是确认指令（当有等待确认的操作时）
      const confirmPatterns = ['1', '确认', '确定', '好的', '继续', '下一步', 'ok', 'yes', '是']
      if (waitingForConfirm && confirmPatterns.some(p => userMsg.trim().toLowerCase() === p.toLowerCase())) {
        await handleConfirmClick(waitingForConfirm)
        return
      }
      
      // 检测是否是选择操作的指令
      if (userMsg.trim() === '2' && segments.length > 0) {
        // 调整规划细节 - 暂时提示
        addMessage('assistant', '好的，请告诉我你想调整哪些细节？比如：\n- 修改某个镜头的时长\n- 调整视觉风格\n- 增加或删除某个角色')
        return
      }
      if (userMsg.trim() === '3' && segments.length > 0) {
        // 补充其他需求
        addMessage('assistant', '请补充你的需求，比如：\n- 特定角色的外观设定\n- 场景的具体要求\n- 音乐或旁白的风格')
        return
      }
      
      // 检测是否是创作请求（仅在“尚未有分镜结构”时触发，避免把“生成起始帧/重生成/提示词修改”等误判为新项目规划）
      const hasStoryboardStructure = segments.length > 0 || Object.keys(elements).length > 0
      const looksLikeVideoBrief =
        /时长|分钟|秒|画风|风格|2d|3d|动漫|动画|短片|视频|故事|剧情|广告|宣传|教程|科普/i.test(userMsg) ||
        /\d+(?:\.\d+)?\s*(?:min|s)\b/i.test(userMsg.trim().toLowerCase())
      const looksLikeStoryboardRequest = /分镜|拆解|脚本|故事板|storyboard|shot/i.test(userMsg)
      const isCreationRequest =
        !hasStoryboardStructure &&
        (userMsg.includes('制作') ||
          userMsg.includes('创建') ||
          userMsg.includes('做一个') ||
          // “生成”太泛：仅在明确“生成一个视频/短片/动画”等场景下才当作创作请求
          (userMsg.includes('生成') && (userMsg.includes('视频') || userMsg.includes('短片') || userMsg.includes('动画'))) ||
          looksLikeVideoBrief ||
          looksLikeStoryboardRequest)

      if (isCreationRequest) {
        setGenerationStage('planning')
        
        addMessage('assistant', `收到！让我来分析你的需求... 🤔

**正在执行：**
- 📋 创建项目概要
- 📝 编写剧本
- 🎬 设计分镜
- 💰 制定生成路径`, undefined, undefined, undefined, [
          { label: 'Agent分析中', completed: false }
        ])
        
        const planResult = await agentPlanProject(aiMessageContent)
        
        if (planResult.success && planResult.plan) {
          const plan = planResult.plan
          
          setCreativeBrief({
            title: plan.creative_brief.title,
            videoType: plan.creative_brief.video_type,
            narrativeDriver: plan.creative_brief.narrative_driver,
            emotionalTone: plan.creative_brief.emotional_tone,
            visualStyle: plan.creative_brief.visual_style,
            duration: plan.creative_brief.duration,
            aspectRatio: plan.creative_brief.aspect_ratio,
            language: plan.creative_brief.language,
            narratorVoiceProfile: plan.creative_brief.narratorVoiceProfile || plan.creative_brief.narrator_voice_profile
          })
          setProjectName(plan.creative_brief.title || projectName)
          
          const newElements: Record<string, AgentElement> = {}
           for (const elem of plan.elements) {
             newElements[elem.id] = {
               id: elem.id,
               name: elem.name,
               type: elem.type,
               description: elem.description,
               voice_profile: elem.voice_profile,
               created_at: new Date().toISOString()
             }
           }
          setElements(newElements)
          setExpandedElements(new Set(Object.keys(newElements)))
          
          const newSegments: AgentSegment[] = plan.segments.map(seg => ({
            id: seg.id,
            name: seg.name,
            description: seg.description,
             shots: seg.shots.map(shot => ({
               id: shot.id,
               name: shot.name,
               type: shot.type,
               description: shot.description,
               prompt: shot.prompt,
               video_prompt: shot.video_prompt,
               dialogue_script: shot.dialogue_script,
               narration: shot.narration,
               duration: parseFloat(shot.duration) || 5,
               status: 'pending',
               created_at: new Date().toISOString()
             })),
            created_at: new Date().toISOString()
          }))
          setSegments(newSegments)
          setExpandedSegments(new Set(newSegments.map(s => s.id)))
          // 展开所有任务卡片（右侧面板）
          setExpandedCards(new Set(['brief', 'storyboard', 'visual', 'genPath']))
          // 切换到分镜模块以显示左侧面板
          setActiveModule('storyboard')
          
          const totalShots = newSegments.reduce((acc, s) => acc + s.shots.length, 0)
          const totalDuration = newSegments.reduce((acc, s) => 
            acc + s.shots.reduce((a, shot) => a + (shot.duration || 5), 0), 0)
          
          setGenerationStage('idle')
          setWaitingForConfirm('view_storyboard')
          
          // 自动保存项目
          try {
             const newBrief = {
               title: plan.creative_brief.title,
               videoType: plan.creative_brief.video_type,
               narrativeDriver: plan.creative_brief.narrative_driver,
               emotionalTone: plan.creative_brief.emotional_tone,
               visualStyle: plan.creative_brief.visual_style,
               duration: plan.creative_brief.duration,
               aspectRatio: plan.creative_brief.aspect_ratio,
               language: plan.creative_brief.language,
               narratorVoiceProfile: plan.creative_brief.narratorVoiceProfile || plan.creative_brief.narrator_voice_profile
             }
            const newProject = await createAgentProject(plan.creative_brief.title || projectName, newBrief)
            setProjectId(newProject.id)
            // 更新项目数据
            await updateAgentProject(newProject.id, {
              elements: newElements,
              segments: newSegments
            })
            navigate(`/agent/${newProject.id}`, { replace: true })
            console.log('[Agent] 项目已自动保存:', newProject.id)
          } catch (saveError) {
            console.error('[Agent] 自动保存失败:', saveError)
          }
          
          addMessage('assistant', `✅ **Agent分析完成！**

我已经为「${plan.creative_brief.title}」制定了完整的制作方案：

---

**📋 Creative Brief**
- Video Type: ${plan.creative_brief.video_type}
- Narrative Driver: ${plan.creative_brief.narrative_driver}
- 视觉风格: ${plan.creative_brief.visual_style}
- Duration: ${plan.creative_brief.duration}
- Aspect Ratio: ${plan.creative_brief.aspect_ratio}

---

**🎬 故事板**
- ${newSegments.length} 个段落
- ${totalShots} 个镜头
- 预计时长 ${Math.round(totalDuration)} 秒

---

**👥 关键角色**
${plan.elements.map(e => `- ${e.name} (${e.type})`).join('\n')}

---

**💰 预估成本**
- 角色设计: ${plan.cost_estimate.elements}
- 镜头生成: ${plan.cost_estimate.shots}
- 音频制作: ${plan.cost_estimate.audio}
- **总计: ${plan.cost_estimate.total}**

---

接下来，你可以：`, plan, [
            { id: 'view_sb', label: '📽️ 先让我看看分镜', value: 'view_storyboard' },
            { id: 'gen_all', label: '🚀 一键生成全部', value: 'execute_pipeline' },
            { id: 'gen_char', label: '🎨 先生成角色图片', value: 'generate_elements' }
          ], { label: '先让我看看分镜', action: 'view_storyboard' }, [
            { label: 'Agent分析完成', completed: true },
            { label: '资产配置完成', completed: true }
          ])
        } else {
          setGenerationStage('idle')
          const result = await agentChat(aiMessageContent, projectId || undefined, {
            elements,
            segments,
            chat_history: messages.slice(-20).map((m) => ({ role: m.role, content: m.content }))
          })
          const isPatch = looksLikeAgentPatch(result.data)
          const autoApplyPatch = isPatch && !result.confirmButton
          const confirmButton = autoApplyPatch
            ? undefined
            : result.confirmButton ||
              (isPatch
                ? { label: '应用到故事板', action: 'apply_agent_patch', payload: result.data }
                : undefined)
          addMessage('assistant', result.content, result.data, result.options, confirmButton, result.progress)

          if (autoApplyPatch) {
            await handleConfirmClick('apply_agent_patch', result.data)
          }
        }
      } else {
        const result = await agentChat(aiMessageContent, projectId || undefined, {
          elements,
          segments,
          chat_history: messages.slice(-20).map((m) => ({ role: m.role, content: m.content }))
        })
        const isPatch = looksLikeAgentPatch(result.data)
        const autoApplyPatch = isPatch && !result.confirmButton
        const confirmButton = autoApplyPatch
          ? undefined
          : result.confirmButton ||
            (isPatch
              ? { label: '应用到故事板', action: 'apply_agent_patch', payload: result.data }
              : undefined)
        addMessage('assistant', result.content, result.data, result.options, confirmButton, result.progress)

        if (autoApplyPatch) {
          await handleConfirmClick('apply_agent_patch', result.data)
        }
      }
    } catch (error: unknown) {
      console.error('发送失败:', error)
      setGenerationStage('idle')
      // 忽略中断错误
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      addMessage('assistant', `❌ 出现错误：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setSending(false)
      abortControllerRef.current = null
    }
  }

  // ========== 批量生成功能 ==========
  
  // 生成所有元素图片（流式）
  const handleGenerateAllElements = async () => {
    if (!projectId) {
      await handleSaveProject(false)
    }
    
    const pid = projectId || (await createAgentProject(projectName, creativeBrief)).id
    if (!projectId) setProjectId(pid)
    
    setGenerationStage('elements')
    const elementCount = Object.keys(elements).length
    
    addMessage('assistant', `🎨 **开始生成角色图片**

**第一步** 为每个角色生成优化的提示词
**第二步** 调用图像生成模型 (Nano Banana Pro)
**第三步** 生成 2K 高清角色设计图

共 ${elementCount} 个角色，实时展示生成进度...`, undefined, undefined, undefined, [
      { label: '生成角色图片', completed: false }
    ])
    
    try {
      // 使用流式生成
      await new Promise<void>((resolve, reject) => {
        const cancel = generateProjectElementsStream(
          pid,
          creativeBrief.visualStyle || '吉卜力动画风格',
          (event) => {
            if (event.type === 'generating') {
              // 更新生成中状态
              setGeneratingElement(event.element_id || null)
            } else if (event.type === 'complete') {
              // 实时更新元素图片
              if (event.element_id && event.image_url) {
                setElements(prev => ({
                  ...prev,
                  [event.element_id!]: {
                    ...prev[event.element_id!],
                    image_url: event.source_url || event.image_url,
                    cached_image_url: event.source_url && event.image_url?.startsWith('/api/') ? event.image_url : prev[event.element_id!].cached_image_url
                  }
                }))
              }
              setGeneratingElement(null)
            } else if (event.type === 'done') {
              // 生成完成
              const successMsg = event.failed === 0 
                ? `✅ **角色图片生成完成！**

成功生成 ${event.generated} 个角色设计图。

你可以在左侧「关键元素」面板中查看所有生成的图片。`
                : `⚠️ **角色图片生成部分完成**

- 成功：${event.generated} 个
- 失败：${event.failed} 个

失败的角色可以在左侧面板单独重试。`
              
              addMessage('assistant', successMsg, undefined, undefined, 
                { label: '继续生成起始帧', action: 'generate_frames' },
                [
                  { label: '生成角色图片', completed: true },
                  { label: '生成起始帧', completed: false }
                ]
              )
              
              setGenerationStage('idle')
              generationCancelRef.current = null
              setGeneratingElement(null)
              resolve()
            } else if (event.type === 'error') {
              console.error('元素生成失败:', event.element_id, event.error)
            }
          },
          (error) => {
            generationCancelRef.current = null
            reject(error)
          }
        )
        
        // 保存取消函数以便需要时取消
        generationCancelRef.current = cancel
      })
      
    } catch (error) {
      console.error('生成失败:', error)
      addMessage('assistant', `❌ 生成失败：${error instanceof Error ? error.message : '未知错误'}`)
      setGenerationStage('idle')
      setGeneratingElement(null)
    }
  }
  
  // 生成所有起始帧
  const handleGenerateAllFrames = async (options?: { excludeShotIds?: string[]; mode?: 'missing' | 'regenerate' }) => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存项目')
      return
    }

    setGenerationStage('frames')
    setGenerationProgress({ current: 0, total: 0, percent: 0 })
    const totalShots = segments.reduce((acc, s) => acc + s.shots.length, 0)
    const excludeCount = options?.excludeShotIds?.filter(Boolean).length || 0
    const mode = options?.mode || 'missing'

    addMessage('assistant', `🖼️ **开始生成起始帧**

**第一步** 解析镜头提示词中的角色引用
**第二步** 构建完整的场景描述
**第三步** 生成每个镜头的第一帧静态画面

模式：${mode === 'regenerate' ? '强制重生成（即使已有起始帧也会重新出图）' : '补齐缺失（已有起始帧的镜头会跳过）'}
共 ${totalShots} 个镜头${excludeCount > 0 ? `（将跳过 ${excludeCount} 个指定镜头）` : ''}，实时显示进度...`, undefined, undefined, undefined, [
      { label: '生成角色图片', completed: true },
      { label: '生成起始帧', completed: false }
    ])

    let generated = 0
    let failed = 0

    const cancelStream = generateProjectFramesStream(
      projectId,
      creativeBrief.visualStyle || '吉卜力动画风格',
      (event: FrameStreamEvent) => {
        switch (event.type) {
          case 'start':
            setGenerationProgress({
              current: 0,
              total: event.total || 0,
              percent: 0,
              stage: '准备中'
            })
            break
          case 'skip':
            setGenerationProgress({
              current: event.current || 0,
              total: event.total || 0,
              percent: event.percent || 0,
              currentItem: event.shot_name || `镜头 ${event.current}`,
              stage: event.reason === 'excluded' ? '跳过（排除）' : '跳过（已有起始帧）'
            })
            break
          case 'generating':
            setGenerationProgress({
              current: event.current || 0,
              total: event.total || 0,
              percent: event.percent || 0,
              currentItem: event.shot_name || `镜头 ${event.current}`,
              stage: event.stage === 'prompt' ? '构建提示词' : '生成图片'
            })
            break
          case 'complete':
            generated++
            setGenerationProgress({
              current: event.current || 0,
              total: event.total || 0,
              percent: event.percent || 0,
              currentItem: event.shot_name || `镜头 ${event.current}`,
              stage: '完成'
            })
            // 实时更新镜头图片
            if (event.shot_id && event.image_url) {
              setSegments(prev => prev.map(seg => ({
                ...seg,
                shots: seg.shots.map(shot =>
                  shot.id === event.shot_id
                    ? {
                        ...shot,
                        start_image_url: event.source_url || event.image_url,
                        cached_start_image_url: event.source_url && event.image_url?.startsWith('/api/') ? event.image_url : shot.cached_start_image_url,
                        status: 'frame_ready'
                      }
                    : shot
                )
              })))
            }
            break
          case 'error':
            failed++
            if (event.shot_id) {
              // 标记失败，避免前端仍显示 pending
              setSegments(prev => prev.map(seg => ({
                ...seg,
                shots: seg.shots.map(shot =>
                  shot.id === event.shot_id
                    ? { ...shot, status: 'frame_failed' }
                    : shot
                )
              })))
            }
            if (event.shot_name || event.error) {
              console.error('[AgentPage] frame generation failed:', event.shot_id, event.shot_name, event.error)
            }
            break
          case 'done':
            setGenerationProgress(null)
            loadProject(projectId)
            addMessage('assistant', `✅ **起始帧生成完成！**

成功生成 ${event.generated} 个镜头的起始帧。
${event.failed && event.failed > 0 ? `\n⚠️ ${event.failed} 个镜头生成失败` : ''}

接下来，我们将把这些静态画面转化为动态视频。`, undefined, undefined,
              { label: '开始生成视频', action: 'generate_videos' },
              [
                { label: '生成角色图片', completed: true },
                { label: '生成起始帧', completed: true },
                { label: '生成视频', completed: false }
              ]
            )
            setGenerationStage('idle')
            generationCancelRef.current = null
            break
        }
      },
      (error) => {
        console.error('生成失败:', error)
        setGenerationProgress(null)
        addMessage('assistant', `❌ 生成失败：${error.message}`)
        setGenerationStage('idle')
        generationCancelRef.current = null
      },
      options
    )

    // 保存取消函数以便需要时调用
    generationCancelRef.current = cancelStream
    return cancelStream
  }

  // 生成所有视频
  const handleGenerateAllVideos = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存项目')
      return
    }

    setGenerationStage('videos')
    setGenerationProgress({ current: 0, total: 0, percent: 0, phase: 'submit' })

    addMessage('assistant', `🎬 **开始生成视频**

**第一步** 准备起始帧和动态提示词
**第二步** 调用视频生成模型 (Seedance 1.5 Pro)
**第三步** 生成 720p 动态视频片段

实时显示生成进度...`, undefined, undefined, undefined, [
      { label: '生成角色图片', completed: true },
      { label: '生成起始帧', completed: true },
      { label: '生成视频', completed: false }
    ])

    const cancelStream = generateProjectVideosStream(
      projectId,
      '720p',
      (event: VideoStreamEvent) => {
        switch (event.type) {
          case 'start':
            setGenerationProgress({
              current: 0,
              total: event.total || 0,
              percent: 0,
              phase: 'submit',
              stage: '准备提交任务'
            })
            break
          case 'submitting':
            setGenerationProgress({
              current: event.current || 0,
              total: event.total || 0,
              percent: event.percent || 0,
              currentItem: event.shot_name || `镜头 ${event.current}`,
              phase: 'submit',
              stage: '提交中'
            })
            break
          case 'submitted':
            setGenerationProgress({
              current: event.current || 0,
              total: event.total || 0,
              percent: event.percent || 0,
              currentItem: event.shot_name || `镜头 ${event.current}`,
              phase: 'submit',
              stage: '已提交'
            })
            break
          case 'polling_start':
            setGenerationProgress({
              current: 0,
              total: event.pending || 0,
              percent: event.percent || 50,
              phase: 'poll',
              stage: '等待生成完成'
            })
            break
          case 'polling':
            setGenerationProgress({
              current: (event.completed || 0),
              total: (event.pending || 0) + (event.completed || 0),
              percent: event.percent || 50,
              phase: 'poll',
              stage: `等待中 (${event.elapsed || 0}秒)`
            })
            break
          case 'complete':
            setGenerationProgress({
              current: event.completed || 0,
              total: event.total || 0,
              percent: event.percent || 0,
              currentItem: event.shot_name,
              phase: event.phase,
              stage: '完成'
            })
            // 实时更新视频 URL
            if (event.shot_id && event.video_url) {
              setSegments(prev => prev.map(seg => ({
                ...seg,
                shots: seg.shots.map(shot =>
                  shot.id === event.shot_id
                    ? { ...shot, video_url: event.video_url, status: 'video_ready' }
                    : shot
                )
              })))
            }
            break
          case 'error':
            // 单个视频失败不中断整体流程
            break
          case 'timeout':
            addMessage('assistant', `⏳ **部分视频生成超时**

${event.message}

你可以稍后重试或查看已完成的视频。`)
            break
          case 'done':
            setGenerationProgress(null)
            loadProject(projectId)

            if (event.completed === 0 && event.failed === 0 && event.skipped === event.total) {
              addMessage('assistant', `ℹ️ 所有镜头已有视频，无需重新生成。`)
            } else {
              addMessage('assistant', `🎉 **视频生成完成！**

成功生成 ${event.completed} 个视频片段。
${event.failed && event.failed > 0 ? `\n⚠️ ${event.failed} 个视频生成失败` : ''}

所有视频素材已准备就绪！你可以：
- 在「时间轴」面板预览和编辑
- 调整片段顺序和时长
- 添加旁白和背景音乐
- 导出最终视频`, undefined, [
                { id: 'view_timeline', label: '📽️ 查看时间轴', value: 'view_timeline' },
                { id: 'gen_audio', label: '🎵 生成音频', value: 'generate_audio' }
              ], undefined, [
                { label: '生成角色图片', completed: true },
                { label: '生成起始帧', completed: true },
                { label: '生成视频', completed: true },
                { label: '生成素材完成', completed: true }
              ])
            }

            setGenerationStage('complete')
            generationCancelRef.current = null
            break
        }
      },
      (error) => {
        console.error('生成失败:', error)
        setGenerationProgress(null)
        addMessage('assistant', `❌ 生成失败：${error.message}`)
        setGenerationStage('idle')
        generationCancelRef.current = null
      }
    )

    // 保存取消函数以便需要时调用
    generationCancelRef.current = cancelStream
    return cancelStream
  }

  // 一键生成全部
  const handleExecutePipeline = async () => {
    if (!projectId) {
      await handleSaveProject(false)
    }
    
    const pid = projectId || (await createAgentProject(projectName, creativeBrief)).id
    if (!projectId) setProjectId(pid)
    
    setGenerationStage('elements')
    
    addMessage('assistant', `🚀 **开始一键生成全部素材**

我将依次执行以下步骤：

**第一步** 🎨 生成角色设计图 (Nano Banana Pro 2K)
**第二步** 🖼️ 生成镜头起始帧 (Nano Banana Pro 2K)
**第三步** 🎬 生成动态视频 (Seedance 1.5 Pro 720p)

整个过程可能需要几分钟，请耐心等待...`, undefined, undefined, undefined, [
      { label: '生成角色图片', completed: false },
      { label: '生成起始帧', completed: false },
      { label: '生成视频', completed: false }
    ])
    
    try {
      const result = await executeProjectPipeline(
        pid,
        creativeBrief.visualStyle || '吉卜力动画风格',
        '720p'
      )
      
      await loadProject(pid)
      
      const stagesInfo = []
      if (result.stages.elements) {
        stagesInfo.push(`🎨 角色图片：${result.stages.elements.generated}/${result.stages.elements.total}`)
      }
      if (result.stages.frames) {
        stagesInfo.push(`🖼️ 起始帧：${result.stages.frames.generated}/${result.stages.frames.total}`)
      }
      if (result.stages.videos) {
        stagesInfo.push(`🎬 视频：${result.stages.videos.generated}/${result.stages.videos.total}`)
      }
      
      addMessage('assistant', `${result.success ? '🎉' : '⚠️'} **生成流程${result.success ? '完成' : '部分完成'}！**

${stagesInfo.join('\n')}

---

**总计生成：${result.total_generated} 个素材**
${result.total_failed > 0 ? `**失败：${result.total_failed} 个**` : ''}

${result.success 
  ? '所有素材已准备就绪！你可以在时间轴面板预览和导出视频。' 
  : '部分素材生成失败，可以在对应面板重试。'}`, undefined, [
        { id: 'view_timeline', label: '📽️ 查看时间轴', value: 'view_timeline' },
        { id: 'gen_audio', label: '🎵 生成音频', value: 'generate_audio' }
      ], undefined, [
        { label: '生成角色图片', completed: true },
        { label: '生成起始帧', completed: true },
        { label: '生成视频', completed: true },
        { label: '生成素材完成', completed: result.success }
      ])
      
      setGenerationStage(result.success ? 'complete' : 'idle')
    } catch (error) {
      console.error('执行失败:', error)
      addMessage('assistant', `❌ 执行失败：${error instanceof Error ? error.message : '未知错误'}`)
      setGenerationStage('idle')
    }
  }

  // 为单个元素生成图片
  const handleGenerateElementImage = async (elementId: string) => {
    const element = elements[elementId]
    if (!element) return
    
    setGeneratingElement(elementId)
    
    try {
      const promptResult = await agentGenerateElementPrompt(
        element.name,
        element.type,
        element.description,
        creativeBrief.visualStyle || '吉卜力动画风格'
      )
      
      if (promptResult.success && promptResult.prompt) {
        const imageResult = await generateImage(
          promptResult.prompt,
          promptResult.negative_prompt,
          { width: 1024, height: 1024 }
        )
        
        // 创建新的图片历史记录
        const newImageRecord = {
          id: `img_${Date.now()}`,
          url: imageResult.imageUrl,
          created_at: new Date().toISOString(),
          is_favorite: false
        }
        
        // 获取现有历史
        let existingHistory = element.image_history || []
        
        // 如果历史为空但有旧图片，先把旧图片加入历史
        if (existingHistory.length === 0 && element.image_url) {
          const oldImageRecord = {
            id: `img_old_${Date.now() - 1}`,
            url: element.image_url,
            created_at: element.created_at || new Date().toISOString(),
            is_favorite: false
          }
          existingHistory = [oldImageRecord]
        }
        
        // 将新图片插入到最前面
        const newHistory = [newImageRecord, ...existingHistory]
        
        // 检查是否有收藏的图片
        const hasFavorite = newHistory.some(img => img.is_favorite)
        
        // 更新后的元素数据
        const updatedElement = {
          ...element,
          image_url: hasFavorite ? element.image_url : imageResult.imageUrl,
          image_history: newHistory
        }
        
        // 更新前端状态
        setElements(prev => ({
          ...prev,
          [elementId]: updatedElement
        }))
        
        setVisualAssets(prev => [...prev, {
          id: `asset_${Date.now()}`,
          name: element.name,
          url: imageResult.imageUrl,
          type: 'element',
          elementId: element.id,
          status: 'completed'
        }])
        
        // 立即保存到后端
        if (projectId) {
          try {
            await updateAgentProject(projectId, {
              elements: {
                ...elements,
                [elementId]: updatedElement
              }
            })
            console.log('[AgentPage] 元素图片历史已保存')
          } catch (saveError) {
            console.error('[AgentPage] 保存元素图片历史失败:', saveError)
          }
        }
        
        setHasUnsavedChanges(true)
      }
    } catch (error) {
      console.error('生成图片失败:', error)
      addMessage('assistant', `❌ 生成 ${element.name} 图片失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setGeneratingElement(null)
    }
  }
  
  // 收藏元素图片
  const handleFavoriteElementImage = async (elementId: string, imageId: string) => {
    if (!projectId) return
    
    try {
      const result = await favoriteElementImage(projectId, elementId, imageId)
      if (result.success) {
        // 更新本地状态
        setElements(prev => {
          const element = prev[elementId]
          if (!element) return prev
          return {
            ...prev,
            [elementId]: { ...element, ...result.element }
          }
        })
        
        setHasUnsavedChanges(true)
      }
    } catch (error) {
      console.error('收藏图片失败:', error)
    }
  }

  // 收藏镜头起始帧
  const handleFavoriteShotImage = async (segmentId: string, shotId: string, imageId: string) => {
    if (!projectId) return
    
    try {
      const result = await favoriteShotImage(projectId, shotId, imageId)
      if (result.success) {
        // 更新本地状态
        setSegments(prev => prev.map(segment => {
          if (segment.id !== segmentId) return segment
          
          return {
            ...segment,
            shots: segment.shots.map(shot => {
              if (shot.id !== shotId) return shot
              return result.shot ? { ...shot, ...result.shot } : shot
            })
          }
        }))
        
        setHasUnsavedChanges(true)
      }
    } catch (error) {
      console.error('收藏起始帧失败:', error)
    }
  }

  const toggleElement = (id: string) => {
    setExpandedElements(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSegment = (id: string) => {
    setExpandedSegments(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddElement = () => {
    const newId = `Element_NEW_${Date.now()}`
    const newElement: AgentElement = {
      id: newId,
      name: newId,
      type: 'character',
      description: '请输入角色描述...',
      created_at: new Date().toISOString()
    }
    setElements(prev => ({ ...prev, [newId]: newElement }))
    setExpandedElements(prev => new Set([...prev, newId]))
    setEditingElement(newId)
    setHasUnsavedChanges(true)
  }

  const handleAddElementFromImage = async (payload: { url: string; name?: string }) => {
    const url = (payload.url || '').trim()
    if (!url) return

    const baseName = (payload.name || '').trim()
    const newId = `Element_NEW_${Date.now()}`
    const now = new Date().toISOString()

    const record = {
      id: `img_ref_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      url,
      source_url: url,
      created_at: now,
      is_favorite: true
    }

    const newElement: AgentElement = {
      id: newId,
      name: baseName || newId,
      type: 'character',
      description: '（从图片导入）请补充该角色/元素的外观与关键信息...',
      image_url: url,
      cached_image_url: url.startsWith('/api/uploads/') ? url : undefined,
      image_history: [record],
      reference_images: [url],
      created_at: now
    }

    const nextElements = { ...elements, [newId]: newElement }
    setElements(nextElements)
    setExpandedElements(prev => new Set([...prev, newId]))
    setEditingElement(newId)
    setHasUnsavedChanges(true)

    if (!projectId) {
      addMessage('assistant', '✅ 已从图片创建元素（当前未保存项目，记得点保存）')
      return
    }

    try {
      await updateAgentProject(projectId, { elements: nextElements })
      setHasUnsavedChanges(false)
      addMessage('assistant', `✅ 已从图片创建元素：${newId}`)
    } catch (e) {
      console.error('[AgentPage] add element from image failed:', e)
      addMessage('assistant', `❌ 从图片添加元素保存失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  const openImportElementsModal = () => {
    setImportElementsOpen(true)
    setImportSourceProjectId(null)
    setImportSourceProject(null)
    setImportSelectedElementIds(new Set())
    setImportElementQuery('')
    setImportElementTypeFilter('all')
    setImportElementShowOnlyMissing(false)
    setImportElementShowOnlyConflicts(false)
  }

  const closeImportElementsModal = () => {
    setImportElementsOpen(false)
    setImportSourceProjectId(null)
    setImportSourceProject(null)
    setImportSelectedElementIds(new Set())
    setImportElementQuery('')
    setImportElementTypeFilter('all')
    setImportElementShowOnlyMissing(false)
    setImportElementShowOnlyConflicts(false)
  }

  useEffect(() => {
    if (!importElementsOpen) return
    if (!importSourceProjectId) return
    let cancelled = false
    ;(async () => {
      try {
        const p = await getAgentProject(importSourceProjectId)
        if (cancelled) return
        setImportSourceProject(p)
        const ids = Object.keys(p.elements || {})
        setImportSelectedElementIds(new Set(ids))
      } catch (e) {
        console.error('[AgentPage] load import source project failed:', e)
        if (!cancelled) setImportSourceProject(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [importElementsOpen, importSourceProjectId])

  const handleDeleteSelectedElements = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载当前 Agent 项目，再删除元素')
      return
    }
    const selected = Array.from(importSelectedElementIds).filter((id) => elements[id])
    if (selected.length === 0) return
    const ok = window.confirm(`将从当前项目删除选中的 ${selected.length} 个元素（不会影响来源项目）。\n\n确认继续？`)
    if (!ok) return

    setImportingElements(true)
    try {
      const nextElements: Record<string, AgentElement> = { ...elements }
      for (const id of selected) delete nextElements[id]
      setElements(nextElements)
      setHasUnsavedChanges(true)
      await updateAgentProject(projectId, { elements: nextElements })
      setHasUnsavedChanges(false)
      addMessage('assistant', `✅ 已删除元素：${selected.length} 个`)
      closeImportElementsModal()
    } catch (e) {
      console.error('[AgentPage] delete selected elements failed:', e)
      addMessage('assistant', `❌ 删除失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setImportingElements(false)
    }
  }

  const openImportShotRefsModal = (shotId: string) => {
    setImportShotRefsOpen(true)
    setImportShotRefsTargetShotId(shotId)
    setImportShotRefsSourceProjectId(null)
    setImportShotRefsSourceProject(null)
    setImportShotRefsSelectedUrls(new Set())
  }

  const closeImportShotRefsModal = () => {
    setImportShotRefsOpen(false)
    setImportShotRefsTargetShotId(null)
    setImportShotRefsSourceProjectId(null)
    setImportShotRefsSourceProject(null)
    setImportShotRefsSelectedUrls(new Set())
  }

  useEffect(() => {
    if (!importShotRefsOpen) return
    if (!importShotRefsSourceProjectId) return
    let cancelled = false
    ;(async () => {
      try {
        const p = await getAgentProject(importShotRefsSourceProjectId)
        if (cancelled) return
        setImportShotRefsSourceProject(p)
      } catch (e) {
        console.error('[AgentPage] load shot refs source project failed:', e)
        if (!cancelled) setImportShotRefsSourceProject(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [importShotRefsOpen, importShotRefsSourceProjectId])

  const handleImportShotRefs = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载当前 Agent 项目，再导入参考图')
      return
    }
    if (!importShotRefsTargetShotId) return
    const urls = Array.from(importShotRefsSelectedUrls)
      .map((u) => canonicalizeMediaUrl((u || '').trim()))
      .map((u) => (resolveMediaUrl(u) ? u : ''))
      .filter(Boolean)
    if (urls.length === 0) return

    setImportingShotRefs(true)
    try {
      const nextSegments: AgentSegment[] = segments.map((seg) => ({
        ...seg,
        shots: seg.shots.map((shot) => {
          if (shot.id !== importShotRefsTargetShotId) return shot
          const cur = Array.isArray(shot.reference_images) ? shot.reference_images : []
          const merged = Array.from(new Set([...cur, ...urls]))
          return { ...shot, reference_images: merged }
        })
      }))
      setSegments(nextSegments)
      setHasUnsavedChanges(true)
      await updateAgentProject(projectId, { segments: nextSegments })
      setHasUnsavedChanges(false)
      addMessage('assistant', `✅ 已导入镜头参考图：${urls.length} 张`)
      closeImportShotRefsModal()
    } catch (e) {
      console.error('[AgentPage] import shot refs failed:', e)
      addMessage('assistant', `❌ 导入参考图失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setImportingShotRefs(false)
    }
  }

  const handleImportSelectedElements = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载当前 Agent 项目，再导入上一集元素')
      return
    }
    if (!importSourceProject || !importSourceProjectId) return

    const sourceElements = importSourceProject.elements || {}
    const selected = Array.from(importSelectedElementIds).filter((id) => sourceElements[id])
    if (selected.length === 0) return

    setImportingElements(true)
    try {
      const nextElements: Record<string, AgentElement> = { ...elements }
      let imported = 0
      let merged = 0
      let skipped = 0

      for (const id of selected) {
        const incoming = sourceElements[id]
        if (!incoming) continue

        if (!nextElements[id]) {
          nextElements[id] = { ...incoming }
          imported += 1
          continue
        }

        // Conflict: keep current, but merge in reference images/history if missing
        const cur = nextElements[id]
        const curRefs = Array.isArray(cur.reference_images) ? cur.reference_images : []
        const incRefs = Array.isArray(incoming.reference_images) ? incoming.reference_images : []
        const mergedRefs = Array.from(new Set([...curRefs, ...incRefs].filter(Boolean)))

        const curHist = Array.isArray(cur.image_history) ? cur.image_history : []
        const incHist = Array.isArray(incoming.image_history) ? incoming.image_history : []
        const mergedHist = [...curHist]
        for (const h of incHist) {
          if (!h?.url) continue
          if (!mergedHist.some((x) => x.url === h.url)) mergedHist.push(h)
        }

        const patch: AgentElement = {
          ...cur,
          reference_images: mergedRefs.length ? mergedRefs : cur.reference_images,
          image_history: mergedHist.length ? mergedHist : cur.image_history,
          image_url: cur.image_url || incoming.image_url,
          cached_image_url: cur.cached_image_url || incoming.cached_image_url
        }
        nextElements[id] = patch
        merged += 1
      }

      // basic skip count (selected-but-not-present shouldn't happen, but keep for message)
      skipped = Math.max(0, selected.length - imported - merged)

      setElements(nextElements)
      setHasUnsavedChanges(true)
      await updateAgentProject(projectId, { elements: nextElements })
      setHasUnsavedChanges(false)
      addMessage('assistant', `✅ 导入完成：新增 ${imported}，合并 ${merged}，跳过 ${skipped}`)
      closeImportElementsModal()
    } catch (e) {
      console.error('[AgentPage] import elements failed:', e)
      addMessage('assistant', `❌ 导入失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally {
      setImportingElements(false)
    }
  }

  const handleDeleteElement = (elementId: string) => {
    setElements(prev => {
      const next = { ...prev }
      delete next[elementId]
      return next
    })
    setHasUnsavedChanges(true)
  }

  const handleUpdateElement = (elementId: string, updates: Partial<AgentElement>) => {
    setElements(prev => ({
      ...prev,
      [elementId]: { ...prev[elementId], ...updates }
    }))
    setHasUnsavedChanges(true)
  }

  const handlePersistElement = async (elementId: string, updates: Partial<AgentElement>) => {
    const nextElements = {
      ...elements,
      [elementId]: { ...elements[elementId], ...updates }
    }
    setElements(nextElements)
    setHasUnsavedChanges(true)

    if (!projectId) {
      addMessage('assistant', '✅ 已更新元素（当前未保存项目，记得点保存）')
      return
    }

    try {
      await updateAgentProject(projectId, { elements: nextElements })
      setHasUnsavedChanges(false)
      addMessage('assistant', `✅ 已更新元素 ${elementId}`)
    } catch (e) {
      console.error('[AgentPage] update element failed:', e)
      addMessage('assistant', `❌ 保存元素失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  const handleAddSegment = () => {
    const newId = `Segment_NEW_${Date.now()}`
    const newSegment: AgentSegment = {
      id: newId,
      name: '新段落',
      description: '请输入段落描述...',
      shots: [],
      created_at: new Date().toISOString()
    }
    setSegments(prev => [...prev, newSegment])
    setExpandedSegments(prev => new Set([...prev, newId]))
    setHasUnsavedChanges(true)
  }

  const formatAudioGenResult = (result: {
    generated: number
    skipped: number
    failed: number
    results?: Array<Record<string, unknown>>
  }) => {
    const rows = Array.isArray(result.results) ? result.results : []
    const failedRows = rows.filter(r => (r as { status?: string })?.status === 'failed')
    const failedPreview = failedRows
      .slice(0, 3)
      .map(r => {
        const shot = String((r as { shot_id?: unknown; shotId?: unknown })?.shot_id ?? (r as { shotId?: unknown })?.shotId ?? '')
        const msg = String((r as { message?: unknown })?.message ?? '未知原因')
        return `- ${shot || 'unknown'}: ${msg}`
      })
      .join('\n')

    return [
      `生成：${result.generated}  跳过：${result.skipped}  失败：${result.failed}`,
      failedPreview ? `\n失败原因（前 ${Math.min(3, failedRows.length)} 条）：\n${failedPreview}` : ''
    ].join('\n')
  }

  const handleRegenerateShotAudio = async (shotId: string) => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载 Agent 项目')
      return
    }

    const includeNarration = audioGenIncludeNarration
    const includeDialogue = audioGenIncludeDialogue
    if (!includeNarration && !includeDialogue) {
      addMessage('assistant', '⚠️ 请至少选择一个：旁白 或 对白')
      return
    }
    const parts = [includeNarration ? '旁白' : null, includeDialogue ? '对白' : null].filter(Boolean).join(' + ')

    const ok = window.confirm(`将仅为该镜头重新生成：${parts}（独立 TTS）。\n\n确认开始？`)
    if (!ok) return

    setRegeneratingAudioShotId(shotId)
    try {
      const result = await generateAgentAudio(projectId, { overwrite: true, includeNarration, includeDialogue, shotIds: [shotId] })
      await loadProject(projectId)
      addMessage('assistant', `✅ 镜头音频已重新生成：${shotId}\n${formatAudioGenResult(result)}`)
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (error as Error)?.message ||
        '未知错误'
      addMessage('assistant', `❌ 镜头音频重新生成失败：${message}`)
    } finally {
      setRegeneratingAudioShotId(null)
    }
  }

  const handleClearAllVoiceAudio = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载 Agent 项目')
      return
    }
    const ok = window.confirm('将清除本项目所有已生成的人声轨（旁白/对白）音频，并删除本地缓存文件。\n\n确认继续？')
    if (!ok) return

    setClearingAllVoiceAudio(true)
    try {
      const result = await clearAgentAudio(projectId, { deleteFiles: true })
      await loadProject(projectId)
      addMessage(
        'assistant',
        `✅ 已清除人声轨：清除镜头 ${result.cleared_shots}，移除资产 ${result.removed_assets}，删除文件 ${result.deleted_files}`
      )
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (error as Error)?.message ||
        '未知错误'
      addMessage('assistant', `❌ 清除人声轨失败：${message}`)
    } finally {
      setClearingAllVoiceAudio(false)
    }
  }

  const handleClearShotVoiceAudio = async (shotId: string) => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载 Agent 项目')
      return
    }
    const ok = window.confirm(`将清除该镜头已生成的人声轨（旁白/对白）音频，并删除本地缓存文件。\n\n镜头：${shotId}\n\n确认继续？`)
    if (!ok) return

    setClearingAudioShotId(shotId)
    try {
      const result = await clearAgentAudio(projectId, { shotIds: [shotId], deleteFiles: true })
      await loadProject(projectId)
      addMessage(
        'assistant',
        `✅ 已清除镜头人声轨：${shotId}\n清除镜头 ${result.cleared_shots}，移除资产 ${result.removed_assets}，删除文件 ${result.deleted_files}`
      )
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (error as Error)?.message ||
        '未知错误'
      addMessage('assistant', `❌ 清除镜头人声轨失败：${message}`)
    } finally {
      setClearingAudioShotId(null)
    }
  }

  const handleScriptDoctor = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载 Agent 项目后再进行「剧本增强」')
      return
    }
    setIsScriptDoctoring(true)
    try {
      const result = await scriptDoctorAgentProject(projectId, { mode: 'expand', apply: true })
      const project = result.project
      setProjectName(project.name || projectName)
      setCreativeBrief((project.creative_brief || {}) as CreativeBrief)
      setElements(project.elements || {})
      setSegments(project.segments || [])
      setActiveModule('storyboard')
      setExpandedCards(prev => new Set([...prev, 'brief', 'storyboard']))
      addMessage('assistant', '✨ 剧本增强完成：已补齐 hook/高潮/逻辑细节，并更新分镜文本（不触发重生成）。')
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (error as Error)?.message ||
        '未知错误'
      addMessage('assistant', `❌ 剧本增强失败：${message}`)
    } finally {
      setIsScriptDoctoring(false)
    }
  }

  const handleCompleteAssets = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载 Agent 项目后再进行「补全资产」')
      return
    }
    setIsCompletingAssets(true)
    try {
      const result = await completeAssetsAgentProject(projectId, { apply: true })
      const project = result.project
      setElements(project.elements || {})
      setSegments(project.segments || [])
      const addedCount = Array.isArray(result.added_elements) ? result.added_elements.length : 0
      addMessage('assistant', `🧩 资产补全完成：新增 ${addedCount} 个场景/道具元素，并可选补齐镜头提示词。`)
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (error as Error)?.message ||
        '未知错误'
      addMessage('assistant', `❌ 资产补全失败：${message}`)
    } finally {
      setIsCompletingAssets(false)
    }
  }

  const handleAudioCheck = async (apply: boolean) => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存/加载 Agent 项目后再进行「音频对齐检查」')
      return
    }
    setIsAudioChecking(true)
    try {
      const result = await audioCheckAgentProject(projectId, {
        includeNarration: audioGenIncludeNarration,
        includeDialogue: audioGenIncludeDialogue,
        speed: 1.0,
        apply
      })
      if (apply) {
        setSegments(result.project.segments || [])
      }
      const issues = Array.isArray(result.issues) ? result.issues : []
      addMessage(
        'assistant',
        apply
          ? `🎧 音频对齐检查：发现 ${issues.length} 处不匹配，已按建议自动调整镜头时长（只增不减）。`
          : `🎧 音频对齐检查：发现 ${issues.length} 处不匹配；可选择「按建议自动调整镜头时长」后再生成音频。`
      )
    } catch (error) {
      const message =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (error as Error)?.message ||
        '未知错误'
      addMessage('assistant', `❌ 音频对齐检查失败：${message}`)
    } finally {
      setIsAudioChecking(false)
    }
  }

  // 用户自助精调：点对点修改镜头提示词/旁白（不触发重生成）
  const handleUpdateShotText = async (
    shotId: string,
    updates: Partial<AgentShot>
  ) => {
    const { prompt, narration, video_prompt, dialogue_script, reference_images, duration } = updates
    const nextSegments = segments.map(seg => ({
      ...seg,
      shots: seg.shots.map(shot => {
        if (shot.id !== shotId) return shot
        return {
          ...shot,
          ...(prompt !== undefined ? { prompt } : {}),
          ...(video_prompt !== undefined ? { video_prompt } : {}),
          ...(dialogue_script !== undefined ? { dialogue_script } : {}),
          ...(narration !== undefined ? { narration } : {}),
          ...(reference_images !== undefined ? { reference_images } : {}),
          ...(duration !== undefined ? { duration } : {})
        }
      })
    }))

    setSegments(nextSegments)
    setHasUnsavedChanges(true)

    if (!projectId) {
      addMessage('assistant', '✅ 已更新该镜头的提示词/旁白（当前未保存项目，记得点保存）')
      return
    }

    try {
      await updateAgentProject(projectId, { segments: nextSegments })
      setHasUnsavedChanges(false)
      addMessage('assistant', `✅ 已更新镜头 ${shotId} 的提示词/旁白（未重生成）`)
    } catch (e) {
      console.error('[AgentPage] update shot text failed:', e)
      addMessage('assistant', `❌ 保存镜头文本失败：${e instanceof Error ? e.message : '未知错误'}`)
    }
  }

  // 重新生成单个镜头的起始帧（使用后端API，带角色参考图）
  const handleRetryFrame = async (shotId: string) => {
    if (!projectId) return
    
    setRetryingShot(shotId)
    try {
      // 找到镜头名称用于提示
      let shotName = shotId
      for (const seg of segments) {
        const shot = seg.shots.find(s => s.id === shotId)
        if (shot) {
          shotName = shot.name
          break
        }
      }
      
      // 调用后端API，会自动使用角色参考图
      const result = await regenerateShotFrame(
        projectId,
        shotId,
        creativeBrief.visualStyle || '吉卜力动画风格'
      )
      
      console.log('[handleRetryFrame] API返回结果:', result)
      
      if (result.success) {
        // 更新本地状态
        setSegments(prev => prev.map(seg => ({
          ...seg,
          shots: seg.shots.map(s => {
            if (s.id === shotId) {
              const updated = { 
                ...s, 
                start_image_url: result.start_image_url || result.source_url || result.image_url,
                cached_start_image_url: result.cached_start_image_url || (result.image_url?.startsWith('/api/') ? result.image_url : s.cached_start_image_url),
                start_image_history: result.start_image_history || [],
                status: 'frame_ready' as const
              }
              console.log('[handleRetryFrame] 更新后的shot:', updated)
              return updated
            }
            return s
          })
        })))
        
        const refCount = result.reference_images_count || 0
        addMessage('assistant', `✅ 镜头「${shotName}」起始帧已重新生成${refCount > 0 ? `（参考了 ${refCount} 张角色图片）` : ''}`)
      } else {
        addMessage('assistant', `❌ 重新生成失败：${result.error || '未知错误'}`)
      }
    } catch (error) {
      console.error('重新生成起始帧失败:', error)
      addMessage('assistant', `❌ 重新生成失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setRetryingShot(null)
    }
  }

  // 重新生成单个镜头的视频
  const handleRetryVideo = async (shotId: string) => {
    if (!projectId) return
    
    setRetryingShot(shotId)
    try {
      // 找到镜头
      let targetShot: AgentShot | null = null
      for (const seg of segments) {
        const shot = seg.shots.find(s => s.id === shotId)
        if (shot) {
          targetShot = shot
          break
        }
      }
      
      if (!targetShot) {
        addMessage('assistant', '❌ 找不到该镜头')
        return
      }
      
      if (!targetShot.start_image_url) {
        addMessage('assistant', '⚠️ 请先生成起始帧')
        return
      }
      
      // 构建视频提示词
      const videoPrompt = targetShot.video_prompt || targetShot.prompt || targetShot.description
      
      // 生成视频
      const result = await generateVideo(targetShot.start_image_url, videoPrompt, {
        duration: targetShot.duration || 5,
        resolution: '720p'
      })
      
      // 如果是异步任务，需要轮询
      if (result.status === 'processing' || result.status === 'pending' || result.status === 'submitted') {
        addMessage('assistant', `⏳ 视频生成中，任务ID: ${result.taskId}`)
        
        // 轮询等待完成
        let attempts = 0
        const maxAttempts = 60 // 最多等待5分钟
        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000))
          const status = await checkVideoTaskStatus(result.taskId)
          
          if (status.status === 'completed' || status.status === 'succeeded') {
            // 更新镜头
            setSegments(prev => prev.map(seg => ({
              ...seg,
              shots: seg.shots.map(s => s.id === shotId ? { ...s, video_url: status.videoUrl || '', status: 'video_ready' } : s)
            })))
            const videoUrl = status.videoUrl || ''
            if (videoUrl) {
              setVisualAssets(prev => prev.some(a => a.url === videoUrl) ? prev : [...prev, {
                id: `video_${shotId}_${Date.now()}`,
                name: targetShot.name,
                url: videoUrl,
                type: 'video',
                shotId,
                duration: `${targetShot.duration || 5}s`,
                status: 'completed'
              }])
            }
            await handleSaveProject(false)
            addMessage('assistant', `✅ 镜头「${targetShot.name}」视频已重新生成`)
            return
          } else if (status.status === 'failed' || status.status === 'error') {
            throw new Error(status.error || '视频生成失败')
          }
          
          attempts++
        }
        
        throw new Error('视频生成超时')
      } else if (result.status === 'completed' || result.status === 'succeeded') {
        // 直接完成
        setSegments(prev => prev.map(seg => ({
          ...seg,
          shots: seg.shots.map(s => s.id === shotId ? { ...s, video_url: result.videoUrl || '', status: 'video_ready' } : s)
        })))
        const videoUrl = result.videoUrl || ''
        if (videoUrl) {
          setVisualAssets(prev => prev.some(a => a.url === videoUrl) ? prev : [...prev, {
            id: `video_${shotId}_${Date.now()}`,
            name: targetShot.name,
            url: videoUrl,
            type: 'video',
            shotId,
            duration: `${targetShot.duration || 5}s`,
            status: 'completed'
          }])
        }
        await handleSaveProject(false)
        addMessage('assistant', `✅ 镜头「${targetShot.name}」视频已重新生成`)
      }
    } catch (error) {
      console.error('重新生成视频失败:', error)
      // 更新状态为失败
      setSegments(prev => prev.map(seg => ({
        ...seg,
        shots: seg.shots.map(s => s.id === shotId ? { ...s, status: 'video_failed' } : s)
      })))
      addMessage('assistant', `❌ 重新生成失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setRetryingShot(null)
    }
  }

  const pinExportToast = useCallback(() => {
    setExportDialog(prev => {
      if (!prev.open) return prev
      if (prev.mode === 'pinned' || prev.mode === 'completed') return prev
      return { ...prev, mode: 'pinned' }
    })
  }, [])

  const scheduleHideExportToast = useCallback((delayMs: number) => {
    if (exportToastHideTimerRef.current) clearTimeout(exportToastHideTimerRef.current)
    exportToastHideTimerRef.current = setTimeout(() => {
      setExportDialog(prev => ({ ...prev, open: false }))
    }, delayMs)
  }, [])

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (exportDialog.open) {
      setExportToastEntered(false)
      requestAnimationFrame(() => setExportToastEntered(true))
      return
    }
    setExportToastEntered(false)
  }, [exportDialog.open])

  useEffect(() => {
    return () => {
      if (exportToastAutoPinTimerRef.current) clearTimeout(exportToastAutoPinTimerRef.current)
      if (exportToastHideTimerRef.current) clearTimeout(exportToastHideTimerRef.current)
      exportAbortControllerRef.current?.abort()
    }
  }, [])

  // 导出项目素材（后端打包 ZIP，避免前端动态依赖加载问题）
  const handleExportAssets = async () => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存项目')
      return
    }

    // 若上一次导出还在进行，先中断
    exportAbortControllerRef.current?.abort()
    const controller = new AbortController()
    exportAbortControllerRef.current = controller

    setExporting(true)
    setShowExportMenu(false)
    if (exportToastAutoPinTimerRef.current) clearTimeout(exportToastAutoPinTimerRef.current)
    if (exportToastHideTimerRef.current) clearTimeout(exportToastHideTimerRef.current)
    setExportDialog({ open: true, mode: 'floating', phase: 'packing', loaded: 0 })
    exportToastAutoPinTimerRef.current = setTimeout(() => pinExportToast(), 5000)

    try {
      addMessage('assistant', '📦 正在导出项目素材...')
      const blob = await exportProjectAssets(projectId, {
        signal: controller.signal,
        onProgress: (progress) => {
          setExportDialog(prev => ({
            ...prev,
            open: true,
            phase: prev.phase === 'packing' ? 'downloading' : prev.phase,
            loaded: progress.loaded,
            total: progress.total,
            percent: progress.percent
          }))
        }
      })

      setExportDialog(prev => ({ ...prev, phase: 'saving' }))
      const safeName = sanitizeFilename(projectName, 'project')
      saveAs(blob, `${safeName}_${projectId}_assets.zip`)
      setExportDialog(prev => ({ ...prev, mode: 'completed', phase: 'done', percent: 100 }))
      addMessage('assistant', '✅ 文件已开始下载。')
      scheduleHideExportToast(2200)
    } catch (error) {
      console.error('导出素材失败:', error)
      const errorCode = (error as { code?: string } | null)?.code
      const isAbort = errorCode === 'ERR_CANCELED' || (error instanceof DOMException && error.name === 'AbortError')
      if (isAbort) {
        setExportDialog(prev => ({ ...prev, mode: 'completed', phase: 'canceled' }))
        addMessage('assistant', '⏹️ 已取消导出。')
        scheduleHideExportToast(2000)
      } else {
        setExportDialog(prev => ({
          ...prev,
          mode: 'completed',
          phase: 'error',
          error: error instanceof Error ? error.message : '未知错误'
        }))
        addMessage('assistant', `❌ 导出失败：${error instanceof Error ? error.message : '未知错误'}`)
        scheduleHideExportToast(2600)
      }
    } finally {
      setExporting(false)
      exportAbortControllerRef.current = null
    }
  }

  // 导出拼接视频（提示用户使用时间轴功能）
  const handleExportVideo = async (resolution: string = '720p') => {
    if (!projectId) {
      addMessage('assistant', '⚠️ 请先保存项目')
      return
    }
    
    const completedVideos = segments.flatMap(s => s.shots).filter(shot => shot.video_url)
    if (completedVideos.length === 0) {
      addMessage('assistant', '⚠️ 没有可导出的视频片段，请先生成视频')
      return
    }
    
    setShowExportMenu(false)
    
    setExporting(true)
    setExportDialog({
      open: true,
      mode: 'floating',
      phase: 'packing',
      loaded: 0,
      total: undefined,
      percent: undefined,
      error: undefined
    })

    try {
      const blob = await exportMergedVideo(projectId, resolution)
      setExportDialog(prev => ({ ...prev, phase: 'saving' }))

      const safeName = sanitizeFilename(projectName, 'project')
      saveAs(blob, `${safeName}_${projectId}_merged_${resolution}.mp4`)

      setExportDialog(prev => ({ ...prev, mode: 'completed', phase: 'done' }))
      addMessage('assistant', '✅ 合并视频已开始下载。')
      scheduleHideExportToast(2200)
    } catch (error) {
      console.error('导出合并视频失败:', error)
      setExportDialog(prev => ({
        ...prev,
        mode: 'completed',
        phase: 'error',
        error: error instanceof Error ? error.message : '未知错误'
      }))
      addMessage('assistant', `⚠️ 后端合并导出失败。

你可以改用：
1) 「导出全部素材」下载所有视频片段
2) 用剪映/PR/达芬奇拼接

是否现在下载全部素材？`, undefined, [
        { id: 'export_assets', label: '📦 下载全部素材', value: 'export_assets' }
      ])
      scheduleHideExportToast(2600)
    } finally {
      setExporting(false)
    }
  }

  const modules = [
    { id: 'elements' as ModuleType, icon: Sparkles, label: '关键元素' },
    { id: 'storyboard' as ModuleType, icon: Film, label: '分镜' },
    { id: 'timeline' as ModuleType, icon: Clock, label: '时间线' }
  ]

  const visualAssetGroups = (() => {
    const groups = new Map<string, { key: string; type: VisualAsset['type']; name: string; items: VisualAsset[] }>()
    const typeLabel: Record<VisualAsset['type'], string> = {
      element: '元素',
      start_frame: '起始帧',
      video: '视频'
    }
    for (const asset of visualAssets) {
      const groupId = asset.type === 'element'
        ? (asset.elementId || asset.id)
        : (asset.shotId || asset.id)
      const key = `${asset.type}:${groupId}`
      if (!groups.has(key)) {
        const name = asset.name || `${typeLabel[asset.type]} ${groupId}`
        groups.set(key, { key, type: asset.type, name, items: [] })
      }
      groups.get(key)!.items.push(asset)
    }
    return { groups: Array.from(groups.values()), typeLabel }
  })()

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  // 显示项目列表（当没有打开具体项目时）
  if (showProjectList && !projectId) {
    return (
      <div className="h-full overflow-auto p-8 animate-fadeIn">
        <div className="max-w-4xl mx-auto">
          {/* 头部 */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/home')}
                className="p-2 glass-button rounded-xl text-gray-400 hover:text-white"
              >
                <ChevronLeft size={20} />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-gradient">YuanYuan Agent</h1>
                <p className="text-sm text-gray-500">AI 驱动的一站式视频创作</p>
              </div>
            </div>
            <button
              onClick={() => setShowProjectList(false)}
              className="px-4 py-2 gradient-primary rounded-xl text-sm font-medium flex items-center gap-2"
            >
              <Plus size={16} />
              新建项目
            </button>
          </div>

          {/* 历史项目列表 */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock size={18} className="text-gray-400" />
              历史项目
              <span className="text-xs text-gray-500 glass px-2 py-0.5 rounded-full">{agentProjects.length}</span>
            </h2>
            
            {agentProjects.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <img
                  src="/yuanyuan/standing.png"
                  alt="YuanYuan"
                  className="w-32 h-auto mx-auto mb-4 drop-shadow-lg"
                />
                <h3 className="text-lg font-medium mb-2">还没有 Agent 项目</h3>
                <p className="text-sm text-gray-500 mb-6">点击「新建项目」开始你的第一个 AI 视频创作</p>
                <button
                  onClick={() => setShowProjectList(false)}
                  className="px-6 py-2.5 gradient-primary rounded-xl text-sm font-medium"
                >
                  开始创作
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {agentProjects.map((project) => (
                  <button
                    key={project.id}
                    onClick={() => {
                      navigate(`/agent/${project.id}`)
                    }}
                    className="glass-card p-5 text-left hover-lift group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center">
                          <Sparkles size={18} className="text-white" />
                        </div>
                        <div>
                          <h3 className="font-medium group-hover:text-primary transition-apple">{project.name}</h3>
                          <p className="text-xs text-gray-500">
                            {new Date(project.created_at).toLocaleDateString('zh-CN', { 
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                            })}
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={18} className="text-gray-500 group-hover:text-white group-hover:translate-x-1 transition-apple" />
                    </div>
                    
                    {/* 项目统计 */}
                    <div className="flex gap-4 text-xs text-gray-500">
                      {Object.keys(project.elements || {}).length > 0 && (
                        <span className="flex items-center gap-1">
                          <Sparkles size={12} />
                          {Object.keys(project.elements).length} 角色
                        </span>
                      )}
                      {(project.segments || []).length > 0 && (
                        <span className="flex items-center gap-1">
                          <Film size={12} />
                          {project.segments.reduce((acc, s) => acc + (s.shots?.length || 0), 0)} 镜头
                        </span>
                      )}
                      {(project.visual_assets || []).length > 0 && (
                        <span className="flex items-center gap-1">
                          <ImageIcon size={12} />
                          {project.visual_assets.length} 素材
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div 
      ref={containerRef} 
      className="flex h-screen w-screen animate-fadeIn bg-gradient-to-br from-[#0a0a12] via-[#0f0f1a] to-[#0a0a15]" 
      style={{ overflow: 'hidden', position: 'fixed', top: 0, left: 0 }}
    >
      {/* 退出确认对话框 */}
      {showExitDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop animate-fadeIn">
          <div className="glass-card p-6 rounded-2xl w-96 animate-scaleIn">
            <h3 className="text-lg font-semibold mb-2">保存项目？</h3>
            <p className="text-sm text-gray-400 mb-6">你有未保存的更改，是否在离开前保存？</p>
            <div className="flex gap-3">
              <button onClick={handleExitWithoutSave} className="flex-1 py-2.5 glass-button rounded-xl text-sm">不保存</button>
              <button onClick={() => setShowExitDialog(false)} className="flex-1 py-2.5 glass-button rounded-xl text-sm">取消</button>
              <button onClick={handleSaveAndExit} className="flex-1 py-2.5 gradient-primary rounded-xl text-sm font-medium">保存</button>
            </div>
          </div>
        </div>
      )}
      
      {/* 图片预览 Modal */}
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />

      {/* 导入元素 Modal（连续创作） */}
      {importElementsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={closeImportElementsModal}>
          <div className="w-[92vw] max-w-3xl max-h-[80vh] glass-card rounded-2xl border border-white/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">导入上一集/历史项目元素</p>
                <p className="text-xs text-gray-500 mt-1">把人物/场景/道具直接导入本集，减少续集缺失与重复配置</p>
              </div>
              <button className="p-2 glass rounded-lg hover:bg-white/10" onClick={closeImportElementsModal} title="关闭">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(80vh - 132px)' }}>
              <div className="space-y-2">
                <p className="text-xs text-gray-400">选择来源项目</p>
                <select
                  className="w-full glass-dark rounded-lg px-3 py-2 text-sm border border-white/10"
                  value={importSourceProjectId || ''}
                  onChange={(e) => setImportSourceProjectId(e.target.value || null)}
                >
                  <option value="" disabled>请选择一个历史项目…</option>
                  {agentProjects
                    .filter((p) => p.id !== projectId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                </select>
              </div>

              {importSourceProject && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-400">选择要导入的元素</p>
                    <div className="flex gap-2">
                      <button
                        className="text-xs glass-button px-2 py-1 rounded-lg"
                        onClick={() => {
                          const els = Object.values(importSourceProject.elements || {})
                          const query = importElementQuery.trim().toLowerCase()
                          const filtered = els.filter((el) => {
                            if (importElementTypeFilter !== 'all' && el.type !== importElementTypeFilter) return false
                            const hasConflict = Boolean(elements[el.id])
                            if (importElementShowOnlyMissing && hasConflict) return false
                            if (importElementShowOnlyConflicts && !hasConflict) return false
                            if (query) {
                              const hay = `${el.id} ${el.name} ${el.type}`.toLowerCase()
                              if (!hay.includes(query)) return false
                            }
                            return true
                          })
                          setImportSelectedElementIds(new Set(filtered.map((el) => el.id)))
                        }}
                      >
                        全选（筛选结果）
                      </button>
                      <button
                        className="text-xs glass-button px-2 py-1 rounded-lg"
                        onClick={() => {
                          setImportElementTypeFilter('character')
                          setImportElementShowOnlyMissing(false)
                          setImportElementShowOnlyConflicts(false)
                          const els = Object.values(importSourceProject.elements || {}).filter((el) => el.type === 'character')
                          setImportSelectedElementIds(new Set(els.map((el) => el.id)))
                        }}
                        title="只导入人物（character）"
                      >
                        只导入人物
                      </button>
                      <button
                        className="text-xs glass-button px-2 py-1 rounded-lg"
                        onClick={() => setImportSelectedElementIds(new Set())}
                      >
                        全不选
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input
                      value={importElementQuery}
                      onChange={(e) => setImportElementQuery(e.target.value)}
                      placeholder="搜索：元素名 / ID / type…"
                      className="sm:col-span-2 glass-dark rounded-lg px-3 py-2 text-sm border border-white/10"
                    />
                    <select
                      className="glass-dark rounded-lg px-3 py-2 text-sm border border-white/10"
                      value={importElementTypeFilter}
                      onChange={(e) => setImportElementTypeFilter(e.target.value as typeof importElementTypeFilter)}
                    >
                      <option value="all">全部类型</option>
                      <option value="character">人物 character</option>
                      <option value="scene">场景 scene</option>
                      <option value="object">道具 object</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={importElementShowOnlyMissing}
                        onChange={(e) => {
                          setImportElementShowOnlyMissing(e.target.checked)
                          if (e.target.checked) setImportElementShowOnlyConflicts(false)
                        }}
                      />
                      仅看未存在
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={importElementShowOnlyConflicts}
                        onChange={(e) => {
                          setImportElementShowOnlyConflicts(e.target.checked)
                          if (e.target.checked) setImportElementShowOnlyMissing(false)
                        }}
                      />
                      仅看冲突（同 ID）
                    </label>
                  </div>

                  <div className="glass-dark rounded-xl border border-white/10 overflow-hidden">
                    <div className="max-h-[42vh] overflow-y-auto divide-y divide-white/5">
                      {Object.values(importSourceProject.elements || {})
                        .filter((el) => {
                          if (importElementTypeFilter !== 'all' && el.type !== importElementTypeFilter) return false
                          const hasConflict = Boolean(elements[el.id])
                          if (importElementShowOnlyMissing && hasConflict) return false
                          if (importElementShowOnlyConflicts && !hasConflict) return false
                          const query = importElementQuery.trim().toLowerCase()
                          if (query) {
                            const hay = `${el.id} ${el.name} ${el.type}`.toLowerCase()
                            if (!hay.includes(query)) return false
                          }
                          return true
                        })
                        .map((el) => {
                        const checked = importSelectedElementIds.has(el.id)
                        const hasConflict = Boolean(elements[el.id])
                        return (
                          <label key={el.id} className="flex items-center gap-3 px-3 py-2 hover:bg-white/5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setImportSelectedElementIds((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(el.id)) next.delete(el.id)
                                  else next.add(el.id)
                                  return next
                                })
                              }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm truncate">{el.name}</span>
                                <span className="text-[10px] text-gray-500 glass px-1.5 py-0.5 rounded">{el.type}</span>
                                {hasConflict && (
                                  <span className="text-[10px] text-yellow-300 glass px-1.5 py-0.5 rounded" title="当前项目已有同 ID 元素，将执行合并（不覆盖已有内容）">
                                    冲突→合并
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-gray-500 truncate mt-0.5">{el.id}</p>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <p className="text-[10px] text-gray-500">
                    合并策略：同 ID 元素默认不覆盖，仅补充缺失的参考图/历史/当前图（用于保证连续创作最稳妥）。
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2">
              <button
                className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                onClick={handleDeleteSelectedElements}
                disabled={importingElements || Array.from(importSelectedElementIds).filter((id) => elements[id]).length === 0}
                title="从当前项目删除选中的元素（不影响来源项目）"
              >
                <Trash2 size={14} />
                删除选中（当前项目）
              </button>
              <button className="px-3 py-2 glass-button rounded-xl text-sm" onClick={closeImportElementsModal} disabled={importingElements}>
                取消
              </button>
              <button
                className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                onClick={handleImportSelectedElements}
                disabled={!importSourceProjectId || !importSourceProject || importSelectedElementIds.size === 0 || importingElements}
              >
                {importingElements ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                导入选中（{importSelectedElementIds.size}）
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入镜头参考图 Modal（连续创作） */}
      {importShotRefsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={closeImportShotRefsModal}>
          <div className="w-[92vw] max-w-4xl max-h-[80vh] glass-card rounded-2xl border border-white/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">导入镜头参考图</p>
                <p className="text-xs text-gray-500 mt-1">把上一集的镜头参考图/起始帧导入到当前镜头（用于续集场景连续）</p>
              </div>
              <button className="p-2 glass rounded-lg hover:bg-white/10" onClick={closeImportShotRefsModal} title="关闭">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto" style={{ maxHeight: 'calc(80vh - 132px)' }}>
              <div className="space-y-2">
                <p className="text-xs text-gray-400">选择来源项目</p>
                <select
                  className="w-full glass-dark rounded-lg px-3 py-2 text-sm border border-white/10"
                  value={importShotRefsSourceProjectId || ''}
                  onChange={(e) => setImportShotRefsSourceProjectId(e.target.value || null)}
                >
                  <option value="" disabled>请选择一个历史项目…</option>
                  {agentProjects
                    .filter((p) => p.id !== projectId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                </select>
              </div>

              {importShotRefsSourceProject && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-400">选择要导入的图片（点击选中/取消）</p>
                  <div className="glass-dark rounded-xl border border-white/10 overflow-hidden">
                    <div className="max-h-[48vh] overflow-y-auto divide-y divide-white/5">
                      {(importShotRefsSourceProject.segments || []).flatMap((seg) => seg.shots || []).map((shot) => {
                        const raw = [
                          ...(Array.isArray(shot.reference_images) ? shot.reference_images : []),
                          shot.cached_start_image_url,
                          shot.start_image_url,
                          ...(Array.isArray(shot.start_image_history) ? shot.start_image_history.map((h) => h.url) : [])
                        ].filter(Boolean) as string[]
                        const urls = Array.from(new Set(raw))
                        if (urls.length === 0) return null
                        return (
                          <div key={shot.id} className="p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm truncate">{shot.name}</p>
                                <p className="text-[10px] text-gray-500 truncate">{shot.id}</p>
                              </div>
                              <button
                                className="text-xs glass-button px-2 py-1 rounded-lg"
                                onClick={() => {
                                  setImportShotRefsSelectedUrls((prev) => {
                                    const next = new Set(prev)
                                    for (const u of urls) next.add(u)
                                    return next
                                  })
                                }}
                              >
                                全选本镜头
                              </button>
                            </div>
                            <div className="flex gap-2 overflow-x-auto pb-1">
                              {urls.map((u) => {
                                const selected = importShotRefsSelectedUrls.has(u)
                                return (
                                  <button
                                    key={u}
                                    type="button"
                                    onClick={() => {
                                      setImportShotRefsSelectedUrls((prev) => {
                                        const next = new Set(prev)
                                        if (next.has(u)) next.delete(u)
                                        else next.add(u)
                                        return next
                                      })
                                    }}
                                    className={`relative flex-shrink-0 w-20 h-14 rounded-lg overflow-hidden border ${selected ? 'border-primary ring-2 ring-primary/50' : 'border-white/10 hover:border-white/30'} transition-apple`}
                                    title={selected ? '已选中' : '点击选中'}
                                  >
                                    {(() => {
                                      const resolved = resolveMediaUrl(u)
                                      return resolved ? (
                                        <img src={resolved} alt="ref" className="w-full h-full object-cover" />
                                      ) : (
                                        <div className="w-full h-full bg-black/30 flex items-center justify-center text-[10px] text-gray-400">
                                          过期
                                        </div>
                                      )
                                    })()}
                                    {selected && (
                                      <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary/80 flex items-center justify-center">
                                        <CheckCircle size={12} className="text-white" />
                                      </div>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-500">提示：建议优先选用 `/api/uploads/...` 的图片作为参考图，稳定不易过期。</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 flex items-center justify-end gap-2">
              <button className="px-3 py-2 glass-button rounded-xl text-sm" onClick={closeImportShotRefsModal} disabled={importingShotRefs}>
                取消
              </button>
              <button
                className="px-3 py-2 glass-button rounded-xl text-sm flex items-center gap-2 disabled:opacity-50"
                onClick={handleImportShotRefs}
                disabled={!importShotRefsSourceProjectId || !importShotRefsSourceProject || importShotRefsSelectedUrls.size === 0 || importingShotRefs}
              >
                {importingShotRefs ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                导入到当前镜头（{importShotRefsSelectedUrls.size}）
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导出灵动岛 Toast */}
      {exportDialog.open && (
        (() => {
          const isCompactProgress = exportDialog.mode === 'pinned' && exportDialog.phase !== 'done' && exportDialog.phase !== 'error' && exportDialog.phase !== 'canceled'
          const toastWidth = isCompactProgress ? 220 : 292
          const viewportCenterX = viewportWidth / 2
          const mainRect = mainPanelRef.current?.getBoundingClientRect()
          const rightEdge = mainRect?.right ?? viewportWidth
          const topEdge = mainRect?.top ?? 0
          const targetCenterX = rightEdge - 18 - toastWidth / 2
          const dx = (exportDialog.mode === 'floating') ? 0 : (targetCenterX - viewportCenterX)
          const dy = exportToastEntered ? 0 : -16
          const opacity = exportToastEntered ? 1 : 0
          const topPx = exportDialog.mode === 'floating' ? 12 : Math.max(8, topEdge + 10)

          const showCheck = exportDialog.phase === 'done'
          const showError = exportDialog.phase === 'error'
          const showCanceled = exportDialog.phase === 'canceled'

          const statusText =
            exportDialog.phase === 'packing' ? '正在打包...' :
            exportDialog.phase === 'downloading' ? '正在下载...' :
            exportDialog.phase === 'saving' ? '准备下载...' :
            exportDialog.phase === 'done' ? '下载完成' :
            exportDialog.phase === 'canceled' ? '已取消' :
            '导出失败'

          const percentText = exportDialog.percent != null ? `${Math.max(0, Math.min(100, exportDialog.percent))}%` : ''
          const detailText = exportDialog.total
            ? `${formatBytes(exportDialog.loaded)} / ${formatBytes(exportDialog.total)}`
            : (exportDialog.loaded > 0 ? formatBytes(exportDialog.loaded) : '')

          return (
            <div
              className="fixed left-1/2 z-[999] pointer-events-auto select-none"
              style={{
                top: topPx,
                transform: `translate(-50%, 0) translateX(${dx}px) translateY(${dy}px)`,
                opacity,
                transition: 'transform 600ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity 300ms ease'
              }}
              onClick={() => pinExportToast()}
            >
              <div
                className={`glass-card border border-white/10 shadow-xl ${isCompactProgress ? 'rounded-full px-2 py-2' : 'rounded-full px-3 py-2.5'} transition-all duration-500 ease-out`}
                style={{ width: toastWidth }}
                title="点击收起到右上角进度条"
              >
                {isCompactProgress ? (
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${exportDialog.percent != null ? 'bg-gradient-to-r from-primary to-fuchsia-500' : 'bg-gradient-to-r from-primary/50 to-fuchsia-500/50 animate-pulse'}`}
                      style={{ width: exportDialog.percent != null ? `${Math.max(2, Math.min(100, exportDialog.percent))}%` : '45%' }}
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                      {showCheck ? (
                        <CheckCircle size={18} className="text-green-400 animate-scaleIn" />
                      ) : showError ? (
                        <AlertCircle size={18} className="text-red-400" />
                      ) : showCanceled ? (
                        <AlertCircle size={18} className="text-yellow-400" />
                      ) : (
                        <Loader2 size={18} className="animate-spin text-primary" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-200 truncate">导出素材</div>
                      <div className="text-[11px] text-gray-400 truncate">
                        {statusText}
                        {(percentText || detailText) ? ` ${percentText}${percentText && detailText ? ' · ' : ''}${detailText}` : ''}
                      </div>
                      <div className="mt-1.5 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${exportDialog.percent != null ? 'bg-gradient-to-r from-primary to-fuchsia-500' : 'bg-gradient-to-r from-primary/50 to-fuchsia-500/50 animate-pulse'}`}
                          style={{ width: exportDialog.percent != null ? `${Math.max(2, Math.min(100, exportDialog.percent))}%` : '45%' }}
                        />
                      </div>
                    </div>

                    <div className="text-[11px] text-gray-400 tabular-nums">
                      {exportDialog.phase === 'done' ? '✓' : (percentText || '')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()
      )}
      
      {/* 左侧模块导航 */}
      <aside className="w-16 glass-dark flex flex-col items-center py-4 border-r border-white/5">
        <button onClick={handleBack} className="p-3 rounded-xl mb-3 text-gray-400 hover:text-white glass-button transition-apple" title="返回">
          <ChevronLeft size={20} />
        </button>
        <div className="w-8 h-px bg-white/10 mb-3" />
        
        {modules.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveModule(id)}
            className={`p-3 rounded-xl mb-2 transition-all relative group ${activeModule === id ? 'glass-button text-white glow-soft' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
            title={label}
          >
            <Icon size={20} />
            <span className="absolute left-full ml-3 px-3 py-1.5 glass rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-apple pointer-events-none z-10">{label}</span>
          </button>
        ))}
        
        <div className="flex-1" />
        
        <button onClick={() => handleSaveProject(true)} className={`p-3 rounded-xl mb-2 transition-apple ${hasUnsavedChanges ? 'text-primary glass-button' : 'text-gray-500 hover:text-white hover:bg-white/5'}`} title="保存项目">
          <Save size={20} />
        </button>
        
        <div className="relative" ref={exportMenuRef}>
          <button 
            onClick={() => {
              console.log('[Export] 点击导出按钮', { projectId, exporting, showExportMenu })
              setShowExportMenu(!showExportMenu)
            }} 
            disabled={exporting || !projectId}
            className={`p-3 rounded-xl transition-apple ${!projectId ? 'text-gray-600 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-white/5'} disabled:opacity-30`}
            title={!projectId ? '请先保存项目' : '导出'}
          >
            {exporting ? <Loader2 size={20} className="animate-spin" /> : <Download size={20} />}
          </button>
          
          {showExportMenu && projectId && (
            <div className="absolute left-full ml-3 bottom-0 w-48 glass-card rounded-xl p-2 shadow-xl z-50 animate-scaleIn">
              <button
                onClick={() => {
                  console.log('[Export] 点击导出素材')
                  handleExportAssets()
                }}
                className="w-full px-3 py-2 text-left text-sm rounded-lg hover:bg-white/10 transition-colors flex items-center gap-2"
              >
                <Package size={16} />
                导出全部素材
              </button>
              <button
                onClick={() => {
                  console.log('[Export] 查看视频导出说明')
                  handleExportVideo()
                }}
                className="w-full px-3 py-2 text-left text-sm rounded-lg hover:bg-white/10 transition-colors flex items-center gap-2"
              >
                <Film size={16} />
                视频拼接说明
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* 中间主内容区 - 自适应剩余空间 */}
      <main ref={mainPanelRef} className="flex-1 flex flex-col min-w-[300px] border-r border-white/5" style={{ overflow: 'hidden' }}>
        <header className="h-14 px-5 flex items-center justify-between border-b border-white/5 glass-dark flex-shrink-0">
          <div className="flex items-center">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500 via-purple-500 to-indigo-500 flex items-center justify-center mr-3 shadow-lg shadow-purple-500/30">
              <Layers size={16} className="text-white" strokeWidth={2.5} />
            </div>
            <input
              type="text"
              value={projectName}
              onChange={(e) => { setProjectName(e.target.value); setHasUnsavedChanges(true) }}
              className="bg-transparent text-sm font-medium focus:outline-none border-b-2 border-transparent focus:border-primary/50 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2">
            {hasUnsavedChanges && <span className="text-xs text-yellow-400 glass-button px-2 py-1 rounded-full">未保存</span>}
            {generationStage !== 'idle' && generationStage !== 'complete' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-primary glass-button px-2 py-1 rounded-full flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  {generationStage === 'planning' ? '规划中' :
                   generationStage === 'elements' ? '生成角色' :
                   generationStage === 'frames' ? '生成起始帧' :
                   generationStage === 'videos' ? '生成视频' :
                   generationStage === 'audio' ? '生成音频' : '处理中'}
                </span>
                {generationProgress && (
                  <div className="flex items-center gap-2 glass-button px-2 py-1 rounded-full">
                    <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                        style={{ width: `${generationProgress.percent}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-300 min-w-[3rem]">{generationProgress.percent}%</span>
                    {generationProgress.currentItem && (
                      <span className="text-xs text-gray-400 truncate max-w-[100px]">{generationProgress.currentItem}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        <div 
          className="flex-1 min-h-0 overflow-y-auto p-5" 
          style={{ 
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {activeModule === 'elements' && (
            <ElementsPanel 
              elements={elements}
              expandedElements={expandedElements}
              toggleElement={toggleElement}
              editingElement={editingElement}
              setEditingElement={setEditingElement}
              generatingElement={generatingElement}
              onGenerateImage={handleGenerateElementImage}
              onFavoriteImage={handleFavoriteElementImage}
              onPreviewImage={(url, title) => setPreviewImage({ url, title })}
              onAddElement={handleAddElement}
              onAddElementFromImage={handleAddElementFromImage}
              onOpenImportElements={openImportElementsModal}
              onDeleteElement={handleDeleteElement}
              onUpdateElement={handleUpdateElement}
              onPersistElement={handlePersistElement}
              onGenerateAll={handleGenerateAllElements}
              isGenerating={generationStage === 'elements'}
            />
          )}
          
          {activeModule === 'storyboard' && (
            <StoryboardPanel
              segments={segments}
              expandedSegments={expandedSegments}
              toggleSegment={toggleSegment}
              elements={elements}
              onAddSegment={handleAddSegment}
              onGenerateFrames={handleGenerateAllFrames}
              onGenerateVideos={handleGenerateAllVideos}
              isGeneratingFrames={generationStage === 'frames'}
              isGeneratingVideos={generationStage === 'videos'}
              onRetryFrame={handleRetryFrame}
              onRetryVideo={handleRetryVideo}
              onFavoriteShotImage={handleFavoriteShotImage}
              onPreviewImage={(url, title) => setPreviewImage({ url, title })}
              retryingShot={retryingShot}
              onUpdateShotText={handleUpdateShotText}
              onScriptDoctor={handleScriptDoctor}
              onCompleteAssets={handleCompleteAssets}
              isScriptDoctoring={isScriptDoctoring}
              isCompletingAssets={isCompletingAssets}
              visualStyle={creativeBrief.visualStyle || '吉卜力动画风格'}
              focusShotRequest={focusShotRequest}
              onRegenerateShotAudio={handleRegenerateShotAudio}
              regeneratingAudioShotId={regeneratingAudioShotId}
              onClearShotAudio={handleClearShotVoiceAudio}
              clearingAudioShotId={clearingAudioShotId}
              onOpenImportShotRefs={openImportShotRefsModal}
            />
          )}
          
          {activeModule === 'timeline' && (
            <TimelinePanel
              segments={segments}
              onJumpToShot={(shotId, section) => {
                const seg = segments.find(s => s.shots.some(sh => sh.id === shotId))
                if (seg) {
                  setExpandedSegments(prev => {
                    const next = new Set(prev)
                    next.add(seg.id)
                    return next
                  })
                }
                setActiveModule('storyboard')
                setFocusShotRequest({ shotId, section, nonce: Date.now() })
              }}
            />
          )}
        </div>
      </main>

      {/* 可拖拽分隔条 - 右侧面板 */}
      <div
        className="w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary transition-colors flex-shrink-0 bg-white/5"
        onMouseDown={() => setIsResizingRight(true)}
        title="拖拽调整面板宽度"
      />

      {/* 右侧 AI 助手面板 - YuanYuan 风格 */}
      <aside 
        className="glass-dark border-l border-white/5 flex flex-col flex-shrink-0"
        style={{ width: `${rightPanelWidth}px`, overflow: 'hidden' }}
      >
        {/* 头部 */}
        <div className="h-14 px-5 flex items-center border-b border-white/5">
          <img
            src="/yuanyuan/avatar.png"
            alt="YuanYuan"
            className="w-9 h-9 rounded-xl mr-3 shadow-lg shadow-pink-500/30 object-cover"
          />
          <span className="text-sm font-medium">YuanYuan AI</span>
          <span className="ml-2 text-xs text-gray-500">视频制作助手</span>
        </div>

        {/* 可折叠任务卡片区域 - 独立滚动 */}
        <div
          className="flex-1 min-h-0 overflow-y-auto"
          style={{
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {/* 任务卡片 - 放在对话上方 */}
          <div className="px-4 pt-4 space-y-2">
            {/* Creative Brief 卡片 */}
            {Object.keys(creativeBrief).length > 0 && (
              <TaskCard
                title="Creative Brief"
                icon={<FileText size={14} />}
                expanded={expandedCards.has('brief')}
                onToggle={() => toggleCard('brief')}
                badge={creativeBrief.title}
              >
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Video Type</span>
                    <span>{creativeBrief.videoType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Narrative Driver</span>
                    <span>{creativeBrief.narrativeDriver}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">视觉风格</span>
                    <span>{creativeBrief.visualStyle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Duration</span>
                    <span>{creativeBrief.duration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Aspect Ratio</span>
                    <span>{creativeBrief.aspectRatio}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">旁白音色</span>
                    <span className="text-right max-w-[70%] truncate" title={creativeBrief.narratorVoiceProfile || ''}>
                      {creativeBrief.narratorVoiceProfile || '（未设置）'}
                    </span>
                  </div>

                  {(creativeBrief.hook || creativeBrief.climax || creativeBrief.logline) && (
                    <>
                      <div className="h-px bg-white/5 my-2" />
                      {creativeBrief.logline && (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-500">Logline</span>
                          <span className="text-right max-w-[70%] truncate" title={creativeBrief.logline}>
                            {creativeBrief.logline}
                          </span>
                        </div>
                      )}
                      {creativeBrief.hook && (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-500">Hook</span>
                          <span className="text-right max-w-[70%] truncate" title={creativeBrief.hook}>
                            {creativeBrief.hook}
                          </span>
                        </div>
                      )}
                      {creativeBrief.climax && (
                        <div className="flex justify-between gap-2">
                          <span className="text-gray-500">Climax</span>
                          <span className="text-right max-w-[70%] truncate" title={creativeBrief.climax}>
                            {creativeBrief.climax}
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="h-px bg-white/5 my-2" />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500">Series ID</span>
                      <input
                        value={creativeBrief.seriesId || creativeBrief.series_id || ''}
                        onChange={(e) => { setCreativeBrief(prev => ({ ...prev, seriesId: e.target.value })); setHasUnsavedChanges(true) }}
                        className="glass-dark rounded-lg px-2 py-1 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-primary/50 w-40"
                        placeholder="可选"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500">Episode</span>
                      <input
                        value={creativeBrief.episodeId || creativeBrief.episode_id || ''}
                        onChange={(e) => { setCreativeBrief(prev => ({ ...prev, episodeId: e.target.value })); setHasUnsavedChanges(true) }}
                        className="glass-dark rounded-lg px-2 py-1 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-primary/50 w-40"
                        placeholder="S01E01"
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-gray-500">Series Bible</span>
                        <span className="text-[10px] text-gray-500">连续创作建议</span>
                      </div>
                      <textarea
                        value={creativeBrief.seriesBible || creativeBrief.series_bible || ''}
                        onChange={(e) => { setCreativeBrief(prev => ({ ...prev, seriesBible: e.target.value })); setHasUnsavedChanges(true) }}
                        rows={4}
                        className="w-full glass-dark rounded-lg p-2 text-xs text-gray-200 border border-white/10 focus:outline-none focus:border-primary/50"
                        placeholder="世界观/人物设定/口癖禁忌/时间线/可复用镜头语言..."
                      />
                    </div>
                  </div>
                </div>
              </TaskCard>
            )}

            {/* 故事板卡片 */}
            {segments.length > 0 && (
              <TaskCard
                title="故事板"
                icon={<Film size={14} />}
                expanded={expandedCards.has('storyboard')}
                onToggle={() => toggleCard('storyboard')}
                badge={`${segments.length} 段落`}
              >
                <div className="space-y-2">
                  {segments.map((seg) => (
                    <button 
                      key={seg.id} 
                      onClick={() => {
                        setActiveModule('storyboard')
                        setExpandedSegments(prev => new Set([...prev, seg.id]))
                      }}
                      className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{seg.name}</span>
                        <span className="text-[10px] text-gray-500">{seg.shots.length} 镜头</span>
                      </div>
                      <p className="text-[10px] text-gray-400 line-clamp-2">{seg.description}</p>
                    </button>
                  ))}
                </div>
              </TaskCard>
            )}

            {/* Visual Assets 卡片 */}
            {visualAssets.length > 0 && (
              <TaskCard
                title="Visual Assets"
                icon={<ImageIcon size={14} />}
                expanded={expandedCards.has('visual')}
                onToggle={() => toggleCard('visual')}
                badge={<span className="text-green-400">{visualAssets.length}</span>}
              >
                <div className="space-y-3">
                  {visualAssetGroups.groups.map((group) => (
                    <div key={group.key} className="glass rounded-lg p-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] uppercase tracking-wide text-gray-400 px-1.5 py-0.5 glass rounded">
                            {visualAssetGroups.typeLabel[group.type]}
                          </span>
                          <span className="text-xs text-gray-300 truncate">{group.name}</span>
                        </div>
                        <span className="text-[10px] text-gray-500">{group.items.length}</span>
                      </div>
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {[...group.items].reverse().map((asset, index) => (
                          <button
                            key={asset.id}
                            onClick={() => {
                              if (asset.type === 'video') {
                                window.open(asset.url, '_blank')
                              } else {
                                setPreviewImage({ url: asset.url, title: asset.name })
                              }
                            }}
                            className="relative group/thumb flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden border border-white/10 hover:border-white/30 transition-apple"
                            title={asset.name}
                          >
                            {asset.type === 'video' ? (
                              <video
                                src={asset.url}
                                className="w-full h-full object-cover"
                                muted
                                playsInline
                                preload="metadata"
                              />
                            ) : (
                              <img
                                src={asset.url}
                                alt={asset.name}
                                className="w-full h-full object-cover"
                              />
                            )}
                            {index === 0 && (
                              <span className="absolute top-0.5 left-0.5 text-[8px] px-1 rounded bg-black/60 text-white">
                                最新
                              </span>
                            )}
                            {asset.duration && (
                              <span className="absolute bottom-0.5 right-0.5 text-[8px] glass-dark px-1 rounded">
                                {asset.duration}
                              </span>
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-apple flex items-center justify-center">
                              <Eye size={12} />
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </TaskCard>
            )}

            {/* Visual Gen Path 卡片 */}
            {Object.keys(creativeBrief).length > 0 && (
              <TaskCard
                title="Visual Gen Path"
                icon={<Settings2 size={14} />}
                expanded={expandedCards.has('genPath')}
                onToggle={() => toggleCard('genPath')}
              >
                <div className="space-y-3 text-xs">
                  <button
                    onClick={handleGenerateAllElements}
                    disabled={generationStage !== 'idle' || Object.keys(elements).length === 0}
                    className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px]">1</span>
                      <span className="font-medium">角色设计图</span>
                      {generationStage === 'elements' && <Loader2 size={12} className="animate-spin text-blue-400 ml-auto" />}
                      {Object.values(elements).filter(e => e.cached_image_url || e.image_url).length > 0 && generationStage !== 'elements' && (
                        <CheckCircle size={12} className="text-green-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 ml-7">Nano Banana Pro (2K) - 高清角色形象</p>
                    {generationStage === 'elements' && generationProgress && (
                      <div className="mt-2 ml-7">
                        <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                          <span>{generationProgress.currentItem || '准备中...'}</span>
                          <span>{generationProgress.current}/{generationProgress.total} ({generationProgress.percent}%)</span>
                        </div>
                        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${generationProgress.percent}%` }} />
                        </div>
                      </div>
                    )}
                  </button>
                  <button
                    onClick={() => handleGenerateAllFrames()}
                    disabled={generationStage !== 'idle' || segments.length === 0}
                    className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-purple-500/20 text-purple-400 flex items-center justify-center text-[10px]">2</span>
                      <span className="font-medium">镜头起始帧</span>
                      {generationStage === 'frames' && <Loader2 size={12} className="animate-spin text-purple-400 ml-auto" />}
                      {segments.flatMap(s => s.shots).filter(s => s.cached_start_image_url || s.start_image_url).length > 0 && generationStage !== 'frames' && (
                        <CheckCircle size={12} className="text-green-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 ml-7">Nano Banana Pro (2K) - 静态场景画面</p>
                    {generationStage === 'frames' && generationProgress && (
                      <div className="mt-2 ml-7">
                        <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                          <span>{generationProgress.currentItem || '准备中...'} {generationProgress.stage && `(${generationProgress.stage})`}</span>
                          <span>{generationProgress.current}/{generationProgress.total} ({generationProgress.percent}%)</span>
                        </div>
                        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${generationProgress.percent}%` }} />
                        </div>
                      </div>
                    )}
                  </button>
                  <button
                    onClick={() => handleGenerateAllVideos()}
                    disabled={generationStage !== 'idle' || segments.flatMap(s => s.shots).filter(s => s.cached_start_image_url || s.start_image_url).length === 0}
                    className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-pink-500/20 text-pink-400 flex items-center justify-center text-[10px]">3</span>
                      <span className="font-medium">动态视频</span>
                      {generationStage === 'videos' && <Loader2 size={12} className="animate-spin text-pink-400 ml-auto" />}
                      {segments.flatMap(s => s.shots).filter(s => s.video_url).length > 0 && generationStage !== 'videos' && (
                        <CheckCircle size={12} className="text-green-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 ml-7">Seedance 1.5 Pro (720p) - 图生视频</p>
                    {generationStage === 'videos' && generationProgress && (
                      <div className="mt-2 ml-7">
                        <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                          <span>
                            {generationProgress.phase === 'submit' ? '提交任务' : '等待完成'}
                            {generationProgress.currentItem && `: ${generationProgress.currentItem}`}
                            {generationProgress.stage && ` (${generationProgress.stage})`}
                          </span>
                          <span>{generationProgress.percent}%</span>
                        </div>
                        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-pink-500 transition-all duration-300" style={{ width: `${generationProgress.percent}%` }} />
                        </div>
                      </div>
                    )}
                  </button>
                  <button
                    onClick={() => handleConfirmClick('generate_audio')}
                    disabled={generationStage !== 'idle' || !projectId || segments.length === 0}
                    className="w-full glass p-2 rounded-lg text-left hover:bg-white/5 transition-apple disabled:opacity-50"
                    title={!projectId ? '请先保存/加载项目后再生成音频' : '为所有镜头生成旁白/对白人声轨（导出时自动叠加）'}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center text-[10px]">4</span>
                      <span className="font-medium">旁白/对白音频</span>
                      {generationStage === 'audio' && <Loader2 size={12} className="animate-spin text-cyan-300 ml-auto" />}
                      {segments.flatMap(s => s.shots).some(s => Boolean((s as { voice_audio_url?: string }).voice_audio_url)) && generationStage !== 'audio' && (
                        <CheckCircle size={12} className="text-green-400 ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-400 ml-7">OpenSpeech TTS - 生成独立人声轨（旁白/对白）</p>
                  </button>
                  <div className="ml-7 -mt-1 flex items-center gap-2 text-[10px]">
                    <span className="text-gray-500">生成：</span>
                    <button
                      type="button"
                      onClick={() => setAudioGenIncludeNarration(v => !v)}
                      className={`px-2 py-1 rounded-full glass-button transition-apple ${audioGenIncludeNarration ? 'text-green-300' : 'text-gray-500'}`}
                      title="开关：旁白"
                    >
                      {audioGenIncludeNarration ? '旁白：开' : '旁白：关'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAudioGenIncludeDialogue(v => !v)}
                      className={`px-2 py-1 rounded-full glass-button transition-apple ${audioGenIncludeDialogue ? 'text-cyan-300' : 'text-gray-500'}`}
                      title="开关：对白"
                    >
                      {audioGenIncludeDialogue ? '对白：开' : '对白：关'}
                    </button>
                    {!audioGenIncludeNarration && audioGenIncludeDialogue && (
                      <span className="text-gray-500">(仅对白调试)</span>
                    )}
                    <button
                      type="button"
                      onClick={handleClearAllVoiceAudio}
                      disabled={!projectId || clearingAllVoiceAudio || generationStage === 'audio'}
                      className="px-2 py-1 rounded-full glass-button transition-apple text-red-300 disabled:opacity-50"
                      title="删除本项目所有已生成的人声轨（旁白/对白）音频"
                    >
                      {clearingAllVoiceAudio ? '清除中...' : '清除已生成'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAudioCheck(false)}
                      disabled={!projectId || isAudioChecking || generationStage === 'audio'}
                      className="px-2 py-1 rounded-full glass-button transition-apple text-gray-200 disabled:opacity-50"
                      title="在生成音频前，检查旁白/对白时长与镜头时长是否匹配"
                    >
                      {isAudioChecking ? '检查中...' : '对齐检查'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAudioCheck(true)}
                      disabled={!projectId || isAudioChecking || generationStage === 'audio'}
                      className="px-2 py-1 rounded-full glass-button transition-apple text-cyan-200 disabled:opacity-50"
                      title="按建议自动调整镜头时长（只增不减），用于更稳妥的音频对齐"
                    >
                      按建议调时长
                    </button>
                  </div>
                </div>
              </TaskCard>
            )}

            {/* Narration Assets 卡片 */}
            {audioAssets.filter(a => a.type === 'narration' || a.type === 'dialogue').length > 0 && (
              <TaskCard
                title="Narration Assets"
                icon={<Mic size={14} />}
                expanded={expandedCards.has('narration')}
                onToggle={() => toggleCard('narration')}
                badge={audioAssets.filter(a => a.type === 'narration').length.toString()}
              >
                <div className="space-y-2">
                  {audioAssets.filter(a => a.type === 'narration' || a.type === 'dialogue').map((audio) => (
                    <AudioAssetItem key={audio.id} asset={audio} />
                  ))}
                </div>
              </TaskCard>
            )}

            {/* Music & Sound 卡片 */}
            {audioAssets.filter(a => a.type === 'music' || a.type === 'sfx').length > 0 && (
              <TaskCard
                title="Music & Sound"
                icon={<Music size={14} />}
                expanded={expandedCards.has('music')}
                onToggle={() => toggleCard('music')}
              >
                <div className="space-y-2">
                  {audioAssets.filter(a => a.type === 'music' || a.type === 'sfx').map((audio) => (
                    <AudioAssetItem key={audio.id} asset={audio} />
                  ))}
                </div>
              </TaskCard>
            )}

            {/* 时间轴卡片 */}
            {segments.length > 0 && visualAssets.filter(a => a.type === 'video').length > 0 && (
              <TaskCard
                title="时间轴"
                icon={<Clock size={14} />}
                expanded={expandedCards.has('timeline')}
                onToggle={() => toggleCard('timeline')}
              >
                <div className="space-y-2">
                  <div className="flex gap-1 overflow-x-auto pb-2">
                    {visualAssets.filter(a => a.type === 'video').slice(0, 8).map((asset) => (
                      <div key={asset.id} className="flex-shrink-0 w-16">
                        <video
                          src={asset.url}
                          className="w-full h-10 object-cover rounded"
                          muted
                          playsInline
                          preload="metadata"
                        />
                        <p className="text-[8px] text-gray-500 truncate mt-0.5">{asset.name}</p>
                        {asset.duration && <p className="text-[8px] text-gray-400">{asset.duration}</p>}
                      </div>
                    ))}
                  </div>
                  <button 
                    onClick={() => setActiveModule('timeline')}
                    className="w-full py-2 glass-button rounded-lg text-xs flex items-center justify-center gap-1"
                  >
                    <Maximize2 size={12} />
                    打开完整时间轴
                  </button>
                </div>
              </TaskCard>
            )}
          </div>

          {/* 对话消息 - 放在任务卡片下方 */}
          <div className="p-4 space-y-4">
            {messages.map((msg) => (
              <ChatMessageItem
                key={msg.id}
                message={msg}
                onOptionClick={handleOptionClick}
                onConfirmClick={handleConfirmClick}
              />
            ))}

            {sending && (
              <div className="glass-card p-4 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img
                      src="/yuanyuan/thinking.png"
                      alt="思考中"
                      className="w-8 h-8 rounded-lg object-cover animate-pulse"
                    />
                    <div>
                      <p className="text-sm font-medium text-pink-400">YuanYuan 正在思考...</p>
                      <p className="text-xs text-gray-500">
                        {generationStage === 'planning' ? '分析需求中' :
                         generationStage === 'elements' ? '生成角色图片' :
                         generationStage === 'frames' ? '生成起始帧' :
                         generationStage === 'videos' ? '生成视频' : '处理中'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleStopGeneration}
                    className="px-3 py-1.5 glass-button rounded-lg text-xs text-red-400 hover:bg-red-500/20 flex items-center gap-1"
                  >
                    <span>⏹</span> 停止
                  </button>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* 输入区域 */}
        <div className="p-4 border-t border-white/5">
          <ChatInput
            value={inputMessage}
            onChange={setInputMessage}
            onSend={handleSendMessage}
            onStop={() => setSending(false)}
            isLoading={sending}
            placeholder="描述你想制作的视频，可上传参考图片..."
            rows={2}
            showModelSelector={true}
            enableFileUpload={true}
            uploadedFiles={uploadedFiles}
            onFilesChange={setUploadedFiles}
            maxFiles={5}
          />
        </div>
      </aside>
    </div>
  )
}
